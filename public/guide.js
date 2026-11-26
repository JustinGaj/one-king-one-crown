/* One King One Crown — first-time guide.
   Each player chooses it for themselves in the lobby. It adds:
   1. a short spotlight tour of the screen before round one (the game waits for it),
   2. one-time tips the first time something happens (your turn, a vote, negotiation…),
   3. a plain-language "what now?" line above your hand. */
(() => {
  'use strict';
  const TIPS_KEY = 'okoc-tips-seen';

  window.createGuide = function createGuide(api) {
    const { $, esc, send, state, cname } = api;
    let tour = null; // { steps, i }
    let tipNow = null; // { id, anchor }
    let tipsSeen = loadTips();
    let tourFinishedFor = null; // game "id" we already sent tour:done for
    let prev = null; // snapshot of the last state the tips looked at

    function loadTips() { try { return new Set(JSON.parse(localStorage.getItem(TIPS_KEY)) || []); } catch (e) { return new Set(); } }
    function saveTips() { try { localStorage.setItem(TIPS_KEY, JSON.stringify([...tipsSeen])); } catch (e) { /* private mode */ } }

    const G = () => state().game;
    const me = () => { const S = state(); return S.game ? S.game.players.find((p) => p.pid === S.room.you) : null; };
    const pname = (pid) => { const g = G(); const p = g && g.players.find((x) => x.pid === pid); return p ? p.name : 'Someone'; };
    const seatEl = (pid) => document.querySelector(`.seat[data-seat="${pid}"] .plate`);
    const kingPid = () => { const g = G(); const k = g && g.players.find((p) => p.isKing); return k ? k.pid : null; };

    function isOn() {
      const S = state();
      if (!S.room) return false;
      if (S.game) { const m = me(); return !!(m && m.learning); }
      const m = S.room.members.find((x) => x.pid === S.room.you);
      return !!(m && m.tutorial);
    }

    // ───────── the tour ─────────
    function steps() {
      const m = me();
      const amKing = m && m.isKing;
      const k = kingPid();
      const list = [
        { title: 'Welcome to the court', body: amKing
          ? 'You start as <b>The King</b>. Everyone else wants your crown. <b>Still be King when round four ends</b> and you win.'
          : 'You are a <b>noble</b>. There is only one crown, and you want it. <b>Be The King when round four ends</b> and you win. Bribe, bluff and betray to get there.',
          art: 'crown' },
        { target: () => m && seatEl(m.pid), title: 'This is you', body: `Your name, your <b>gold</b> and how many cards you hold. The little grid is your character card: the red square marks your gold. ${amKing ? 'The King starts with 1000.' : 'Nobles start with 600.'} Gold always stays between 0 and 2000.` },
      ];
      if (!amKing && k) list.push({ target: () => seatEl(k), title: 'This is The King', body: 'The black plate with the crown. <b>The moment you have more gold than the King, you become King</b>: you swap seats, cards and roles. That is the whole game.' });
      list.push(
        { target: () => $('#hand'), title: 'Your hand', body: `You always hold 8 cards. On your turn, <b>click a card</b> to read it and play it. ${amKing ? 'The King plays 3 cards a turn.' : 'Nobles play 2 cards a turn, the King plays 3.'} Greyed-out cards can't be played right now.` },
        { target: () => $('#hand'), title: 'Betrayal and Knights', body: 'A <b>Betrayal</b> card takes <b>all</b> of another noble’s gold, if someone supports it. A <b>Knight</b> is placed face down and blocks the next Betrayal against that player. You can also place <b>any</b> card face down and claim it’s a Knight: a bluff nobody can see through.' },
        { target: () => $('#tracker'), title: 'Four rounds', body: 'The King always goes first. Turns go <b>clockwise</b> in rounds one and three, <b>counter-clockwise</b> in rounds two and four.' },
        { target: () => $('#center'), title: 'The middle of the table', body: 'Draw piles, discard piles and the die. The card being played shows up here. <b>Click any card</b> on the table to read it.' },
        { title: 'When a card needs you', body: 'A white box slides up from the bottom: pick an option, vote, roll the die or say something. <b>The red bar is your time.</b> If it runs out, a default answer is picked for you.', art: 'prompt' },
        { target: () => $('.side'), title: 'Story and scheming', body: 'The <b>log</b> tells you everything that happens: who played what and who lost gold. The <b>Chat</b> tab is for open scheming. A voice call is even better.' },
        { title: 'Negotiation', body: 'After rounds one to three, everyone gets up to 2 minutes to <b>give gold</b> (you can receive at most 400), <b>swap cards</b> and make promises. <b>Nothing is binding.</b> Lying is part of the game.', art: 'hourglass' },
        { target: () => $('#guide-btn'), title: 'You are ready', body: 'Tips will pop up the first time things happen, and the line above your hand tells you when it’s your move. Open <b>Guide</b> any time to replay this tour or turn the tips off.', last: true },
      );
      return list;
    }

    function startTour() {
      closeTip();
      tour = { steps: steps(), i: 0 };
      drawTour();
    }

    function endTour() {
      tour = null;
      const layer = $('#tour');
      if (layer) layer.remove();
      const g = G();
      if (g && g.phase === 'intro' && tourFinishedFor !== g) { tourFinishedFor = g; send('tour:done'); }
      setTimeout(() => api.rerender(), 0);
    }

    function drawTour() {
      if (!tour) return;
      let layer = $('#tour');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'tour';
        layer.className = 'tour';
        layer.innerHTML = '<div class="spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
        document.body.appendChild(layer);
        layer.addEventListener('click', (e) => {
          const b = e.target.closest('[data-tour]');
          if (!b) return;
          const a = b.dataset.tour;
          if (a === 'next') { if (tour.i < tour.steps.length - 1) { tour.i++; drawTour(); } else endTour(); }
          if (a === 'back' && tour.i > 0) { tour.i--; drawTour(); }
          if (a === 'skip') endTour();
        });
      }
      const st = tour.steps[tour.i];
      const card = $('.tour-card', layer);
      const n = tour.steps.length;
      const g = G();
      const waiting = g && g.phase === 'intro' && g.intro ? g.intro.pending.filter((p) => p !== state().room.you) : [];
      card.innerHTML = `
        <div class="tour-top"><span class="tour-count">${tour.i + 1} / ${n}</span><button class="link" data-tour="skip">Skip tour</button></div>
        ${st.art ? artFor(st.art) : ''}
        <h3>${esc(st.title)}</h3><div class="dots"></div>
        <p>${st.body}</p>
        <div class="tour-progress">${Array.from({ length: n }, (_, i) => `<i class="${i <= tour.i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tour-btns">${tour.i > 0 ? '<button class="btn" data-tour="back">Back</button>' : ''}<button class="btn primary" data-tour="next">${st.last ? (g && g.phase === 'intro' ? 'I’m ready to play' : 'Let’s play') : 'Next'}</button></div>
        ${waiting.length ? `<div class="tour-wait">Also taking the tour: ${waiting.map((p) => esc(pname(p))).join(', ')}</div>` : ''}`;
      card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
      const target = st.target && st.target();
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest', behavior: 'auto' }); // phones scroll
      placeTour();
      const next = $('[data-tour="next"]', card);
      if (next) next.focus({ preventScroll: true });
    }

    function artFor(kind) {
      if (kind === 'crown') return '<div class="tour-art"><span class="hood" style="--w:44px"><span class="eyes"><i></i><i></i></span></span><span class="kfig" style="--w:60px"><span class="eyes"><i></i><i></i></span></span><span class="hood" style="--w:44px"><span class="eyes"><i></i><i></i></span></span></div>';
      if (kind === 'hourglass') return '<div class="tour-art"><img src="/art/hourglass.png" alt="" class="tour-hourglass"></div>';
      if (kind === 'prompt') return '<div class="tour-art"><div class="mock-prompt"><b>WRATH: WHICH NOBLE LOSES 300?</b><div class="dots"></div><span>Lady Byte</span><span>Duke Data</span><span>Count Cog</span><i></i></div></div>';
      return '';
    }

    function placeTour() {
      const layer = $('#tour');
      if (!tour || !layer) return;
      const st = tour.steps[tour.i];
      const el = st.target ? st.target() : null;
      const spot = $('.spot', layer);
      const card = $('.tour-card', layer);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      layer.classList.toggle('no-target', !r);
      if (r) {
        const pad = 8;
        Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      }
      const cw = Math.min(360, vw - 24);
      card.style.width = cw + 'px';
      const ch = card.offsetHeight;
      let x;
      let y;
      if (!r) { x = (vw - cw) / 2; y = Math.max(12, (vh - ch) / 2); }
      else if (r.bottom + 20 + ch < vh) { y = r.bottom + 20; x = r.left + r.width / 2 - cw / 2; }
      else if (r.top - 20 - ch > 0) { y = r.top - 20 - ch; x = r.left + r.width / 2 - cw / 2; }
      else if (r.left - 20 - cw > 0) { x = r.left - 20 - cw; y = r.top + r.height / 2 - ch / 2; }
      else if (r.right + 20 + cw < vw) { x = r.right + 20; y = r.top + r.height / 2 - ch / 2; }
      else { x = (vw - cw) / 2; y = Math.max(12, (vh - ch) / 2); }
      card.style.left = Math.max(12, Math.min(vw - cw - 12, x)) + 'px';
      card.style.top = Math.max(12, Math.min(vh - ch - 12, y)) + 'px';
    }

    // ───────── one-time tips ─────────
    function tip(id, anchor, title, body, data) {
      if (tipsSeen.has(id) || tipNow || tour) return false;
      const el = typeof anchor === 'function' ? anchor() : anchor;
      if (!el) return false;
      tipNow = { id, data, anchor: typeof anchor === 'function' ? anchor : () => el };
      clearTimeout(tip.timer);
      // tips about a passing moment fade on their own; ones that ask you to act stay until done
      if (!/^(prompt|my-turn|negotiation)/.test(id)) tip.timer = setTimeout(() => { if (tipNow && tipNow.id === id) closeTip(); }, 14000);
      tipsSeen.add(id); // each tip shows once, even if the moment passes before 'Got it'
      saveTips();
      let t = $('#tip');
      if (!t) {
        t = document.createElement('div');
        t.id = 'tip';
        t.className = 'tip';
        document.body.appendChild(t);
        t.addEventListener('click', (e) => { if (e.target.closest('[data-tip-ok]')) dismissTip(); });
      }
      t.innerHTML = `<div class="tip-head">TIP</div><h4>${esc(title)}</h4><p>${body}</p><button class="btn small primary" data-tip-ok>Got it</button>`;
      t.classList.remove('hidden', 'enter'); void t.offsetWidth; t.classList.add('enter');
      placeTip();
      return true;
    }
    function dismissTip() { closeTip(); }
    function closeTip() {
      tipNow = null;
      const t = $('#tip');
      if (t) t.classList.add('hidden');
    }
    function placeTip() {
      const t = $('#tip');
      if (!tipNow || !t) return;
      const el = tipNow.anchor();
      if (!el || el.offsetParent === null) { closeTip(); return; }
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const tw = Math.min(300, vw - 24);
      t.style.width = tw + 'px';
      const th = t.offsetHeight;
      let above = r.top - th - 16 > 8;
      let y = above ? r.top - th - 16 : r.bottom + 16;
      if (!above && y + th > window.innerHeight - 8) { y = Math.max(8, r.top + 12); above = false; }
      const x = Math.max(12, Math.min(vw - tw - 12, r.left + r.width / 2 - tw / 2));
      t.style.left = x + 'px';
      t.style.top = y + 'px';
      t.classList.toggle('above', above);
      t.style.setProperty('--ax', Math.max(18, Math.min(tw - 18, r.left + r.width / 2 - x)) + 'px');
    }

    function checkTips() {
      const g = G();
      const S = state();
      const mm = me();
      if (!g || g.phase === 'intro' || g.phase === 'over' || tour || (mm && mm.auto)) { prev = snapshot(); if (mm && mm.auto) closeTip(); return; }
      if (document.querySelector('#modal:not(.hidden)')) { prev = snapshot(); return; }
      const m = me();
      const you = S.room.you;
      const p = g.prompts[0];
      const cur = snapshot();

      // a tip about something that has passed goes away
      if (tipNow && tipNow.id.startsWith('prompt') && !p) closeTip();
      if (tipNow && tipNow.id === 'my-turn' && !(g.turn && g.turn.pid === you)) closeTip();
      if (tipNow && tipNow.id === 'negotiation' && g.phase !== 'negotiation') closeTip();
      if (tipNow && tipNow.id === 'watch' && !(g.turn && g.turn.pid === tipNow.data)) closeTip();
      if (tipNow && tipNow.id !== 'my-turn' && g.turn && g.turn.pid === you && g.turn.canPlay && !p) closeTip(); // your turn matters more

      if (!tipNow && p) {
        const anchor = () => $('#prompt');
        if (/support/i.test(p.title)) tip('prompt-support', anchor, 'Betrayal needs support', 'A Betrayal only works if <b>another player speaks up for it</b>. Support it if you want it to succeed; stay silent to let it fail. Say it on your call too!');
        else if (p.kind === 'roll') tip('prompt-roll', anchor, 'Roll the die', 'Click the button to roll. Everyone sees the result on the die in the middle of the table.');
        else if (p.kind === 'say') tip('prompt-say', anchor, 'Say it out loud', 'Say the line out loud on your call, then press <b>I said it</b>. When refusing costs gold, the player of the card confirms they heard you; if not, it counts as refusing.');
        else if (p.kind === 'cards') tip('prompt-cards', anchor, 'Pick a card', 'Click one of the cards shown in the box.');
        else if (/vote/i.test(p.title) || (p.options || []).some((o) => /^(yes|no)$/i.test(String(o.label)))) tip('prompt-vote', anchor, 'Time to vote', 'Votes stay secret until everyone has answered, then they are shown together.');
        else if (p.cancelable) tip('prompt-own', anchor, 'Finish your card', 'Your card asks you to choose. Changed your mind? <b>Take the card back</b> works until something actually happens.');
        else tip('prompt-choice', anchor, 'A card needs you', 'Someone’s card involves you. Read the box and pick an option before the red bar runs out.');
      }
      if (!tipNow && g.turn && g.turn.pid === you && g.turn.canPlay && !p) {
        tip('my-turn', () => $('#hand'), 'Your turn!', `Play <b>${g.turn.playsLeft} card${g.turn.playsLeft === 1 ? '' : 's'}</b>. Click a card to read it, then press <b>Play</b>, or place it face down as a bluff Knight. Greyed-out cards can't be played right now.`);
      }
      if (!tipNow && g.phase === 'negotiation' && $('#neg:not(.hidden)')) {
        tip('negotiation', () => $('#neg'), 'Negotiation time', 'Talk deals on your call or in chat. <b>Give gold</b> here, or click a card in your hand to <b>offer a swap</b>. Nothing is binding. Press <b>I’m done</b> when you are finished.');
      }
      if (!tipNow && prev && cur.king && prev.king && cur.king !== prev.king) {
        tip('crown', () => seatEl(cur.king), `${pname(cur.king)} is the new King!`, 'They had more gold than the old King (or won a Betray the King), so the two <b>swapped seats, cards and roles</b>.');
      }
      if (!tipNow && prev && cur.fd > prev.fd) {
        const s = g.players.find((x) => x.faceDown.length > (prev.fdBy[x.pid] || 0));
        if (s) tip('knight', () => seatEl(s.pid), 'A face-down card', 'Someone placed a card face down here and claims it is a <b>Knight</b>. It protects against one Betrayal… unless it is a bluff.');
      }
      if (!tipNow && g.resolving && g.resolving.pid !== you && (!prev || prev.res !== cur.res)) {
        tip('resolving', () => $('#c-mid img'), `${pname(g.resolving.pid)} plays ${cname(g.resolving.cardId)}`, 'The card being played appears in the middle. <b>Click it</b> to read what it does. Their eyes are on it, and so are everyone else’s.');
      }
      if (!tipNow && g.turn && g.turn.pid !== you && g.phase === 'play' && !p) {
        tip('watch', () => seatEl(g.turn.pid), `${pname(g.turn.pid)}'s turn`, 'The lifted seat is the player taking their turn. Just watch for now: <b>a box pops up if their card involves you</b>.', g.turn.pid);
      }
      if (!tipNow && m && prev && prev.gold !== undefined && m.gold < prev.gold) {
        tip('gold-lost', () => seatEl(m.pid), 'You lost gold', `You went from ${prev.gold} to ${m.gold}. The log on the right says why.`);
      }
      if (!tipNow && g.phase === 'play') {
        const has = (id) => g.hand.find((c) => c.id === id);
        const cardEl = (c) => () => document.querySelector(`#hand .slot[data-card="${c.uid}"]`);
        const kn = has('knight') || has('king-knight');
        const bt = has('betrayal');
        if (kn) tip('have-knight', cardEl(kn), 'You have a Knight', m && m.isKing ? 'Place it face down in front of a noble to protect them from the next Betrayal. Click it to choose who.' : 'Place it face down in front of you on your turn. It blocks the next Betrayal against you, and nobody can tell it from a bluff.');
        else if (bt) tip('have-betrayal', cardEl(bt), 'You have a Betrayal', 'From round two, it takes all of another noble’s gold, but only if someone supports you right after you play it. Make friends first (negotiation is a good time).');
      }
      if (!tipNow && $('#me-info [data-bb]')) {
        tip('bad-blood', () => $('#me-info [data-bb]'), 'Bad Blood', 'Someone profits every round until you or the other named noble pays the other 200. Press this button to pay and end it.');
      }
      prev = cur;
    }

    function snapshot() {
      const g = G();
      if (!g) return null;
      const m = me();
      const fdBy = {};
      let fd = 0;
      for (const p of g.players) { fdBy[p.pid] = p.faceDown.length; fd += p.faceDown.length; }
      return { king: kingPid(), fd, fdBy, gold: m ? m.gold : undefined, res: g.resolving ? g.resolving.pid + g.resolving.cardId : '' };
    }

    // ───────── what now? ─────────
    function nextStep() {
      const g = G();
      const S = state();
      if (!g) return '';
      const you = S.room.you;
      const m = me();
      if (g.phase === 'intro') return g.intro && g.intro.pending.includes(you) ? 'Take the quick tour. The game starts when you are done.' : 'Waiting for new players to finish the tour.';
      if (g.phase === 'over') return '';
      // only things you can act on; your turn has its own red badge, and someone else's
      // turn needs no message (their seat is lifted)
      if (g.turn && g.turn.pid === you && !g.prompts.length) return 'Click a card to read it and play it, or place it face down as a Knight.';
      return '';
    }

    // ───────── menu ─────────
    function openMenu() {
      const on = isOn();
      const g = G();
      api.openModal('guide', `<div class="guide-menu"><h2>Guide</h2><div class="dots"></div>
        <p>The guide is only shown on your screen. ${on ? 'It is <b>on</b>.' : 'It is <b>off</b>.'}</p>
        <div class="guide-actions">
          ${g ? '<button class="btn primary" data-g="tour">Take the tour</button>' : ''}
          <button class="btn" data-g="toggle">${on ? 'Turn the guide off' : 'Turn the guide on'}</button>
          <button class="btn" data-g="reset">Show all tips again</button>
          <button class="btn" data-g="rules">Read the rules</button>
        </div></div>`, (e) => {
        const b = e.target.closest('[data-g]');
        if (!b) return;
        const a = b.dataset.g;
        if (a === 'tour') { api.closeModal(); startTour(); }
        if (a === 'toggle') { api.setPref(!on); send('tutorial', { on: !on }); api.closeModal(); if (on) closeTip(); }
        if (a === 'reset') { tipsSeen = new Set(); saveTips(); api.closeModal(); api.toast('Tips will show again.'); }
        if (a === 'rules') api.showRules();
      });
    }

    // ───────── per render ─────────
    function onRender() {
      const g = G();
      const S = state();
      if (!g) { if (tour) endTour(); closeTip(); prev = null; return; }
      const pendingMe = g.phase === 'intro' && g.intro && g.intro.pending.includes(S.room.you);
      if (pendingMe && !tour && tourFinishedFor !== g) startTour();
      if (tour) { placeTour(); drawTourWaitOnly(); }
      if (isOn()) checkTips(); else { closeTip(); prev = snapshot(); }
      placeTip();
    }
    function drawTourWaitOnly() {
      const g = G();
      const card = $('#tour .tour-card');
      if (!card || !g) return;
      const others = g.phase === 'intro' && g.intro ? g.intro.pending.filter((p) => p !== state().room.you) : [];
      let w = $('.tour-wait', card);
      if (!others.length) { if (w) w.remove(); return; }
      if (!w) { w = document.createElement('div'); w.className = 'tour-wait'; card.appendChild(w); }
      w.textContent = 'Also taking the tour: ' + others.map(pname).join(', ');
    }

    window.addEventListener('resize', () => { placeTour(); placeTip(); });
    document.addEventListener('keydown', (e) => {
      if (!tour) return;
      if (e.key === 'ArrowRight') $('#tour [data-tour="next"]').click();
      if (e.key === 'ArrowLeft' && tour.i > 0) $('#tour [data-tour="back"]').click();
      if (e.key === 'Escape') { e.stopPropagation(); endTour(); }
    }, true);

    return { onRender, isOn, nextStep, openMenu, startTour, placeTip };
  };
})();
