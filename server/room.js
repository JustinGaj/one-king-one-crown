'use strict';
const crypto = require('crypto');
const { Game, GameError } = require('./game');

// When a player drops out of a running game: a short grace period covers refreshes and blips,
// then the players still at the table vote to wait for them or to let a bot play their seat.
const ABSENT_GRACE_MS = Number(process.env.OKOC_ABSENT_GRACE_MS) || 10 * 1000;
const ABSENT_VOTE_MS = Number(process.env.OKOC_ABSENT_VOTE_MS) || 30 * 1000;
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
    this.members = new Map(); // pid -> { pid, name, token, isBot, sockets:Set, awayTimer, botSeat }
    this.absent = new Map(); // pid -> { state: 'voting' | 'waiting' | 'bot', votes: Map(voter -> 'wait' | 'bot'), endsAt, timer }
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

  // Rejoin a running game from any device: the same name takes back a seat whose player has
  // dropped out, with the same cards, gold and everything else.
  reclaim(name) {
    name = cleanName(name);
    const m = [...this.members.values()].find((x) => !x.isBot && x.name.toLowerCase() === name.toLowerCase());
    if (!m) throw new GameError('That game has already started. To rejoin, enter the name you played with.');
    if (m.sockets.size) throw new GameError(`${m.name} is already connected to this game.`);
    m.token = crypto.randomBytes(16).toString('hex'); // the old device can't come back as this seat too
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
    clearTimeout(this.wipeTimer);
    if (this.game) {
      this.game.setConnected(pid, true);
      const a = this.absent.get(pid);
      if (a) {
        clearTimeout(a.timer);
        this.absent.delete(pid);
        if (this.running()) this.game.log(`${m.name} is back and takes their seat again.`);
      }
      if (m.botSeat) { m.botSeat = false; this.game.setAuto(pid, false); }
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
    if (this.running()) {
      this.game.setConnected(pid, false);
      m.awayTimer = setTimeout(() => this.startAbsenceVote(pid), ABSENT_GRACE_MS);
    }
    this.changed();
    if (!this.voters().length) this.onEmpty(this);
  }

  running() { return !!(this.game && this.game.phase !== 'over'); }

  // people still at the table (connected humans), optionally leaving one out
  voters(except) {
    return [...this.members.values()].filter((x) => !x.isBot && x.sockets.size && x.pid !== except).map((x) => x.pid);
  }

  // ───── a player dropped out: wait for them, or let a bot play their seat? ─────
  startAbsenceVote(pid) {
    const m = this.members.get(pid);
    if (!m || m.sockets.size || !this.running()) return;
    const voters = this.voters(pid);
    if (!voters.length) return; // nobody left to ask; the room is wiped if nobody comes back
    if (this.hostPid === pid) this.hostPid = voters[0]; // someone at the table keeps the host controls
    const prev = this.absent.get(pid);
    if (prev) clearTimeout(prev.timer);
    const a = { state: 'voting', votes: new Map(), endsAt: Date.now() + ABSENT_VOTE_MS };
    a.timer = setTimeout(() => this.finishAbsenceVote(pid), ABSENT_VOTE_MS);
    this.absent.set(pid, a);
    this.game.log(`${m.name} lost connection. Vote: wait for them to come back, or let a bot play their seat?`, { kind: 'alert' });
    this.changed();
  }

  voteAbsent(voter, pid, choice) {
    const a = this.absent.get(pid);
    if (!a || !this.running()) throw new GameError('There is nothing to vote on.');
    if (a.state !== 'voting') throw new GameError('That vote is already over.');
    if (voter === pid || !this.voters(pid).includes(voter)) throw new GameError('You can’t vote on this.');
    if (choice !== 'wait' && choice !== 'bot') throw new GameError('Vote “wait” or “bot”.');
    a.votes.set(voter, choice);
    if (this.voters(pid).every((v) => a.votes.has(v))) this.finishAbsenceVote(pid);
    else this.changed();
  }

  finishAbsenceVote(pid) {
    const a = this.absent.get(pid);
    const m = this.members.get(pid);
    if (!a || a.state !== 'voting' || !m) return;
    clearTimeout(a.timer);
    if (!this.running() || m.sockets.size) { this.absent.delete(pid); this.changed(); return; }
    const counted = [...a.votes].filter(([v]) => this.voters(pid).includes(v)).map(([, c]) => c);
    const bot = counted.filter((c) => c === 'bot').length;
    const wait = counted.length - bot;
    if (bot > wait) { // a tie or no votes means the table waits
      a.state = 'bot';
      m.botSeat = true;
      this.game.setAuto(pid, true);
      this.game.log(`The table voted ${bot}–${wait}: a bot plays ${m.name}'s seat until they come back.`, { kind: 'alert' });
    } else {
      a.state = 'waiting';
      this.game.log(`The table voted ${wait}–${bot} to wait for ${m.name}. Their turn waits for them; anyone can call a new vote.`, { kind: 'alert' });
    }
    this.changed();
  }

  // while waiting, anyone at the table can ask for a fresh vote
  revoteAbsent(voter, pid) {
    const a = this.absent.get(pid);
    if (!a || a.state !== 'waiting') throw new GameError('There is nothing to vote on.');
    if (!this.voters(pid).includes(voter)) throw new GameError('You can’t vote on this.');
    this.startAbsenceVote(pid);
    this.voteAbsent(voter, pid, 'bot');
  }

  clearAbsence() {
    for (const a of this.absent.values()) clearTimeout(a.timer);
    this.absent.clear();
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
    this.clearAbsence();
    for (const m of this.members.values()) m.botSeat = false;
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
    m.botSeat = false;
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
      absent: this.running() ? [...this.absent].map(([p, a]) => ({
        pid: p, name: this.members.get(p).name, state: a.state, endsAt: a.endsAt, ms: ABSENT_VOTE_MS,
        bot: [...a.votes.values()].filter((c) => c === 'bot').length,
        wait: [...a.votes.values()].filter((c) => c === 'wait').length,
        voters: this.voters(p).length, myVote: a.votes.get(pid) || null, canVote: this.voters(p).includes(pid),
      })) : [],
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
