'use strict';
const crypto = require('crypto');
const { Game, GameError } = require('./game');

const AWAY_AUTOPILOT_MS = 60 * 1000; // a disconnected player is auto-played after 1 minute
// Game speed: how long bots think, how long a played card stays on the table, and the pause between turns.
const SPEEDS = {
  relaxed: { botDelayMs: 2600, botAnswerMs: 1500, cardHoldMs: 3200, turnGapMs: 1500 },
  normal: { botDelayMs: 1600, botAnswerMs: 1000, cardHoldMs: 2000, turnGapMs: 900 },
  fast: { botDelayMs: 600, botAnswerMs: 400, cardHoldMs: 700, turnGapMs: 300 },
};
const BOT_NAMES = ['Sir Bot', 'Lady Byte', 'Duke Data', 'Count Cog', 'Baron Bolt', 'Dame Diode', 'Earl Error', 'Lord Loop'];

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
}

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.members = new Map(); // pid -> { pid, name, token, isBot, sockets:Set, awayTimer, autoByAway }
    this.order = [];
    this.hostPid = null;
    this.game = null;
    this.settings = { negotiationSeconds: 120, speed: 'auto' };
    this.lobbyChat = [];
    this.onEmpty = onEmpty;
    this.pending = false;
    this.lastActive = Date.now();
  }

  // ───── membership ─────
  addMember(name, isBot = false) {
    name = cleanName(name);
    if (!name) throw new GameError('Enter a name.');
    if (this.game && this.game.phase !== 'over') throw new GameError('That game has already started.');
    if (this.order.length >= 8) throw new GameError('The room is full (8 players max).');
    if ([...this.members.values()].some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new GameError('Someone in the room already has that name.');
    const pid = crypto.randomBytes(6).toString('hex');
    const m = { pid, name, token: crypto.randomBytes(16).toString('hex'), isBot, tutorial: false, sockets: new Set() };
    this.members.set(pid, m);
    this.order.push(pid);
    if (!this.hostPid && !isBot) this.hostPid = pid;
    this.changed();
    return m;
  }

  removeMember(pid) {
    if (this.game && this.game.phase !== 'over') throw new GameError('You can’t remove players during a game.');
    const m = this.members.get(pid);
    if (!m) return;
    for (const s of m.sockets) s.emit('kicked');
    this.members.delete(pid);
    this.order = this.order.filter((p) => p !== pid);
    if (this.hostPid === pid) this.hostPid = this.order.find((p) => !this.members.get(p).isBot) || null;
    this.changed();
  }

  attach(pid, token, socket) {
    const m = this.members.get(pid);
    if (!m || m.token !== token) throw new GameError('Could not rejoin that room.');
    m.sockets.add(socket);
    clearTimeout(m.awayTimer);
    if (this.game) {
      this.game.setConnected(pid, true);
      if (m.autoByAway) { m.autoByAway = false; this.game.setAuto(pid, false); }
    }
    this.lastActive = Date.now();
    this.changed();
    return m;
  }

  detach(pid, socket) {
    const m = this.members.get(pid);
    if (!m) return;
    m.sockets.delete(socket);
    if (m.sockets.size) return;
    if (this.game && this.game.phase !== 'over') {
      this.game.setConnected(pid, false);
      m.awayTimer = setTimeout(() => {
        if (!m.sockets.size && this.game && this.game.phase !== 'over' && !this.game.players[pid].auto) {
          m.autoByAway = true;
          this.game.setAuto(pid, true);
          this.game.log(`${m.name} has been away for a minute — autopilot takes over until they return.`);
        }
      }, AWAY_AUTOPILOT_MS);
    }
    this.changed();
    if (![...this.members.values()].some((x) => !x.isBot && x.sockets.size)) this.onEmpty(this);
  }

  connected(pid) { const m = this.members.get(pid); return !!m && (m.isBot || m.sockets.size > 0); }

  // ───── host controls ─────
  requireHost(pid) { if (pid !== this.hostPid) throw new GameError('Only the host can do that.'); }

  addBot(pid) {
    this.requireHost(pid);
    const used = new Set([...this.members.values()].map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (this.order.length + 1);
    this.addMember(name, true);
  }

  setSettings(pid, s) {
    this.requireHost(pid);
    const running = this.game && this.game.phase !== 'over';
    // the speed can change any time; the negotiation timer only before the game
    if (s.speed !== undefined) {
      if (s.speed !== 'auto' && !SPEEDS[s.speed]) throw new GameError('Unknown speed.');
      this.settings.speed = s.speed;
      this.applyPace();
    }
    if (s.negotiationSeconds !== undefined) {
      if (running) throw new GameError('Change the negotiation timer before the game starts.');
      const n = Number(s.negotiationSeconds);
      if (Number.isFinite(n)) this.settings.negotiationSeconds = Math.max(0, Math.min(120, Math.round(n)));
    }
    this.changed();
  }

  // "Auto" plays relaxed while anyone is using the first-time guide, normal otherwise.
  paceName() {
    if (this.settings.speed !== 'auto') return this.settings.speed;
    return [...this.members.values()].some((m) => m.tutorial && !m.isBot) ? 'relaxed' : 'normal';
  }

  applyPace() {
    if (this.game) Object.assign(this.game.settings, SPEEDS[this.paceName()]);
  }

  start(pid) {
    this.requireHost(pid);
    if (this.game && this.game.phase !== 'over') throw new GameError('The game is already running.');
    if (this.order.length < 4) throw new GameError('You need at least 4 players (add bots to fill seats).');
    const players = this.order.map((p) => { const m = this.members.get(p); return { pid: p, name: m.name, isBot: m.isBot, learning: m.tutorial }; });
    this.game = new Game({
      players,
      settings: { negotiationSeconds: this.settings.negotiationSeconds, ...SPEEDS[this.paceName()] },
      onChange: () => this.changed(),
      onError: (e) => console.error(`[room ${this.code}]`, e),
    });
    for (const p of this.order) if (!this.connected(p)) this.game.setConnected(p, false);
    this.game.start();
    this.changed();
  }

  backToLobby(pid) {
    this.requireHost(pid);
    if (this.game && this.game.phase !== 'over') throw new GameError('The game is still running.');
    this.game = null;
    this.changed();
  }

  // Resolve every open question with its default answer (for stuck games)
  skipWaits(pid) {
    this.requireHost(pid);
    if (!this.game) return;
    if (this.game.intro && this.game.intro.finish) this.game.intro.finish();
    for (const p of [...this.game.prompts.values()]) {
      if (p.kind === 'roll' || p.kind === 'info') { p.resolve(true); continue; }
      let v = p.default;
      if (v === undefined && p.kind === 'cards' && p.cards && p.cards.length) v = p.cards[0].uid;
      if (v === undefined && p.options) { const o = p.options.find((x) => !x.disabled); if (o) v = o.value; }
      if (v === undefined && p.kind === 'say') v = p.exact || p.prefill || '…';
      if (v !== undefined) p.resolve(v);
    }
    this.game.log('The host skipped the waiting.');
  }

  // A player asks for (or turns off) the first-time guide. Only their own screen shows it;
  // the game just waits for them to finish the short tour before round one.
  setTutorial(pid, on) {
    const m = this.members.get(pid);
    if (!m || m.isBot) return;
    m.tutorial = !!on;
    if (this.game) this.game.setLearning(pid, on);
    this.applyPace();
    this.changed();
  }

  tourDone(pid) {
    if (this.game) this.game.introDone(pid);
  }

  setAuto(pid, target, on) {
    if (!this.game) throw new GameError('No game is running.');
    if (target !== pid) this.requireHost(pid);
    const m = this.members.get(target);
    if (!m) throw new GameError('No such player.');
    m.autoByAway = false;
    this.game.setAuto(target, on);
    this.game.log(`${m.name}: autopilot ${on ? 'ON' : 'OFF'}.`);
  }

  lobbyMessage(pid, text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    if (this.game) return this.game.addChat(pid, text);
    this.lobbyChat.push({ i: this.lobbyChat.length, t: Date.now(), pid, name: this.members.get(pid).name, text });
    this.changed();
  }

  // ───── state broadcast ─────
  changed() {
    this.lastActive = Date.now();
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => { this.pending = false; this.broadcast(); }, 25);
  }

  lobbyInfo(pid) {
    return {
      code: this.code,
      you: pid,
      host: this.hostPid,
      settings: { ...this.settings, pace: this.paceName() },
      members: this.order.map((p) => { const m = this.members.get(p); return { pid: p, name: m.name, isBot: m.isBot, tutorial: m.tutorial, connected: this.connected(p) }; }),
      chat: this.lobbyChat.slice(-100),
      inGame: !!this.game,
    };
  }

  broadcast() {
    for (const m of this.members.values()) {
      if (!m.sockets.size) continue;
      const payload = { room: this.lobbyInfo(m.pid), game: this.game ? this.game.view(m.pid) : null, now: Date.now() };
      for (const s of m.sockets) s.emit('state', payload);
    }
  }
}

module.exports = { Room, cleanName };
