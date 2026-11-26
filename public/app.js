/* One King One Crown — browser client */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const socket = io({ transports: ['websocket', 'polling'] });
  const STORE = 'okoc-session';
  const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR'];
  const MAX_PLAYERS = 8;
  const MIN_PLAYERS = 4;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let S = { room: null, game: null };
  let catalog = {};
  let clockSkew = 0;
  let session = load();
  let shownPromptKey = '';
  let chatSeen = 0;
  let activeTab = 'log';
  let negBuiltFor = null;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } }
  function save(v) { session = v; try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); } catch (e) { /* private mode */ } }
  const now = () => Date.now() - clockSkew;

  fetch('/api/cards').then((r) => r.json()).then((list) => { for (const c of list) catalog[c.id] = c; render(); });

  // ───────── networking ─────────
  function send(event, data = {}) {
    return new Promise((resolve) => {
      socket.emit(event, data, (res) => {
        if (res && res.error) toast(res.error);
        resolve(res || {});
      });
    });
  }
  socket.on('connect', () => {
    if (session && session.code) {
      socket.emit('resume', session, (res) => {
        if (res && res.error) { save(null); show('home'); }
      });
    }
  });
  socket.on('disconnect', () => toast('Connection lost. Reconnecting…', 4000));
  socket.on('kicked', () => { save(null); S = { room: null, game: null }; show('home'); toast('You were removed from the room.'); });
  socket.on('state', (st) => {
    clockSkew = Date.now() - st.now;
    S = st;
    render();
  });

  // ───────── helpers ─────────
  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.add('hidden'), ms);
  }
  function show(id) { for (const s of ['home', 'lobby', 'game']) $('#' + s).classList.toggle('hidden', s !== id); }
  const art = (id) => `/art/cards/${id}.png`;
  const cname = (id) => (catalog[id] ? catalog[id].name : id);
  const G = () => S.game;
  const P = (pid) => (G() ? G().players.find((p) => p.pid === pid) : null);
  const pname = (pid) => { const p = P(pid) || (S.room && S.room.members.find((m) => m.pid === pid)); return p ? p.name : '?'; };
  const meP = () => P(S.room.you);
  const isHost = () => S.room && S.room.host === S.room.you;
  const backFor = (deck) => (deck === 'king' ? '/art/back-king.png' : '/art/back-noble.png');
  const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  // a stable, different blink rhythm for every player
  const blinkOffset = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 700) / 100; };
  const figure = (king, seed) => `<span class="${king ? 'kfig' : 'hood'}" style="--bd:-${blinkOffset(seed)}s"><span class="eyes"><i></i><i></i></span></span>`;
  function dieHtml(v) {
    const pips = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
    return Array.from({ length: 9 }, (_, i) => `<i style="visibility:${pips.includes(i) ? 'visible' : 'hidden'}"></i>`).join('');
  }
  // point a figure's pupils along (dx, dy)
  function look(el, dx, dy, max = 3) {
    const len = Math.hypot(dx, dy);
    const px = len ? (dx / len) * max : 0;
    const py = len ? (dy / len) * max * 0.7 : 0;
    for (const i of el.querySelectorAll('.eyes i')) { i.style.setProperty('--px', px.toFixed(2) + 'px'); i.style.setProperty('--py', py.toFixed(2) + 'px'); }
  }

  // ───────── first-time guide ─────────
  const GUIDE_PREF = 'okoc-guide';
  // On by default until you have finished a game on this device; your own choice always wins.
  function guidePref() {
    try {
      const v = localStorage.getItem(GUIDE_PREF);
      if (v === 'on' || v === 'off') return v === 'on';
      return !localStorage.getItem('okoc-played');
    } catch (e) { return true; }
  }
  function setGuidePref(on) { try { localStorage.setItem(GUIDE_PREF, on ? 'on' : 'off'); } catch (e) { /* private mode */ } }
  const guide = window.createGuide({
    $, esc, send, cname, toast, state: () => S,
    openModal: (...a) => openModal(...a), closeModal: () => closeModal(), showRules: () => showRules(),
    setPref: setGuidePref, rerender: () => render(),
  });
  let guideSyncedFor = null;

  // ───────── home ─────────
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('#code').value = params.get('room').toUpperCase().slice(0, 4);
  $('#name').value = (session && session.name) || localStorage.getItem('okoc-name') || '';
  function name() {
    const n = $('#name').value.trim();
    if (!n) { $('#home-error').textContent = 'Enter your name first.'; $('#name').focus(); return null; }
    try { localStorage.setItem('okoc-name', n); } catch (e) { /* ignore */ }
    return n;
  }
  async function enter(event, data) {
    $('#home-error').textContent = '';
    const res = await send(event, data);
    if (res.error) { $('#home-error').textContent = res.error; return; }
    save({ code: res.code, pid: res.pid, token: res.token, name: data.name });
    history.replaceState(null, '', '?room=' + res.code);
  }
  $('#create').onclick = () => { const n = name(); if (n) enter('create', { name: n }); };
  $('#join').onclick = () => { const n = name(); const c = $('#code').value.trim().toUpperCase(); if (!n) return; if (c.length !== 4) { $('#home-error').textContent = 'Enter the 4-letter room code.'; return; } enter('join', { name: n, code: c }); };
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join').click(); });
  $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#code').value ? $('#join') : $('#create')).click(); });

  // the crowd of nobles at the bottom of the home screen, with their King in the middle
  (function buildCrowd() {
    const sizes = [58, 74, 50, 88, 66, 112, 70, 92, 54, 78, 60];
    $('.crowd').innerHTML = sizes.map((w, i) => {
      const king = i === 5;
      return figure(king, 'crowd' + i).replace('style="', `style="--w:${w}px;--d:${(0.25 + Math.abs(i - 5) * 0.06).toFixed(2)}s;`);
    }).join('');
  })();
  let mouseRaf = 0;
  document.addEventListener('mousemove', (e) => {
    if (mouseRaf || $('#home').classList.contains('hidden')) return;
    mouseRaf = requestAnimationFrame(() => {
      mouseRaf = 0;
      for (const f of $$('.crowd > *')) {
        const r = f.getBoundingClientRect();
        look(f, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height * 0.55), Math.max(2, r.width / 22));
      }
    });
  });

  // ───────── lobby ─────────
  $('#copy-link').onclick = () => {
    const url = location.origin + '/?room=' + S.room.code;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied!'), () => prompt('Copy this link:', url));
  };
  $('#add-bot').onclick = () => send('host:addBot');
  $('#start').onclick = () => send('host:start');
  $('#neg-seconds').onchange = (e) => send('host:settings', { negotiationSeconds: Number(e.target.value) });
  $('#speed').onchange = (e) => send('host:settings', { speed: e.target.value });
  $('#speed-game').onchange = (e) => send('host:settings', { speed: e.target.value });
  $('#leave').onclick = async () => { const r = await send('leave'); if (!r.error) { save(null); S = { room: null, game: null }; history.replaceState(null, '', '/'); show('home'); } };
  document.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-chat]')) return;
    e.preventDefault();
    const inp = $('input', e.target);
    if (inp.value.trim()) send('chat', { text: inp.value });
    inp.value = '';
  });

  $('#guide-toggle').onclick = () => {
    const on = $('#guide-toggle').getAttribute('aria-checked') !== 'true';
    setGuidePref(on);
    $('#guide-toggle').setAttribute('aria-checked', String(on));
    send('tutorial', { on });
  };

  let lobbyKey = '';
  function renderLobby() {
    const r = S.room;
    const mine = r.members.find((m) => m.pid === r.you);
    if (mine && guideSyncedFor !== r.code) {
      guideSyncedFor = r.code;
      const want = guidePref();
      if (want !== !!mine.tutorial) send('tutorial', { on: want });
      $('#guide-toggle').setAttribute('aria-checked', String(want));
    } else if (mine) $('#guide-toggle').setAttribute('aria-checked', String(!!mine.tutorial));
    $('#room-code').textContent = r.code;
    const key = JSON.stringify([r.members, r.host, r.you]);
    if (key !== lobbyKey) {
      lobbyKey = key;
      let html = r.members.map((m) => {
        const sub = [m.pid === r.host ? 'Host' : '', m.isBot ? 'Bot' : '', m.pid === r.you ? 'You' : '', m.tutorial ? 'First game' : '', !m.connected && !m.isBot ? 'Away' : ''].filter(Boolean).join(' · ');
        return `<li class="${m.connected || m.isBot ? '' : 'off'}">${figure(false, m.pid)}<span class="tag-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="sub">${sub || '&nbsp;'}</span>
          ${isHost() && m.pid !== r.you ? `<button class="kick" data-kick="${m.pid}" title="Remove ${esc(m.name)}" aria-label="Remove ${esc(m.name)}">×</button>` : ''}</li>`;
      }).join('');
      for (let i = r.members.length; i < MAX_PLAYERS; i++) html += `<li class="empty"><span class="hood"></span><span class="tag-name">Open seat</span><span class="sub">${i < MIN_PLAYERS ? 'Needed' : 'Optional'}</span></li>`;
      $('#members').innerHTML = html;
    }
    $('#host-controls').classList.toggle('hidden', !isHost());
    $('#neg-seconds').value = String(r.settings.negotiationSeconds);
    $('#speed').value = r.settings.speed || 'auto';
    const n = r.members.length;
    $('#start').disabled = n < MIN_PLAYERS;
    $('#add-bot').disabled = n >= MAX_PLAYERS;
    $('#lobby-wait').textContent = n < MIN_PLAYERS
      ? `${n} of ${MAX_PLAYERS} seats taken. You need at least ${MIN_PLAYERS} players (bots can fill seats).`
      : `${n} of ${MAX_PLAYERS} seats taken. ${isHost() ? 'Start when everyone is here.' : 'Waiting for the host to start…'}`;
    renderChat($('#lobby-chat-log'), r.chat);
  }
  $('#members').addEventListener('click', (e) => { const k = e.target.closest('[data-kick]'); if (k) send('host:kick', { target: k.dataset.kick }); });

  function renderChat(el, list) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = list.map((m) => `<div class="m"><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // ───────── game: main render ─────────
  function render() {
    if (!S.room) return;
    if (!S.game) { show('lobby'); renderLobby(); closeModalIf('over'); resetTable(); guide.onRender(); return; }
    show('game');
    $('#game-code').textContent = S.room.code;
    renderTop();
    renderSeats();
    renderCenter();
    renderMe();
    renderHand();
    renderPrompt();
    renderNeg();
    renderLog();
    renderSideChat();
    announce();
    collectSeen();
    guide.onRender();
    if (G().phase === 'over') { try { localStorage.setItem('okoc-played', '1'); } catch (e) { /* ignore */ } showGameOver(); }
  }

  function resetTable() {
    for (const s of seatEls.values()) s.el.remove();
    seatEls.clear();
    seen = null; centerKeys = {}; handKey = ''; dealt.clear(); lastLogI = -1; seenCards.clear();
  }

  function renderTop() {
    const g = G();
    $('#tracker').innerHTML = WORDS.map((w, i) => {
      const r = i + 1;
      return `<div class="r ${r % 2 ? 'cw' : 'ccw'} ${r === g.round ? 'now' : r < g.round ? 'done' : ''}" title="Round ${w.toLowerCase()}: ${r % 2 ? 'clockwise' : 'counter-clockwise'}"><small>ROUND</small><b>${w}</b>${icon('cw')}</div>`;
    }).join('');
    let txt = '';
    if (g.phase === 'starting') txt = 'Dealing…';
    else if (g.phase === 'intro') txt = `Quick tour for new players <span class="timer" data-ends="${g.intro ? g.intro.endsAt : 0}"></span>`;
    else if (g.phase === 'over') txt = 'Game over';
    else if (g.phase === 'negotiation') txt = `Negotiation phase <span class="timer" data-ends="${g.negotiation.endsAt}"></span>`;
    else if (g.turn) txt = g.turn.pid === S.room.you ? `<span class="yourturn">Your turn</span> ${g.turn.playsLeft} card${g.turn.playsLeft === 1 ? '' : 's'} left to play` : `${esc(pname(g.turn.pid))}'s turn · ${g.turn.playsLeft} left`;
    $('#phase').innerHTML = txt;
    $('#skip').classList.toggle('hidden', !isHost() || (!g.waiting.length && g.phase !== 'intro') || g.phase === 'over');
    $('#guide-btn').classList.toggle('on', guide.isOn());
    const sp = $('#speed-game');
    sp.classList.toggle('hidden', !isHost() || g.phase === 'over');
    if (document.activeElement !== sp) sp.value = S.room.settings.speed || 'auto';
    const pace = S.room.settings.pace;
    sp.title = `Game speed (host). Playing ${pace}: bots think longer and each card stays on the table for a moment when slower.`;
    const me = meP();
    $('#auto-me').classList.toggle('on', !!(me && me.auto));
    $('#auto-me').textContent = me && me.auto ? 'Autopilot on' : 'Autopilot';
  }

  function goldGrid(gold) {
    let h = '<div class="mini-grid" aria-hidden="true">';
    for (let v = 0; v <= 2000; v += 100) h += `<i class="${v === gold ? 'tok' : ''}"></i>`;
    return h + '</div>';
  }

  // Seats are kept between renders so they can slide (crown swaps), count gold up/down and blink.
  const seatEls = new Map();
  function renderSeats() {
    const g = G();
    const table = $('#table');
    const n = g.players.length;
    const me = meP();
    const mySeat = me ? me.seat : 0;
    const waitingOn = new Map();
    for (const w of g.waiting) if (!waitingOn.has(w.pid)) waitingOn.set(w.pid, w.title);
    const W = table.clientWidth;
    const H = table.clientHeight;
    // with many players or a short screen the plates shrink so seats never pile up
    const phone = W < 600;
    const compact = !phone && (n >= 6 || H < 470);
    const tiny = phone && n >= 6;
    table.classList.toggle('compact', compact);
    table.classList.toggle('tiny', tiny);
    table.parentElement.classList.toggle('many', tiny);
    const rx = phone ? 36 : compact ? 43 : 41;
    const ry = phone ? (tiny ? 37 : 38) : compact ? 38 : 35;
    const pos = {};
    for (const p of g.players) {
      const a = Math.PI / 2 + ((p.seat - mySeat) * 2 * Math.PI) / n;
      pos[p.pid] = { x: 50 + rx * Math.cos(a), y: 51 + ry * Math.sin(a) };
    }
    // everyone watches whoever is acting: the card being resolved, else the player whose turn it is
    const focus = (g.resolving && g.resolving.pid) || (g.turn && g.turn.pid) || null;
    for (const p of g.players) {
      let s = seatEls.get(p.pid);
      if (!s) {
        const el = document.createElement('div');
        el.className = 'seat';
        el.dataset.seat = p.pid;
        el.innerHTML = '<div class="fig"></div><div class="plate"></div>';
        table.appendChild(el);
        s = { el, gold: p.gold, shown: p.gold, king: null, fids: new Set(p.faceDown.map((f) => f.fid)) };
        seatEls.set(p.pid, s);
      }
      const el = s.el;
      if (s.king !== p.isKing) { $('.fig', el).innerHTML = figure(p.isKing, p.pid); s.king = p.isKing; }
      el.classList.toggle('king', p.isKing);
      el.classList.toggle('turn', !!(g.turn && g.turn.pid === p.pid));
      el.classList.toggle('me', p.pid === S.room.you);
      el.classList.toggle('off', !p.connected && !p.isBot);
      el.style.left = pos[p.pid].x + '%';
      el.style.top = pos[p.pid].y + '%';

      if (p.gold !== s.gold) { goldChange(s, p.gold - s.gold); s.gold = p.gold; }

      const chips = [];
      if (waitingOn.has(p.pid)) chips.push(`<span class="chip wait" title="${esc(waitingOn.get(p.pid))}">Deciding</span>`);
      for (const st of p.statuses) chips.push(`<span class="chip" title="${esc(st.label)}">${esc(st.label)}</span>`);
      for (const b of p.bets) chips.push(`<span class="chip bet" title="${b.type === 'scout' ? 'Scout' : 'Hindsight'}: until the end of round ${b.deadline}">${b.type === 'scout' ? 'Scout' : 'Hindsight'} → ${esc(pname(b.target))}</span>`);
      for (const b of g.badBlood.filter((x) => x.owner === p.pid)) chips.push(`<span class="chip" title="Bad Blood: +200 each round until ${esc(pname(b.a))} or ${esc(pname(b.b))} pays the other 200">Bad Blood: ${esc(pname(b.a))} × ${esc(pname(b.b))}</span>`);
      for (const d of g.debts.filter((x) => x.debtor === p.pid)) chips.push(`<span class="chip" title="Pays ${esc(pname(d.owner))} 100 at the start of every round">Owes ${esc(pname(d.owner))}</span>`);
      const fd = p.faceDown.map((f) => {
        const fresh = !s.fids.has(f.fid);
        return `<span class="k ${fresh ? 'new' : ''}" style="background-image:url(${backFor(f.deck)})" title="${f.known ? 'You know this is: ' + esc(cname(f.known)) : 'Face-down card. Its owner claims it is a Knight, which would block the next Betrayal against this player. It might be a bluff.'}">${f.known ? icon('eye') : ''}</span>`;
      }).join('');
      s.fids = new Set(p.faceDown.map((f) => f.fid));
      $('.plate', el).innerHTML = `
        <div class="top"><span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>${p.pid === S.room.you ? '<span class="you">YOU</span>' : ''}
          <span class="flags">${p.isBot ? '<span class="bot">BOT</span>' : p.auto ? '<span class="bot" title="Autopilot is playing">AUTO</span>' : p.learning && p.pid !== S.room.you ? '<span class="bot new" title="First game: using the guide">NEW</span>' : ''}<span class="dot ${p.connected || p.isBot ? '' : 'off'}" title="${p.connected || p.isBot ? 'online' : 'offline'}"></span></span></div>
        <div class="goldline">${goldGrid(p.gold)}<span class="gold"><b>${Math.round(s.shown)}</b><small>gold</small></span>
          <span class="cnt" title="${p.handCount} cards in hand"><span class="mini-back" style="background-image:url(${backFor(p.isKing ? 'king' : 'noble')})"></span>${p.handCount}</span></div>
        ${fd ? `<div class="fd">${fd}</div>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}`;

      const f = focus && pos[focus];
      if (f && focus !== p.pid) look(el, (f.x - pos[p.pid].x) * W, (f.y - pos[p.pid].y) * H);
      else look(el, 0, focus === p.pid ? -1 : 0);
    }
    for (const [pid, s] of seatEls) if (!pos[pid]) { s.el.remove(); seatEls.delete(pid); }
  }

  // floating +/- label and a quick count from the old total to the new one
  function goldChange(s, delta) {
    const tag = document.createElement('span');
    tag.className = 'delta ' + (delta > 0 ? 'up' : 'down');
    tag.textContent = (delta > 0 ? '+' : '') + delta;
    tag.addEventListener('animationend', () => tag.remove());
    s.el.appendChild(tag);
    cancelAnimationFrame(s.raf);
    const from = s.shown;
    const to = s.gold + delta;
    if (reduceMotion) { s.shown = to; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      s.shown = from + (to - from) * (1 - Math.pow(1 - k, 3));
      const b = s.el.querySelector('.gold b');
      if (b) b.textContent = Math.round(s.shown);
      if (k < 1) s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
    // background tabs pause animation frames; make sure the final number always lands
    clearTimeout(s.settle);
    s.settle = setTimeout(() => { cancelAnimationFrame(s.raf); s.shown = s.gold; const b = s.el.querySelector('.gold b'); if (b) b.textContent = s.gold; }, 900);
  }

  // The centre is split into parts that are only redrawn when they change, so animations play once.
  let centerKeys = {};
  function part(id, key, build) {
    const el = $('#' + id);
    if (centerKeys[id] === key) return;
    const prev = centerKeys[id];
    centerKeys[id] = key;
    el.innerHTML = build(prev);
  }
  function renderCenter() {
    const g = G();
    if (!$('#c-king')) $('#center').innerHTML = '<div id="c-king" class="pile-pair"></div><div id="c-mid"></div><div id="c-die" class="dice-box"></div><div id="c-noble" class="pile-pair"></div>';
    for (const deck of ['king', 'noble']) {
      const d = g.decks[deck];
      const label = deck === 'king' ? 'King' : 'Noble';
      part('c-' + deck, [d.draw, d.top, d.discard].join(':'), (prev) => {
        const flip = prev && prev.split(':')[1] !== String(d.top);
        return `<div class="pile">${d.draw ? `<div class="c ${d.draw < 5 ? 'thin' : ''}" style="background-image:url(${backFor(deck)})" title="${label} deck: ${d.draw} cards"></div>` : '<div class="c empty"></div>'}${label} · ${d.draw}</div>
          <div class="pile">${d.top ? `<div class="c face ${flip ? 'flip' : ''}" style="background-image:url(${art(d.top)})" data-zoom="${d.top}" title="Top of the ${label} discard pile"></div>` : '<div class="c empty"></div>'}Discard · ${d.discard}</div>`;
      });
    }
    const res = g.resolving;
    part('c-mid', res ? res.pid + ':' + res.cardId : g.phase === 'negotiation' ? 'neg' : '', () => {
      if (res) return `<div class="resolving new"><img src="${art(res.cardId)}" alt="${esc(cname(res.cardId))}" data-zoom="${res.cardId}"><span class="who">${esc(pname(res.pid))}</span></div>`;
      if (g.phase === 'negotiation') return '<div class="resolving"><img class="hourglass" src="/art/hourglass.png" alt=""><span class="who">Negotiate!</span></div>';
      return '';
    });
    const lr = g.lastRoll;
    part('c-die', lr ? String(lr.n) : '-', (prev) => (lr
      ? `<div class="die ${prev && prev !== '-' && !reduceMotion ? 'roll' : ''}">${dieHtml(lr.value)}</div>${esc(pname(lr.pid))} rolled ${lr.value}`
      : `<div class="die">${dieHtml(6)}</div>`));
    const others = g.waiting.filter((w) => w.pid !== S.room.you);
    const uniq = [...new Map(others.map((x) => [x.pid, x])).values()];
    $('#waiting').textContent = uniq.length ? `Waiting for ${uniq.slice(0, 4).map((x) => x.name).join(', ')}${uniq.length > 4 ? ' and others' : ''}` : '';
  }

  function renderMe() {
    const g = G();
    const me = meP();
    if (!me) { $('#me-info').innerHTML = '<span class="muted">Spectating</span>'; return; }
    const parts = [me.isKing ? `<span class="role king">${icon('crown')}The King</span>` : '<span class="role">Noble</span>', `<span><span class="big">${me.gold}</span> gold</span>`];
    const myTurnNow = g.turn && g.turn.pid === me.pid;
    if (myTurnNow) parts.push(`<span class="yourturn">Your turn: play ${g.turn.playsLeft} more card${g.turn.playsLeft === 1 ? '' : 's'}</span>`);
    for (const b of g.badBlood) if (b.a === me.pid || b.b === me.pid) {
      const other = b.a === me.pid ? b.b : b.a;
      parts.push(`<button class="btn small" data-bb="${b.id}" ${me.gold < 200 ? 'disabled' : ''} title="Ends ${esc(pname(b.owner))}'s Bad Blood">Give ${esc(pname(other))} 200 (end Bad Blood)</button>`);
    }
    for (const d of g.debts) if (d.debtor !== me.pid && d.owner !== me.pid) parts.push(`<button class="btn small" data-debt="${d.id}" ${me.gold < 200 ? 'disabled' : ''}>Pay ${esc(pname(d.owner))} 200 to free ${esc(pname(d.debtor))}</button>`);
    for (const s of me.statuses) parts.push(`<span class="chip">${esc(s.label)}</span>`);
    const step = guide.isOn() ? guide.nextStep() : '';
    if (step) parts.push(`<span class="next-step">${esc(step)}</span>`);
    else if (myTurnNow) parts.push('<span class="muted hint">Click a card to play it, or place it face down as a “Knight”.</span>');
    const html = parts.join('');
    if (html !== meHtml) { meHtml = html; $('#me-info').innerHTML = html; }
  }
  let meHtml = '';
  $('#me-info').addEventListener('click', (e) => {
    const bb = e.target.closest('[data-bb]'); if (bb) send('badBlood', { id: Number(bb.dataset.bb) });
    const d = e.target.closest('[data-debt]'); if (d) send('freeDebt', { id: Number(d.dataset.debt) });
  });

  // The hand is fanned like cards held in a real hand. New cards are dealt in.
  let handKey = '';
  const dealt = new Set();
  function renderHand() {
    const g = G();
    const myTurn = g.turn && g.turn.pid === S.room.you && g.turn.canPlay;
    const items = g.hand.map((c) => {
      const note = c.faceDownOnly ? 'Face down only' : c.reason ? (catalog[c.id] && catalog[c.id].reactionOnly ? 'Reaction' : 'Not now') : '';
      return { c, note: myTurn ? note : '', dim: myTurn && !c.playable && !c.faceDownOnly, playable: myTurn && (c.playable || c.canFaceDown) };
    });
    const key = JSON.stringify(items.map((x) => [x.c.uid, x.c.id, x.note, x.dim, x.playable]));
    if (key === handKey) return;
    handKey = key;
    const n = items.length;
    const mid = (n - 1) / 2;
    const spread = Math.min(4, 34 / Math.max(n, 1));
    let fresh = 0;
    const firstDeal = dealt.size === 0;
    $('#hand').innerHTML = items.map(({ c, note, dim, playable }, i) => {
      const off = i - mid;
      const isNew = !dealt.has(c.uid);
      const delay = isNew ? (firstDeal ? i * 0.06 : fresh++ * 0.12) : 0;
      // the slot holds the card's place in the fan and never moves, so the hover area stays put
      // while the card inside rises (otherwise the card slides out from under the cursor and flickers)
      return `<div class="slot ${isNew && !reduceMotion ? 'enter' : ''}" style="--r:${(off * spread).toFixed(2)}deg;--y:${(off * off * 1.1).toFixed(1)}px;--d:${delay}s" data-card="${c.uid}">`
        + `<div class="card ${dim ? 'dim' : ''} ${playable ? 'playable' : ''}" style="background-image:url(${art(c.id)})" data-card="${c.uid}" title="${esc(cname(c.id))}" role="button" tabindex="0" aria-label="${esc(cname(c.id))}">${note ? `<span class="tagline">${note}</span>` : ''}</div></div>`;
    }).join('') || '<span class="empty-hand">No cards.</span>';
    fitHand();
    dealt.clear();
    for (const { c } of items) dealt.add(c.uid);
    for (const el of $$('#hand .slot.enter')) el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  }
  // overlap the cards more when a big hand would not fit the bar
  function fitHand() {
    const hand = $('#hand');
    const cards = hand.querySelectorAll('.slot');
    if (!cards.length || window.innerWidth <= 820) { hand.style.removeProperty('--m'); return; }
    const cw = cards[0].offsetWidth;
    const avail = hand.clientWidth - 60;
    const m = Math.min(-7, (avail - cards.length * cw) / (cards.length * 2));
    hand.style.setProperty('--m', Math.max(m, -cw * 0.42).toFixed(1) + 'px');
  }
  window.addEventListener('resize', () => { if (G()) fitHand(); });
  $('#hand').addEventListener('click', (e) => { const el = e.target.closest('[data-card]'); if (el) openCard(Number(el.dataset.card)); });
  $('#hand').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const el = e.target.closest('[data-card]'); if (el) { e.preventDefault(); openCard(Number(el.dataset.card)); } } });

  // ───────── card actions ─────────
  // plain-language notes for the cards new players ask about
  const PLAIN = {
    betrayal: '<b>In plain words:</b> pick another noble and take <b>all</b> their gold. Right after you play it, the other players get a “support” button: if nobody backs you, it does nothing. A real Knight in front of your target blocks it. Can’t be used in round one.',
    'betray-the-king': '<b>In plain words:</b> try to swap places with the King. You need two players to back you, then the King rolls: 1–3 you become King and swap gold; 4–6 the King stays and gains 200.',
    knight: '<b>In plain words:</b> this card only works face down, in front of you. It quietly protects you from the next Betrayal played on you. Others can’t tell it apart from a bluff.',
    'king-knight': '<b>In plain words:</b> place it face down in front of a noble you want to protect. It blocks the next Betrayal against them, and they can’t look at it.',
  };
  function openCard(uid) {
    const g = G();
    const c = g.hand.find((x) => x.uid === uid);
    if (!c) return;
    const me = meP();
    const myTurn = g.turn && g.turn.pid === S.room.you && g.turn.canPlay;
    const def = catalog[c.id] || {};
    let acts = '';
    if (g.phase === 'play' && myTurn) {
      if (!c.faceDownOnly) acts += `<button class="btn primary" data-act="play" ${c.playable ? '' : 'disabled'}>Play ${esc(def.name || '')}</button>${c.reason ? `<div class="reason">${esc(c.reason)}</div>` : ''}`;
      if (c.canFaceDown) {
        if (me.isKing) {
          acts += `<h3>${c.faceDownOnly ? 'Place this Knight' : 'Or place it face down as a “Knight”'} in front of…</h3><div class="opts">${g.players.filter((p) => !p.isKing).map((p) => `<button class="btn" data-act="fd" data-target="${p.pid}">${esc(p.name)}</button>`).join('')}</div>`;
        } else {
          acts += `<button class="btn${c.faceDownOnly ? ' primary' : ''}" data-act="fd">${c.faceDownOnly ? 'Place Knight face down' : 'Place face down (claim it’s a Knight)'}</button>`;
        }
        acts += '<div class="explain"><b>What does face down do?</b> The card sits hidden in front of '
          + (me.isKing ? 'the noble you pick' : 'you')
          + ' and everyone is told it is a <b>Knight</b>. A Knight blocks one <b>Betrayal</b> (the card that takes all of a noble’s gold). '
          + 'If it really is a Knight, the next Betrayal against that player fails and the Knight is used up. If it is any other card, it is a <b>bluff</b>: it may scare people off, but blocks nothing. '
          + 'Either way it counts as one of your plays, a handy way to use a turn without triggering a card you don’t want.</div>';
      }
    } else if (g.phase === 'play') {
      acts += `<p class="fine">${g.turn && g.turn.pid === S.room.you ? 'Wait for the current card to finish.' : 'You can play cards on your turn.'}</p>`;
    }
    if (g.phase === 'negotiation') {
      const nobles = g.players.filter((p) => !p.isKing && p.pid !== me.pid);
      if (c.id === 'royal-bomb') {
        acts += `<h3>Royal Bomb</h3><div class="opts">${nobles.map((p) => `<button class="btn" data-act="bomb-give" data-target="${p.pid}">Give to ${esc(p.name)}</button>`).join('')}<button class="btn" data-act="bomb-discard">Discard it</button></div>`;
      }
      if (!me.isKing) acts += `<h3>Offer an exchange to…</h3><div class="opts">${nobles.map((p) => `<button class="btn" data-act="trade" data-target="${p.pid}">${esc(p.name)}</button>`).join('') || '<span class="fine">No other nobles.</span>'}</div><div class="fine">Nobles swap cards one for one: they pick one of theirs to give back, or decline.</div>`;
      else acts += '<div class="fine">The King can’t swap cards (nobles can’t hold King cards), but can still give gold and discard as part of a deal.</div>';
      acts += `<h3>Discard as part of a deal with…</h3><div class="opts">${g.players.filter((p) => p.pid !== me.pid).map((p) => `<button class="btn" data-act="deal" data-target="${p.pid}">${esc(p.name)}</button>`).join('')}</div><div class="explain"><b>Why discard?</b> It proves a promise. For example: “I’ll throw away my Betrayal if you give me 200”, or a noble pays the King to get rid of a nasty King card. The discarded card lands face up on the discard pile for everyone to see, and you draw a replacement. You may only discard as part of a deal, and the other player must confirm.</div>`;
    }
    const plain = PLAIN[c.id] ? `<div class="explain">${PLAIN[c.id]}</div>` : '';
    openModal('card', `<div class="zoom"><img src="${art(c.id)}" alt="${esc(def.name || c.id)}"><div class="actions"><h2>${esc(def.name || c.id)}</h2><div class="dots"></div>${def.text ? `<div class="text">${esc(def.text)}</div>` : ''}${plain}${acts}</div></div>`, async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const t = b.dataset.target;
      let r;
      switch (b.dataset.act) {
        case 'play': r = await send('play', { uid }); break;
        case 'fd': r = await send('play', { uid, faceDown: true, target: t }); break;
        case 'trade': r = await send('neg:trade', { to: t, uid }); if (!r.error) toast('Exchange offered.'); break;
        case 'deal': r = await send('neg:discard', { partner: t, uid }); if (!r.error) toast('Waiting for them to confirm the deal.'); break;
        case 'bomb-give': r = await send('neg:bomb', { action: 'give', to: t }); break;
        case 'bomb-discard': r = await send('neg:bomb', { action: 'discard' }); break;
        default: return;
      }
      if (!r.error) closeModal();
    });
  }

  // ───────── prompts ─────────
  function renderPrompt() {
    const g = G();
    const el = $('#prompt');
    const p = g.prompts[0];
    if (!p) { el.classList.add('hidden'); shownPromptKey = ''; return; }
    const key = p.id + ':' + g.prompts.length;
    if (key === shownPromptKey && !el.classList.contains('hidden')) return;
    const sameId = shownPromptKey.split(':')[0] === String(p.id);
    shownPromptKey = key;
    if (sameId && p.kind === 'say') { const c = $('.count', el); if (c) c.textContent = g.prompts.length > 1 ? `+${g.prompts.length - 1} more` : ''; return; }
    el.classList.remove('hidden');
    el.classList.toggle('anim', !sameId);
    let body = `${g.prompts.length > 1 ? `<span class="count">+${g.prompts.length - 1} more</span>` : ''}<h2>${esc(p.title)}</h2><div class="dots"></div>${p.text ? `<p>${esc(p.text)}</p>` : ''}`;
    const cancel = p.cancelable ? `<button class="btn ghost" data-v='"__cancel__"'>↩ Take the card back</button>` : '';
    if (p.kind === 'choice') {
      body += `<div class="opts">${p.options.map((o) => `<button class="btn" data-v='${esc(JSON.stringify(o.value))}' ${o.disabled ? 'disabled' : ''}>${esc(o.label)}${o.reason ? `<span class="why">${esc(o.reason)}</span>` : ''}</button>`).join('')}${cancel}</div>`;
    } else if (p.kind === 'cards') {
      if (p.offered) body += `<p><b>Offered to you:</b></p><div class="cards"><div class="card" style="background-image:url(${art(p.offered.id)})" data-zoom="${p.offered.id}"></div></div><p><b>Your cards:</b></p>`;
      body += `<div class="cards">${p.cards.map((c) => `<div class="card" style="background-image:url(${art(c.id)})" data-v='${JSON.stringify(c.uid)}' title="${esc(cname(c.id))}"></div>`).join('')}</div>`;
      body += `<div class="opts">${(p.options || []).map((o) => `<button class="btn" data-v='${esc(JSON.stringify(o.value))}'>${esc(o.label)}</button>`).join('')}${cancel}</div>`;
    } else if (p.kind === 'info') {
      body += `<div class="cards">${(p.cards || []).map((c) => `<div class="card" style="background-image:url(${art(c.id)})" data-zoom="${c.id}" title="${esc(cname(c.id))}"></div>`).join('') || '<span>(no cards)</span>'}</div><div class="opts"><button class="btn primary" data-v="true">Got it</button></div>`;
    } else if (p.kind === 'roll') {
      body += `<div class="opts"><button class="btn primary roll-btn" data-v="true"><span class="die">${dieHtml(5)}</span>Roll the die</button></div>`;
    } else if (p.kind === 'say') {
      body += `<textarea maxlength="240" ${p.exact ? 'readonly' : ''}>${esc(p.prefill || '')}</textarea>
        <div class="opts"><button class="btn primary" data-say>${p.spoken ? 'I said it' : 'Done'}</button>${p.allowRefuse ? `<button class="btn" data-v='"refuse"' ${p.refuseDisabled ? 'disabled' : ''}>${esc(p.refuseLabel || 'Refuse')}${p.refuseDisabled ? '<span class="why">You can’t afford to refuse</span>' : ''}</button>` : ''}${cancel}</div>`;
    }
    if (p.endsAt) body += `<div class="bar"><i data-bar="${p.endsAt}" data-total="${(p.timeoutSec || 30) * 1000}"></i></div>`;
    el.innerHTML = body;
    el.dataset.id = p.id;
    const ta = $('textarea', el);
    if (ta && !p.exact) { ta.focus(); ta.select(); }
  }
  $('#prompt').addEventListener('click', (e) => {
    const el = $('#prompt');
    const id = Number(el.dataset.id);
    const z = e.target.closest('[data-zoom]');
    if (z) { zoomCard(z.dataset.zoom); return; }
    const b = e.target.closest('[data-v]');
    if (b && !b.disabled) { answer(id, JSON.parse(b.dataset.v)); return; }
    if (e.target.closest('[data-say]')) answer(id, $('textarea', el).value);
  });
  async function answer(id, value) {
    const el = $('#prompt');
    el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const r = await send('answer', { id, value });
    if (r.error) { shownPromptKey = ''; render(); }
  }

  // ───────── negotiation ─────────
  function renderNeg() {
    const g = G();
    const el = $('#neg');
    if (g.phase !== 'negotiation' || !meP()) {
      el.classList.add('hidden');
      if (negBuiltFor && chatForNeg && activeTab === 'chat') showTab('log');
      negBuiltFor = null; chatForNeg = false;
      return;
    }
    el.classList.remove('hidden');
    const me = meP();
    const others = g.players.filter((p) => p.pid !== me.pid);
    const sig = g.round + ':' + others.map((p) => p.pid).join(',');
    if (negBuiltFor !== sig) {
      negBuiltFor = sig;
      if (activeTab !== 'chat') { showTab('chat'); chatForNeg = true; } // deals happen in chat, so keep it in view
      el.innerHTML = `<h2><img src="/art/hourglass.png" alt="">Negotiation <span class="t" data-ends="${g.negotiation.endsAt}"></span></h2>
        <p><b>Nothing is binding.</b> Each player can receive at most 400 gold.</p>
        <div class="give"><select id="give-to">${others.map((p) => `<option value="${p.pid}">${esc(p.name)}</option>`).join('')}</select>
        <select id="give-amt">${[100, 200, 300, 400].map((v) => `<option value="${v}">${v}</option>`).join('')}</select><button class="btn" id="give-btn">Give</button></div>
        <p class="small">Click a card in your hand to swap it or discard it as part of a deal.</p>
        <button class="btn primary" id="neg-ready"></button><div class="ready" id="neg-who"></div>`;
      $('#give-btn').onclick = () => {
        const to = $('#give-to').value; const amount = Number($('#give-amt').value);
        if (confirm(`Give ${amount} gold to ${pname(to)}?`)) send('neg:give', { to, amount });
      };
      $('#neg-ready').onclick = () => send('neg:ready', { ready: !G().negotiation.ready.includes(S.room.you) });
    }
    $('.t', el).dataset.ends = g.negotiation.endsAt;
    const ready = g.negotiation.ready;
    const iReady = ready.includes(S.room.you);
    $('#neg-ready').textContent = iReady ? '✓ Done (click to keep negotiating)' : 'I’m done negotiating';
    $('#neg-ready').classList.toggle('on', iReady);
    const humans = g.players.filter((p) => !p.isBot && !p.auto && p.connected);
    $('#neg-who').textContent = `Done: ${humans.filter((p) => ready.includes(p.pid)).map((p) => p.name).join(', ') || 'nobody yet'}. Ends early when everyone is done.`;
  }

  // ───────── log & chat ─────────
  let logKey = '';
  let lastLogI = -1;
  function renderLog() {
    const el = $('#log');
    const list = G().log;
    const key = list.length ? list[list.length - 1].i + ':' + list.length : '0';
    if (key === logKey) return;
    logKey = key;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const firstPaint = lastLogI < 0;
    el.innerHTML = list.map((e) => `<div class="e ${e.kind} ${!firstPaint && e.i > lastLogI ? 'new' : ''}">${esc(e.kind === 'round' ? e.text.replace(/━+\s?/g, '').trim() : e.text)}</div>`).join('');
    if (list.length) lastLogI = list[list.length - 1].i;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderSideChat() {
    const list = G().chat;
    renderChat($('#chat-log'), list);
    const last = list.length ? list[list.length - 1].i + 1 : 0;
    if (activeTab === 'chat') chatSeen = last;
    const unread = last - chatSeen;
    $('#chat-badge').textContent = unread;
    $('#chat-badge').classList.toggle('hidden', unread <= 0);
  }
  let chatForNeg = false;
  function showTab(name, focus) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    $('#log').classList.toggle('hidden', name !== 'log');
    $('#chat').classList.toggle('hidden', name !== 'chat');
    if (name === 'chat' && G()) { renderSideChat(); if (focus) $('#chat input').focus(); }
  }
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    chatForNeg = false; // the player chose a tab themselves
    showTab(t.dataset.tab, true);
  });

  // ───────── announcements (round, new King, negotiation, your turn) ─────────
  let seen = null;
  const banners = [];
  let bannerBusy = false;
  function announce() {
    const g = G();
    const king = (g.players.find((p) => p.isKing) || {}).pid || null;
    const cur = { round: g.round, king, turn: g.turn ? g.turn.pid : null, phase: g.phase };
    if (seen && g.phase !== 'over') {
      if (cur.round && cur.round !== seen.round) banner('Round', WORDS[cur.round - 1], cur.round % 2 ? 'Clockwise' : 'Counter-clockwise');
      if (king && seen.king && king !== seen.king) banner('Long live the King', pname(king), '', true);
      if (cur.phase === 'negotiation' && seen.phase !== 'negotiation') banner('Negotiation', 'Make your deals', 'Nothing is binding');
      if (cur.turn === S.room.you && seen.turn !== S.room.you) banner('', 'Your turn', '');
    }
    seen = cur;
  }
  function banner(small, big, sub, crown) {
    if (reduceMotion) return;
    banners.push({ small, big, sub, crown });
    if (banners.length > 3) banners.splice(0, banners.length - 3);
    if (!bannerBusy) nextBanner();
  }
  function nextBanner() {
    const b = banners.shift();
    const el = $('#banner');
    if (!b) { bannerBusy = false; el.classList.add('hidden'); return; }
    bannerBusy = true;
    el.innerHTML = `<div class="band ${b.crown ? 'red' : ''}">${b.crown ? icon('crown') : ''}<div>${b.small ? `<small>${esc(b.small.toUpperCase())}</small>` : ''}<b>${esc(b.big.toUpperCase())}</b>${b.sub ? `<small>${esc(b.sub.toUpperCase())}</small>` : ''}</div></div>`;
    el.classList.remove('hidden');
    setTimeout(nextBanner, 2150);
  }

  // ───────── top actions ─────────
  $('#guide-btn').onclick = () => guide.openMenu();
  $('#skip').onclick = () => { if (confirm('Answer every open question with its default choice?')) send('host:skip'); };
  $('#auto-me').onclick = () => { const me = meP(); send('auto', { on: !(me && me.auto) }); };
  $('#table').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) return zoomCard(z.dataset.zoom);
    const s = e.target.closest('[data-seat]');
    if (s && isHost() && s.dataset.seat !== S.room.you) {
      const p = P(s.dataset.seat);
      if (p && !p.isBot) openModal('seat', `<h2>${esc(p.name)}</h2><p>Autopilot lets the computer play for a player who is away.</p><button class="btn primary" data-auto="${p.pid}">${p.auto ? 'Turn autopilot off' : 'Turn autopilot on'}</button>`, (ev) => {
        const b = ev.target.closest('[data-auto]');
        if (b) { send('auto', { target: b.dataset.auto, on: !p.auto }); closeModal(); }
      });
    }
  });

  // ───────── modal ─────────
  let modalKind = null;
  function openModal(kind, html, onClick) {
    modalKind = kind;
    $('#modal-box').innerHTML = `<button class="close" aria-label="Close">×</button>${html}`;
    $('#modal').classList.remove('hidden');
    $('#modal-box').onclick = (e) => {
      if (e.target.closest('.close')) return closeModal();
      const z = e.target.closest('[data-zoom]');
      if (z && kind !== 'zoom') return zoomCard(z.dataset.zoom);
      if (onClick) onClick(e);
    };
  }
  function closeModal() { $('#modal').classList.add('hidden'); modalKind = null; }
  function closeModalIf(kind) { if (modalKind === kind) closeModal(); }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  function zoomCard(id) {
    const d = catalog[id] || {};
    openModal('zoom', `<div class="zoom"><img src="${art(id)}" alt="${esc(d.name || id)}"><div class="actions"><h2>${esc(d.name || id)}</h2><div class="dots"></div><div class="fine">${d.deck === 'king' ? 'King card' : 'Noble card'} · ${d.copies || '?'} in the deck</div><div class="text">${esc(d.text || '')}</div></div></div>`);
  }

  function showGameOver() {
    if (modalKind === 'over' || modalKind === 'over-closed') return;
    const g = G();
    const rows = g.players.slice().sort((a, b) => b.gold - a.gold).map((p) => `<tr class="${p.pid === g.winner ? 'win' : ''}"><td>${esc(p.name)}${p.isKing ? ' · King' : ''}</td><td>${p.gold} gold</td></tr>`).join('');
    openModal('over', `<div class="over"><div class="stage">${figure(true, g.winner)}${icon('crown')}</div><div class="winner">${esc(pname(g.winner))} wins</div><div class="dots"></div><p>${g.winner === S.room.you ? 'Long live the King. You were evil enough.' : 'They ended the game wearing the One Crown.'}</p><table>${rows}</table>${isHost() ? '<button class="btn primary" data-lobby>Back to the lobby</button>' : '<p class="muted">The host can start a new game.</p>'}</div>`, (e) => {
      if (e.target.closest('[data-lobby]')) { send('host:lobby'); closeModal(); }
    });
    const close = $('#modal-box .close');
    close.onclick = () => { closeModal(); modalKind = 'over-closed'; };
  }

  // ───────── rules ─────────
  // The rules never list the whole deck (discovering cards is part of the fun);
  // during a game they collect the cards you have actually seen.
  const seenCards = new Set();
  function collectSeen() {
    const g = G();
    for (const c of g.hand) seenCards.add(c.id);
    if (g.resolving) seenCards.add(g.resolving.cardId);
    for (const d of ['king', 'noble']) if (g.decks[d].top) seenCards.add(g.decks[d].top);
    for (const p of g.players) for (const f of p.faceDown) if (f.known) seenCards.add(f.known);
    for (const pr of g.prompts) { for (const c of pr.cards || []) seenCards.add(c.id); if (pr.offered) seenCards.add(pr.offered.id); }
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="rules"]')) showRules(); });
  function showRules() {
    const inGame = !!S.game;
    const seenList = [...seenCards].map((id) => catalog[id]).filter(Boolean)
      .sort((a, b) => (a.deck === b.deck ? a.name.localeCompare(b.name) : a.deck === 'noble' ? -1 : 1));
    const kinds = Object.keys(catalog).length;
    const cards = inGame
      ? `<h3>Cards you’ve seen this game <span class="muted">(${seenList.length} of ${kinds} kinds)</span></h3>
         ${seenList.length ? `<div class="gallery">${seenList.map((c) => `<figure><img src="${art(c.id)}" alt="${esc(c.name)}" data-zoom="${c.id}" loading="lazy"><figcaption>${esc(c.name)}</figcaption></figure>`).join('')}</div>` : '<p class="muted">None yet.</p>'}
         <p class="muted">The rest stay a surprise. Click any card on the table or in your hand to read it.</p>`
      : '<h3>The cards</h3><p>There are 99 cards: 74 Noble cards and 25 King cards. Finding out what they do is part of the fun, so they aren’t listed here. During a game, <b>click any card</b> to read it, and the cards you have seen collect on this page.</p>';
    openModal('rules', `<div class="rules"><h2>How to play</h2><div class="dots"></div>
      ${inGame ? '<div class="rules-actions"><button class="btn primary" data-rules="tour">Take the visual tour</button></div>' : ''}
      <div class="short"><b>The short version</b><ol>
        <li><b>Be The King when round four ends.</b> That’s the only way to win.</li>
        <li><b>Get more gold than the King</b> and you instantly take the crown (and their seat).</li>
        <li>On your turn, <b>play 2 cards</b> (the King plays 3). Each card says what it does.</li>
        <li>Between rounds, <b>negotiate</b>: trade gold and cards, make promises, break them.</li>
      </ol></div>
      <h3>Setup</h3><ul><li>${MIN_PLAYERS} to ${MAX_PLAYERS} players. One random player is The King with 1000 gold; Nobles start with 600.</li><li>Everyone holds 8 cards: the King draws King cards, Nobles draw Noble cards.</li></ul>
      <h3>Each round</h3><ul><li><b>Playing:</b> The King goes first and plays 3 cards (2 if there are only 3 nobles), then each Noble plays 2. Rounds 1 and 3 go clockwise, rounds 2 and 4 counter-clockwise. After playing you draw back up.</li>
      <li><b>Negotiation</b> (not after round 4): up to 2 minutes to trade gold (you can receive at most 400), exchange cards one-for-one, and make deals. Nothing is binding, so lie freely.</li></ul>
      <h3>Betrayal, Knights and bluffs</h3><ul>
      <li><b>Betrayal</b> takes <b>all</b> the gold of another noble, but only if someone else speaks up to support it right after it’s played. Not allowed in round one.</li>
      <li>A <b>Knight</b> is a card you place face down. It blocks the next Betrayal against the player it sits in front of, then it’s used up. The King can place Knights in front of nobles to protect them.</li>
      <li>You can place <b>any</b> card face down and say it’s a Knight. Nobody can tell. A fake one blocks nothing, but it can scare off a Betrayal, and it uses up a play without triggering the card.</li></ul>
      <h3>Good to know</h3><ul><li>Cards with a dotted line: choose ONE of the two options.</li><li>Gold stays between 0 and 2000. At 0 you keep playing.</li>
      <li>Betrayal cards need vocal support from other players after they are played, or they do nothing. Not playable in round 1.</li>
      <li>Any card can be placed face down and claimed to be a Knight. Only a real Knight blocks a Betrayal. Placing one counts as a card played.</li>
      <li>When a player becomes King they swap seats and hands with the old King. Face-down Knights stay at their seat.</li>
      <li>If two players pass the King at once, they roll: the lower roll loses 100.</li>
      <li>You always hold at least 8 cards. Nobles can’t hold King cards and vice versa.</li>
      <li>The “bank” is an infinite pile of gold.</li></ul>
      <p class="muted">Spoken parts of cards (praise the King, pledge loyalty, the Royal Parrot…) are typed into the game. Say them out loud on your call too!</p>
      ${cards}
      <p class="muted" style="margin-top:14px">Fan-made online edition of One King One Crown by Yancey Intl., used under CC BY-NC-SA 4.0. Support the creators: <a href="https://onecrown.store/" target="_blank" rel="noopener">onecrown.store</a></p></div>`, (e) => {
      if (e.target.closest('[data-rules="tour"]')) { closeModal(); guide.startTour(); }
    });
  }

  // ───────── timers ─────────
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-ends]')) {
      const left = Math.max(0, Math.ceil((Number(el.dataset.ends) - now()) / 1000));
      el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }
    for (const el of document.querySelectorAll('[data-bar]')) {
      const left = Math.max(0, Number(el.dataset.bar) - now());
      el.style.width = Math.min(100, (left / Number(el.dataset.total)) * 100) + '%';
    }
  }, 250);
  window.addEventListener('resize', () => { if (G()) renderSeats(); });

  if (!session) show('home');
})();
