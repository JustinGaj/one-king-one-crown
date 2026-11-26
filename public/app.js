/* One King One Crown — browser client */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const socket = io({ transports: ['websocket', 'polling'] });
  const STORE = 'okoc-session';

  let S = { room: null, game: null };
  let catalog = {};
  let clockSkew = 0;
  let session = load();
  let shownPromptKey = '';
  let lastRollN = 0;
  let prevGold = {};
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
  socket.on('disconnect', () => toast('Connection lost — reconnecting…', 4000));
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
  function backFor(deck) { return deck === 'king' ? '/art/back-king.png' : '/art/back-noble.png'; }

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

  // ───────── lobby ─────────
  $('#copy-link').onclick = () => {
    const url = location.origin + '/?room=' + S.room.code;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied!'), () => prompt('Copy this link:', url));
  };
  $('#add-bot').onclick = () => send('host:addBot');
  $('#start').onclick = () => send('host:start');
  $('#neg-seconds').onchange = (e) => send('host:settings', { negotiationSeconds: Number(e.target.value) });
  $('#leave').onclick = async () => { const r = await send('leave'); if (!r.error) { save(null); S = { room: null, game: null }; history.replaceState(null, '', '/'); show('home'); } };
  document.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-chat]')) return;
    e.preventDefault();
    const inp = $('input', e.target);
    if (inp.value.trim()) send('chat', { text: inp.value });
    inp.value = '';
  });

  function renderLobby() {
    const r = S.room;
    $('#room-code').textContent = r.code;
    $('#members').innerHTML = r.members.map((m) => `
      <li><span class="dot ${m.connected ? '' : 'off'}"></span><span class="who">${esc(m.name)}${m.pid === r.host ? ' 👑 host' : ''}${m.isBot ? ' 🤖' : ''}${m.pid === r.you ? ' (you)' : ''}</span>
      ${isHost() && m.pid !== r.you ? `<button class="link" data-kick="${m.pid}">remove</button>` : ''}</li>`).join('');
    $('#host-controls').classList.toggle('hidden', !isHost());
    $('#neg-seconds').value = String(r.settings.negotiationSeconds);
    $('#start').disabled = r.members.length < 4;
    const n = r.members.length;
    $('#lobby-wait').textContent = n < 4 ? `${n}/8 players — you need at least 4 (bots can fill seats).` : `${n}/8 players. ${isHost() ? 'Start when everyone is here.' : 'Waiting for the host to start…'}`;
    renderChat($('#lobby-chat-log'), r.chat);
  }
  $('#members').addEventListener('click', (e) => { const k = e.target.dataset.kick; if (k) send('host:kick', { target: k }); });

  function renderChat(el, list) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = list.map((m) => `<div class="m"><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // ───────── game: main render ─────────
  function render() {
    if (!S.room) return;
    if (!S.game) { show('lobby'); renderLobby(); closeModalIf('over'); return; }
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
    if (G().phase === 'over') showGameOver();
  }

  function renderTop() {
    const g = G();
    $('#tracker').innerHTML = ['ONE', 'TWO', 'THREE', 'FOUR'].map((w, i) => {
      const r = i + 1;
      return `<div class="r ${r === g.round ? 'now' : r < g.round ? 'done' : ''}" title="Round ${w}: ${r % 2 ? 'clockwise' : 'counter-clockwise'}"><span>ROUND</span><b>${w}</b><span>${r % 2 ? '↻' : '↺'}</span></div>`;
    }).join('');
    let txt = '';
    if (g.phase === 'starting') txt = 'Dealing…';
    else if (g.phase === 'over') txt = '🏆 Game over';
    else if (g.phase === 'negotiation') txt = `Negotiation phase <span class="timer" data-ends="${g.negotiation.endsAt}"></span>`;
    else if (g.turn) txt = g.turn.pid === S.room.you ? `<span class="yourturn">Your turn</span> — ${g.turn.playsLeft} card${g.turn.playsLeft === 1 ? '' : 's'} left to play` : `${esc(pname(g.turn.pid))}'s turn (${g.turn.playsLeft} left)`;
    $('#phase').innerHTML = txt;
    $('#skip').classList.toggle('hidden', !isHost() || !g.waiting.length || g.phase === 'over');
    const me = meP();
    $('#auto-me').classList.toggle('on', !!(me && me.auto));
    $('#auto-me').textContent = me && me.auto ? 'Autopilot ON' : 'Autopilot';
  }

  function goldGrid(gold) {
    let h = '<div class="mini-grid" aria-hidden="true">';
    for (let v = 0; v <= 2000; v += 100) h += `<i class="${v === gold ? 'tok' : ''}"></i>`;
    return h + '</div>';
  }

  function renderSeats() {
    const g = G();
    const table = $('#table');
    const n = g.players.length;
    const me = meP();
    const mySeat = me ? me.seat : 0;
    const waitingOn = new Map();
    for (const w of g.waiting) if (!waitingOn.has(w.pid)) waitingOn.set(w.pid, w.title);
    const wide = table.clientWidth;
    const rx = wide < 600 ? 33 : 41;
    const ry = wide < 600 ? 40 : 37;
    let html = '';
    for (const p of g.players) {
      const a = Math.PI / 2 + ((p.seat - mySeat) * 2 * Math.PI) / n;
      const x = 50 + rx * Math.cos(a);
      const y = 50 + ry * Math.sin(a);
      const delta = prevGold[p.pid] !== undefined && prevGold[p.pid] !== p.gold ? p.gold - prevGold[p.pid] : 0;
      const bets = p.bets.map((b) => `<span class="chip bet" title="${b.type === 'scout' ? 'Scout' : 'Hindsight'}: deadline end of round ${b.deadline}">${b.type === 'scout' ? '🔭 Scout' : '🔮 Hindsight'} → ${esc(pname(b.target))}</span>`).join('');
      const st = p.statuses.map((s) => `<span class="chip" title="${esc(s.label)}">${esc(s.label)}</span>`).join('');
      const bb = g.badBlood.filter((b) => b.owner === p.pid).map((b) => `<span class="chip" title="Bad Blood: +200 each round until ${esc(pname(b.a))} or ${esc(pname(b.b))} pays the other 200">🩸 ${esc(pname(b.a))} × ${esc(pname(b.b))}</span>`).join('');
      const dbt = g.debts.filter((d) => d.debtor === p.pid).map((d) => `<span class="chip" title="Pays ${esc(pname(d.owner))} 100 at the start of every round">⛓ owes ${esc(pname(d.owner))}</span>`).join('');
      const wt = waitingOn.has(p.pid) ? `<span class="chip wait" title="${esc(waitingOn.get(p.pid))}">⏳ deciding…</span>` : '';
      html += `<div class="seat ${p.isKing ? 'king' : ''} ${g.turn && g.turn.pid === p.pid ? 'turn' : ''} ${p.pid === S.room.you ? 'me' : ''}" style="left:${x}%;top:${y}%" data-seat="${p.pid}">
        <div class="top">${p.isKing ? '<span class="crown" title="The King"></span>' : ''}<span class="nm" title="${esc(p.name)}">${esc(p.name)}${p.pid === S.room.you ? ' (you)' : ''}</span>
          <span class="flags">${p.isBot ? '🤖' : p.auto ? '<span title="Autopilot">🤖</span>' : ''}<span class="${p.connected || p.isBot ? 'on' : 'off'}" title="${p.connected ? 'online' : 'offline'}"></span></span></div>
        <div class="goldline">${goldGrid(p.gold)}<span class="gold">${p.gold}<small>gold</small></span>${delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>` : ''}</div>
        <div class="row2"><span class="mini-back" style="background-image:url(${backFor(p.isKing ? 'king' : 'noble')})"></span> ${p.handCount} cards${p.isKing ? ' · THE KING' : ''}</div>
        ${p.faceDown.length ? `<div class="fd">${p.faceDown.map((f) => `<span class="k ${f.known ? 'known' : ''}" style="background-image:url(${backFor(f.deck)})" title="${f.known ? 'You know this is: ' + esc(cname(f.known)) : 'Face-down card — claimed to be a Knight'}"></span>`).join('')}</div>` : ''}
        ${bets || st || bb || dbt || wt ? `<div class="chips">${wt}${st}${bets}${bb}${dbt}</div>` : ''}
      </div>`;
    }
    for (const el of [...table.querySelectorAll('.seat')]) el.remove();
    table.insertAdjacentHTML('beforeend', html);
    for (const p of g.players) prevGold[p.pid] = p.gold;
  }

  function dieHtml(v) {
    const pips = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
    return Array.from({ length: 9 }, (_, i) => `<i style="visibility:${pips.includes(i) ? 'visible' : 'hidden'}"></i>`).join('');
  }

  function renderCenter() {
    const g = G();
    const pile = (deck, label) => {
      const d = g.decks[deck];
      return `<div class="pile"><div class="c" style="background-image:url(${backFor(deck)})" title="${label} deck"></div>${label} · ${d.draw}</div>
        <div class="pile">${d.top ? `<div class="c" style="background-image:url(${art(d.top)})" data-zoom="${d.top}" title="Top of the ${label} discard pile"></div>` : '<div class="c empty"></div>'}discard · ${d.discard}</div>`;
    };
    const lr = g.lastRoll;
    const resolving = g.resolving ? `<div class="resolving"><img src="${art(g.resolving.cardId)}" alt="${esc(cname(g.resolving.cardId))}" data-zoom="${g.resolving.cardId}">${esc(pname(g.resolving.pid))}</div>` : '';
    const neg = g.phase === 'negotiation' ? `<div class="resolving"><img src="/art/hourglass.png" alt="" style="width:120px;background:#fff">Negotiate!</div>` : '';
    $('#center').innerHTML = `${pile('king', 'King')}
      ${resolving || neg}
      <div class="dice-box">${lr ? `<div class="die ${lr.n !== lastRollN ? 'roll' : ''}">${dieHtml(lr.value)}</div>${esc(pname(lr.pid))} rolled ${lr.value}` : '<div class="die">' + dieHtml(0) + '</div>'}</div>
      ${pile('noble', 'Noble')}`;
    if (lr) lastRollN = lr.n;
    const others = g.waiting.filter((w) => w.pid !== S.room.you);
    let w = $('#table .waiting');
    if (!w) { w = document.createElement('div'); w.className = 'waiting'; $('#table').appendChild(w); }
    const uniq = [...new Map(others.map((x) => [x.pid, x])).values()];
    w.textContent = uniq.length ? `Waiting for ${uniq.slice(0, 4).map((x) => x.name).join(', ')}${uniq.length > 4 ? '…' : ''}` : '';
  }

  function renderMe() {
    const g = G();
    const me = meP();
    if (!me) { $('#me-info').innerHTML = '<span class="muted">Spectating</span>'; return; }
    const parts = [`<span class="role">${me.isKing ? '👑 The King' : 'Noble'}</span>`, `<span><span class="big">${me.gold}</span> gold</span>`];
    if (g.turn && g.turn.pid === me.pid) parts.push(`<span class="yourturn">Your turn: play ${g.turn.playsLeft} more card${g.turn.playsLeft === 1 ? '' : 's'}</span>`);
    else if (g.phase === 'play' && g.turn) parts.push(`<span class="muted">Waiting for ${esc(pname(g.turn.pid))}…</span>`);
    for (const b of g.badBlood) if (b.a === me.pid || b.b === me.pid) {
      const other = b.a === me.pid ? b.b : b.a;
      parts.push(`<button class="btn small" data-bb="${b.id}" ${me.gold < 200 ? 'disabled' : ''} title="Ends ${esc(pname(b.owner))}'s Bad Blood">Give ${esc(pname(other))} 200 (end Bad Blood)</button>`);
    }
    for (const d of g.debts) if (d.debtor !== me.pid && d.owner !== me.pid) parts.push(`<button class="btn small" data-debt="${d.id}" ${me.gold < 200 ? 'disabled' : ''}>Pay ${esc(pname(d.owner))} 200 to free ${esc(pname(d.debtor))}</button>`);
    for (const s of me.statuses) parts.push(`<span class="chip">${esc(s.label)}</span>`);
    if (g.phase !== 'over') parts.push('<span class="muted" style="margin-left:auto">Click a card to play it or place it face down as a “Knight”.</span>');
    $('#me-info').innerHTML = parts.join('');
  }
  $('#me-info').addEventListener('click', (e) => {
    const bb = e.target.closest('[data-bb]'); if (bb) send('badBlood', { id: Number(bb.dataset.bb) });
    const d = e.target.closest('[data-debt]'); if (d) send('freeDebt', { id: Number(d.dataset.debt) });
  });

  function renderHand() {
    const g = G();
    const myTurn = g.turn && g.turn.pid === S.room.you && g.turn.canPlay;
    $('#hand').innerHTML = g.hand.map((c) => {
      const note = c.faceDownOnly ? 'face down only' : c.reason ? (catalog[c.id] && catalog[c.id].reactionOnly ? 'reaction' : 'not now') : '';
      return `<div class="card ${myTurn && !c.playable && !c.faceDownOnly ? 'dim' : ''}" style="background-image:url(${art(c.id)})" data-card="${c.uid}" title="${esc(cname(c.id))}" role="button" tabindex="0">${myTurn && note ? `<span class="tagline">${note}</span>` : ''}</div>`;
    }).join('') || '<span class="muted">No cards.</span>';
  }
  $('#hand').addEventListener('click', (e) => { const el = e.target.closest('[data-card]'); if (el) openCard(Number(el.dataset.card)); });
  $('#hand').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const el = e.target.closest('[data-card]'); if (el) openCard(Number(el.dataset.card)); } });

  // ───────── card actions ─────────
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
        acts += '<div class="muted" style="font-size:12px">A face-down card counts as a card played. Only a real Knight protects against Betrayal.</div>';
      }
    } else if (g.phase === 'play') {
      acts += `<p class="muted">${g.turn && g.turn.pid === S.room.you ? 'Wait for the current card to finish.' : 'You can play cards on your turn.'}</p>`;
    }
    if (g.phase === 'negotiation') {
      const nobles = g.players.filter((p) => !p.isKing && p.pid !== me.pid);
      if (c.id === 'royal-bomb') {
        acts += `<h3>Royal Bomb</h3><div class="opts">${nobles.map((p) => `<button class="btn" data-act="bomb-give" data-target="${p.pid}">Give to ${esc(p.name)}</button>`).join('')}<button class="btn" data-act="bomb-discard">Discard it</button></div>`;
      }
      if (!me.isKing) acts += `<h3>Offer an exchange to…</h3><div class="opts">${nobles.map((p) => `<button class="btn" data-act="trade" data-target="${p.pid}">${esc(p.name)}</button>`).join('') || '<span class="muted">No other nobles.</span>'}</div><div class="muted" style="font-size:12px">They pick one of their cards to give back (or decline).</div>`;
      acts += `<h3>Discard as part of a deal with…</h3><div class="opts">${g.players.filter((p) => p.pid !== me.pid).map((p) => `<button class="btn" data-act="deal" data-target="${p.pid}">${esc(p.name)}</button>`).join('')}</div><div class="muted" style="font-size:12px">You may only discard as part of a deal; they must confirm. You draw a replacement.</div>`;
    }
    openModal('card', `<div class="zoom"><img src="${art(c.id)}" alt="${esc(def.name || c.id)}"><div class="actions"><h2>${esc(def.name || c.id)}</h2>${def.text ? `<div class="muted" style="color:#444;font-size:13px">${esc(def.text)}</div>` : ''}${acts}</div></div>`, async (e) => {
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
    let body = `${g.prompts.length > 1 ? `<span class="count">+${g.prompts.length - 1} more</span>` : ''}<h2>${esc(p.title)}</h2>${p.text ? `<p>${esc(p.text)}</p>` : ''}`;
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
      body += `<div class="opts"><button class="btn primary roll-btn" data-v="true">🎲 Roll the die</button></div>`;
    } else if (p.kind === 'say') {
      body += `<textarea maxlength="240" ${p.exact ? 'readonly' : ''}>${esc(p.prefill || '')}</textarea>
        ${p.exact ? '<p style="font-size:12px">Say it out loud on your call, too!</p>' : ''}
        <div class="opts"><button class="btn primary" data-say>🗣 ${p.exact ? 'Say it' : 'Say it'}</button>${p.allowRefuse ? `<button class="btn" data-v='"refuse"' ${p.refuseDisabled ? 'disabled' : ''}>${esc(p.refuseLabel || 'Refuse')}${p.refuseDisabled ? '<span class="why">You can’t afford to refuse</span>' : ''}</button>` : ''}${cancel}</div>`;
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
    if (g.phase !== 'negotiation' || !meP()) { el.classList.add('hidden'); negBuiltFor = null; return; }
    el.classList.remove('hidden');
    const me = meP();
    const others = g.players.filter((p) => p.pid !== me.pid);
    const sig = g.round + ':' + others.map((p) => p.pid).join(',');
    if (negBuiltFor !== sig) {
      negBuiltFor = sig;
      el.innerHTML = `<h2><img src="/art/hourglass.png" alt="">Negotiation <span class="t" data-ends="${g.negotiation.endsAt}"></span></h2>
        <p>Trade gold, exchange cards, win support for a Betrayal. <b>No deal is binding.</b> A player can receive at most 400 gold per phase.</p>
        <div class="give"><select id="give-to">${others.map((p) => `<option value="${p.pid}">${esc(p.name)}</option>`).join('')}</select>
        <select id="give-amt">${[100, 200, 300, 400].map((v) => `<option value="${v}">${v}</option>`).join('')}</select><button class="btn" id="give-btn">Give</button></div>
        <p>Click a card in your hand to offer an exchange or a deal discard.</p>
        <button class="btn primary" id="neg-ready"></button><div class="ready" id="neg-who"></div>`;
      $('#give-btn').onclick = () => {
        const to = $('#give-to').value; const amount = Number($('#give-amt').value);
        if (confirm(`Give ${amount} gold to ${pname(to)}?`)) send('neg:give', { to, amount });
      };
      $('#neg-ready').onclick = () => send('neg:ready', { ready: !g.negotiation.ready.includes(S.room.you) });
    }
    $('.t', el).dataset.ends = g.negotiation.endsAt;
    const ready = G().negotiation.ready;
    const iReady = ready.includes(S.room.you);
    $('#neg-ready').textContent = iReady ? '✓ Done — click to keep negotiating' : 'I’m done negotiating';
    $('#neg-ready').classList.toggle('on', iReady);
    const humans = g.players.filter((p) => !p.isBot && !p.auto && p.connected);
    $('#neg-who').textContent = `Done: ${humans.filter((p) => ready.includes(p.pid)).map((p) => p.name).join(', ') || 'nobody yet'} — ends early when everyone is done.`;
  }

  // ───────── log & chat ─────────
  let logCount = 0;
  function renderLog() {
    const el = $('#log');
    const list = G().log;
    const key = list.length ? list[list.length - 1].i + ':' + list.length : '0';
    if (key === logCount) return;
    logCount = key;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    el.innerHTML = list.map((e) => `<div class="e ${e.kind}">${esc(e.text)}</div>`).join('');
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
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    activeTab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#log').classList.toggle('hidden', activeTab !== 'log');
    $('#chat').classList.toggle('hidden', activeTab !== 'chat');
    if (activeTab === 'chat') { renderSideChat(); $('#chat input').focus(); }
  });

  // ───────── top actions ─────────
  $('#skip').onclick = () => { if (confirm('Answer every open question with its default choice?')) send('host:skip'); };
  $('#auto-me').onclick = () => { const me = meP(); send('auto', { on: !(me && me.auto) }); };
  $('#table').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) return zoomCard(z.dataset.zoom);
    const s = e.target.closest('[data-seat]');
    if (s && isHost() && s.dataset.seat !== S.room.you) {
      const p = P(s.dataset.seat);
      if (p && !p.isBot) openModal('seat', `<h2>${esc(p.name)}</h2><p>Autopilot lets the computer play for a player who is away.</p><button class="btn primary" data-auto="${p.pid}">${p.auto ? 'Turn autopilot OFF' : 'Turn autopilot ON'}</button>`, (ev) => {
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
    openModal('zoom', `<div class="zoom"><img src="${art(id)}" alt="${esc(d.name || id)}"><div class="actions"><h2>${esc(d.name || id)}</h2><div>${d.deck === 'king' ? 'King card' : 'Noble card'} · ${d.copies || '?'} in the deck</div><div class="muted" style="color:#444">${esc(d.text || '')}</div></div></div>`);
  }

  function showGameOver() {
    if (modalKind === 'over' || modalKind === 'over-closed') return;
    const g = G();
    const rows = g.players.slice().sort((a, b) => b.gold - a.gold).map((p) => `<tr><td>${p.isKing ? '👑 ' : ''}${esc(p.name)}</td><td>${p.gold} gold</td></tr>`).join('');
    openModal('over', `<div class="over"><img src="/art/character-king.png" alt="" style="width:110px;border-radius:8px"><div class="winner">${esc(pname(g.winner))} wins!</div><p>${g.winner === S.room.you ? 'Long live the King. You were evil enough.' : 'They ended the game wearing the One Crown.'}</p><table>${rows}</table>${isHost() ? '<button class="btn primary" data-lobby>Back to the lobby</button>' : '<p class="muted">The host can start a new game.</p>'}</div>`, (e) => {
      if (e.target.closest('[data-lobby]')) { send('host:lobby'); closeModal(); }
    });
    const close = $('#modal-box .close');
    close.onclick = () => { closeModal(); modalKind = 'over-closed'; };
  }

  // ───────── rules ─────────
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="rules"]')) showRules(); });
  function showRules() {
    const list = Object.values(catalog);
    const gal = (deck) => list.filter((c) => c.deck === deck).map((c) => `<figure><img src="${art(c.id)}" alt="${esc(c.name)}" data-zoom="${c.id}"><figcaption>${esc(c.name)} ×${c.copies}</figcaption></figure>`).join('');
    openModal('rules', `<div class="rules"><h2>How to rule a kingdom</h2>
      <p>4–8 players, 4 rounds. <b>End the game as The King to win.</b> You become King by having <b>more gold than the current King</b> (or through Betray the King / People’s Champion).</p>
      <h3>Setup</h3><ul><li>One random player is The King with 1000 gold; Nobles start with 600.</li><li>Everyone holds 8 cards: the King draws King cards, Nobles draw Noble cards.</li></ul>
      <h3>Each round</h3><ul><li><b>Playing phase:</b> The King goes first and plays 3 cards (2 if there are only 3 nobles), then each Noble plays 2. Round 1 and 3 go clockwise, rounds 2 and 4 counter-clockwise. After playing you draw back up.</li>
      <li><b>Negotiation phase</b> (not after round 4): up to 2 minutes to trade gold (max 400 received per player), exchange cards one-for-one, and make deals. Nothing is binding — lie freely.</li></ul>
      <h3>Rules to remember</h3><ul><li>Cards with a dotted line: choose ONE of the two options.</li><li>Gold stays between 0 and 2000. At 0 you keep playing.</li>
      <li>Betrayal cards need vocal support from other players after they are played, or they do nothing. Not playable in round 1.</li>
      <li>Any card can be placed face down and claimed to be a Knight. Only a real Knight blocks a Betrayal. Placing one counts as a card played.</li>
      <li>When a player becomes King they swap seats and hands with the old King. Face-down Knights stay at their seat.</li>
      <li>If two players pass the King at once, they roll: the lower roll loses 100.</li>
      <li>You always hold at least 8 cards. Nobles can’t hold King cards and vice versa.</li>
      <li>The “bank” is an infinite pile of gold.</li></ul>
      <p class="muted" style="color:#555">Spoken parts of cards (praise the King, pledge loyalty, the Royal Parrot…) are typed into the game — and said out loud on your call!</p>
      <h3>Noble cards (74)</h3><div class="gallery">${gal('noble')}</div><h3>King cards (25)</h3><div class="gallery">${gal('king')}</div>
      <p class="muted" style="color:#555;margin-top:14px">Fan-made online edition of One King One Crown by Yancey Intl., used under CC BY-NC-SA 4.0. Support the creators: <a style="color:#000" href="https://onecrown.store/" target="_blank" rel="noopener">onecrown.store</a></p></div>`);
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
