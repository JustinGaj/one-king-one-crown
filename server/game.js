'use strict';
// One King One Crown — authoritative game engine.
// All rules come from the official Game Guide, the card text, and the
// "Royal Advisor" FAQ on onecrown.store. Interpretations of unclear rules are
// listed in docs/RULES-DECISIONS.md.

const { DEFS, buildDeck } = require('./cards');
const bot = require('./bot');

const MAX_GOLD = 2000;
const HAND_MIN = 8;
// Isolation does not protect against these (FAQ: "except for Royal Bomb and Betrayals")
const ISOLATION_EXEMPT = new Set(['betrayal', 'betray-the-king', 'royal-bomb']);

class GameError extends Error {}
class Cancel extends Error {}

const DEFAULT_SETTINGS = {
  negotiationSeconds: 120, // official: 2 minutes max
  introSeconds: 240, // longest wait for first-time players to finish the tour
  supportSeconds: 45, // window to give "vocal support" to a Betrayal
  reactionSeconds: 20, // King Maker window
  voteSeconds: 60,
  rollSeconds: 20, // auto-roll if a player doesn't click
  responseSeconds: 120, // decisions by players who are not the active player
  sayingSeconds: 60,
  botDelayMs: 700,
};

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Game {
  constructor({ players, settings = {}, rng = Math.random, onChange = () => {}, onError = (e) => console.error(e) }) {
    if (players.length < 4 || players.length > 8) throw new GameError('One King One Crown needs 4–8 players.');
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = rng;
    this.onChange = onChange;
    this.onError = onError;
    this.uid = 0;
    this.players = {};
    for (const p of players) {
      this.players[p.pid] = { pid: p.pid, name: p.name, isBot: !!p.isBot, learning: !p.isBot && !!p.learning, auto: false, connected: true, gold: 600, hand: [] };
    }
    // Deal character cards face down: whoever gets the King's character card is The King.
    const order = shuffle(players.map((p) => p.pid), rng);
    this.seats = order; // seats[0] is the King's seat; the circle runs clockwise by index
    this.fd = order.map(() => []); // face-down cards in front of each seat (they stay with the seat)
    this.players[this.seats[0]].gold = 1000;

    this.decks = {
      noble: { draw: shuffle(buildDeck('noble', () => ++this.uid), rng), discard: [] },
      king: { draw: shuffle(buildDeck('king', () => ++this.uid), rng), discard: [] },
    };
    for (const pid of this.seats) this.topUp(pid, false);

    this.round = 0;
    this.phase = 'starting';
    this.turn = null;
    this.turnsDone = Object.fromEntries(order.map((p) => [p, 0]));
    this.bets = []; // Scout / Hindsight cards kept in front of their owner
    this.badBlood = [];
    this.debts = [];
    this.effects = { isoLook: {}, isoGold: {}, kingsEye: [], tides: [] };
    this.prompts = new Map();
    this.trades = new Map();
    this.logEntries = [];
    this.chat = [];
    this.lastRoll = null;
    this.resolving = null;
    this.neg = null;
    this.intro = null;
    this.winner = null;
    this.ctx = null;
    this._chain = Promise.resolve();
    this.busy = 0;
    this.nextId = 1;
    this.log(`Character cards dealt. ${this.name(this.seats[0])} is The King (1000 gold). Nobles start with 600.`);
  }

  // ───────────────────────── helpers ─────────────────────────
  emit() { try { this.onChange(); } catch (e) { this.onError(e); } }
  name(pid) { return this.players[pid] ? this.players[pid].name : '?'; }
  king() { return this.seats[0]; }
  isKing(pid) { return this.seats[0] === pid; }
  seatOf(pid) { return this.seats.indexOf(pid); }
  nobles() { return this.seats.slice(1); }
  others(pid) { return this.seats.filter((p) => p !== pid); }
  gold(pid) { return this.players[pid].gold; }
  hand(pid) { return this.players[pid].hand; }
  deckOf(pid) { return this.isKing(pid) ? 'king' : 'noble'; }
  isAuto(pid) { const p = this.players[pid]; return p.isBot || p.auto; }
  def(card) { return DEFS[card.id]; }

  log(text, opts = {}) {
    if (this.ctx && !this.ctx.committed) this.commit(); // announce the card before its effects
    this.logEntries.push({ i: this.logEntries.length, t: Date.now(), text, to: opts.to || null, kind: opts.kind || 'info' });
    if (this.logEntries.length > 600) this.logEntries.splice(0, 100);
    this.emit();
  }

  commit() {
    const c = this.ctx;
    if (c && !c.committed) {
      c.committed = true;
      this.resolving = { pid: c.pid, cardId: c.card.id };
      this.log(`${this.name(c.pid)} plays ${this.def(c.card).name}.`, { kind: 'play' });
    }
  }

  // ───────────────────────── cards & decks ─────────────────────────
  drawCard(deckName) {
    const d = this.decks[deckName];
    if (!d.draw.length && d.discard.length) {
      d.draw = shuffle(d.discard, this.rng);
      d.discard = [];
      this.log(`The ${deckName === 'king' ? 'King' : 'Noble'} deck was reshuffled from its discard pile.`);
    }
    return d.draw.pop() || null;
  }

  draw(pid, n) {
    const deck = this.deckOf(pid);
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = this.drawCard(deck);
      if (!c) break;
      this.hand(pid).push(c);
      got++;
    }
    return got;
  }

  topUp(pid, announce = true) {
    const need = HAND_MIN - this.hand(pid).length;
    if (need > 0) {
      const got = this.draw(pid, need);
      if (announce && got) this.log(`${this.name(pid)} draws ${got} replacement card${got > 1 ? 's' : ''}.`);
    }
  }

  discard(card) {
    this.decks[card.deck].discard.push(card);
  }

  takeFromHand(pid, uid) {
    const h = this.hand(pid);
    const i = h.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    return h.splice(i, 1)[0];
  }

  // ───────────────────────── gold ─────────────────────────
  // Gain gold (from the bank, or as the receiving end of a transfer). Capped at 2000.
  gain(pid, amount, opts = {}) {
    this.commit();
    const p = this.players[pid];
    const before = p.gold;
    p.gold = Math.min(MAX_GOLD, p.gold + amount);
    const got = p.gold - before;
    if (!opts.quiet) this.log(`${p.name} gains ${got} gold${opts.from ? ` from ${opts.from}` : ' from the bank'}${got < amount ? ' (capped at 2000)' : ''}.`, { kind: 'gold' });
    return got;
  }

  // Why would `pid` be protected from losing gold to this effect?
  lossBlock(pid, by, card, to) {
    if (by && by !== pid && this.effects.isoGold[pid] && !ISOLATION_EXEMPT.has(card)) return 'Isolation';
    if (to && by === to && card !== 'betrayal' && card !== 'betray-the-king') {
      // Shifting Tides: the two chosen nobles can only take gold from each other
      for (const t of this.effects.tides) {
        if (t.a === to && pid !== t.b) return 'Shifting Tides';
        if (t.b === to && pid !== t.a) return 'Shifting Tides';
      }
    }
    return null;
  }

  // `pid` loses `amount` to the bank (to=null) or to another player.
  // by = the player whose card caused it. Returns the amount actually lost.
  lose(pid, amount, { by = null, card = null, to = null, quiet = false } = {}) {
    this.commit();
    const p = this.players[pid];
    const block = this.lossBlock(pid, by, card, to);
    if (block) {
      this.log(`${p.name} is protected by ${block} and loses nothing.`, { kind: 'gold' });
      return 0;
    }
    const actual = Math.min(amount, p.gold);
    p.gold -= actual;
    if (!quiet) this.log(`${p.name} loses ${actual} gold${to ? ` to ${this.name(to)}` : ' to the bank'}${actual < amount ? ` (only had ${actual})` : ''}.`, { kind: 'gold' });
    if (to) this.gain(to, actual, { from: p.name, quiet: true });
    // King's Eye: a noble who takes gold from a protected player pays the bank 100
    if (to && to === by && !this.isKing(by) && actual > 0) this.kingsEyePenalty(by, pid, 'took gold from');
    return actual;
  }

  kingsEyePenalty(noble, victim, what) {
    if (this.isKing(noble)) return;
    if (this.effects.kingsEye.some((e) => e.target === victim)) {
      const p = this.players[noble];
      const paid = Math.min(100, p.gold);
      p.gold -= paid;
      this.log(`King's Eye: ${p.name} ${what} ${this.name(victim)} and pays the bank ${paid} gold.`, { kind: 'gold' });
    }
  }

  // ───────────────────────── prompts ─────────────────────────
  // spec: { kind: 'choice'|'cards'|'say'|'roll'|'info', title, text, options, cards, ... }
  askRaw(pid, spec) {
    const id = this.nextId++;
    if (this.ctx && pid !== this.ctx.pid) this.commit(); // asking someone else makes the play public
    const prompt = { id, pid, ...spec };
    if (prompt.cancelable && (!this.ctx || this.ctx.committed || this.ctx.pid !== pid)) prompt.cancelable = false;
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });
    prompt.resolve = (v) => {
      if (!this.prompts.has(id)) return;
      this.prompts.delete(id);
      if (prompt.timer) clearTimeout(prompt.timer);
      if (prompt.botTimer) clearTimeout(prompt.botTimer);
      this.emit();
      resolveFn(v);
    };
    if (spec.timeoutSec) {
      prompt.endsAt = Date.now() + spec.timeoutSec * 1000;
      prompt.timer = setTimeout(() => prompt.resolve(spec.default), spec.timeoutSec * 1000);
    }
    this.prompts.set(id, prompt);
    this.scheduleBot(pid);
    this.emit();
    return { id, promise };
  }

  async ask(pid, spec) {
    const v = await this.askRaw(pid, spec).promise;
    if (v === '__cancel__') throw new Cancel();
    return v;
  }

  // Ask several players at once. `until(answers)` may end the window early.
  askAll(pids, mkSpec, until) {
    return new Promise((resolve) => {
      const answers = {};
      const ids = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const id of ids) { const p = this.prompts.get(id); if (p) p.resolve(null); }
        resolve(answers);
      };
      if (!pids.length) return finish();
      for (const pid of pids) {
        const { id, promise } = this.askRaw(pid, mkSpec(pid));
        ids.push(id);
        promise.then((v) => {
          if (done) return;
          answers[pid] = v;
          if (Object.keys(answers).length === pids.length || (until && until(answers))) finish();
        });
      }
    });
  }

  answer(pid, promptId, value) {
    const p = this.prompts.get(promptId);
    if (!p || p.pid !== pid) throw new GameError('That question is no longer open.');
    if (value === '__cancel__') {
      if (!p.cancelable) throw new GameError('You can no longer take this card back.');
      return p.resolve(value);
    }
    p.resolve(this.validateAnswer(p, value));
  }

  validateAnswer(p, value) {
    switch (p.kind) {
      case 'choice': {
        const o = (p.options || []).find((x) => x.value === value);
        if (!o || o.disabled) throw new GameError('Invalid choice.');
        return value;
      }
      case 'cards': {
        if ((p.options || []).some((x) => x.value === value && !x.disabled)) return value;
        if (!(p.cards || []).some((c) => c.uid === value && !c.disabled)) throw new GameError('Pick one of the shown cards.');
        return value;
      }
      case 'say': {
        if (value === 'refuse') {
          if (!p.allowRefuse || p.refuseDisabled) throw new GameError('You cannot refuse.');
          return value;
        }
        const s = String(value || '').trim().slice(0, 240);
        if (!s) throw new GameError('Say something!');
        return s;
      }
      default:
        return true;
    }
  }

  // Player options list for a choice prompt
  playerOptions(pids, disabledFn) {
    return pids.map((p) => {
      const reason = disabledFn ? disabledFn(p) : null;
      return { value: p, label: this.name(p) + (this.isKing(p) ? ' (King)' : ''), player: true, disabled: !!reason, reason: reason || undefined };
    });
  }

  async pickPlayer(pid, title, candidates, opts = {}) {
    const options = this.playerOptions(candidates, opts.disabled);
    if (!options.some((o) => !o.disabled)) throw new GameError(opts.none || 'There is no valid player to choose.');
    return this.ask(pid, { kind: 'choice', title, text: opts.text, options, cancelable: opts.cancel !== false, timeoutSec: opts.timeoutSec, default: options.find((o) => !o.disabled).value });
  }

  async choose(pid, title, options, opts = {}) {
    const enabled = options.filter((o) => !o.disabled);
    return this.ask(pid, { kind: 'choice', title, text: opts.text, options, cancelable: !!opts.cancel, timeoutSec: opts.timeoutSec, default: opts.default !== undefined ? opts.default : enabled[0] && enabled[0].value, card: opts.card });
  }

  async rollDie(pid, label) {
    this.commit();
    await this.ask(pid, { kind: 'roll', title: label || 'Roll the die', timeoutSec: this.settings.rollSeconds, default: true });
    const value = 1 + Math.floor(this.rng() * 6);
    this.lastRoll = { pid, value, label: label || '', at: Date.now(), n: (this.lastRoll ? this.lastRoll.n : 0) + 1 };
    this.log(`🎲 ${this.name(pid)} rolls a ${value}${label ? ` (${label})` : ''}.`, { kind: 'roll' });
    return value;
  }

  // Spoken parts of cards are typed and shown to the table (say it out loud on your call too!)
  async say(pid, title, { prefill = '', exact = null, allowRefuse = false, refuseLabel, refuseDisabled = false, text } = {}) {
    const v = await this.ask(pid, { kind: 'say', title, text, prefill: exact || prefill, exact, allowRefuse, refuseLabel, refuseDisabled, timeoutSec: this.settings.sayingSeconds, default: exact || prefill || '...' });
    if (v === 'refuse') { this.log(`${this.name(pid)} refuses!`, { kind: 'say' }); return null; }
    this.log(`🗣 ${this.name(pid)}: “${v}”`, { kind: 'say' });
    return v;
  }

  async rollOff(pids, label) {
    // Everyone rolls; returns pids sorted by final roll (highest first). Ties are re-rolled.
    let groups = [pids];
    const result = [];
    while (groups.length) {
      const g = groups.shift();
      if (g.length === 1) { result.push(g[0]); continue; }
      const rolls = {};
      for (const p of g) rolls[p] = await this.rollDie(p, label);
      const vals = [...new Set(Object.values(rolls))].sort((a, b) => b - a);
      groups = vals.map((v) => g.filter((p) => rolls[p] === v)).concat(groups);
    }
    return result;
  }

  // Betrayal / Betray the King need vocal support from other players after being played
  async supportWindow(pid, eligible, needed, cardName) {
    if (eligible.length < needed) {
      this.log(`Nobody is able to support the ${cardName}.`);
      return false;
    }
    this.log(`${this.name(pid)} needs vocal support from ${needed === 1 ? 'another noble' : 'TWO players'} or the ${cardName} has no effect!`, { kind: 'alert' });
    const supporters = [];
    let refused = 0;
    await this.askAll(eligible, () => ({
      kind: 'choice', title: `Support ${this.name(pid)}'s ${cardName}?`, card: cardName,
      text: `${this.name(pid)} played ${cardName}. ${needed === 1 ? 'One supporter' : 'Two supporters'} needed.`,
      options: [{ value: 'support', label: '📣 I support it!' }, { value: 'no', label: 'Stay silent' }],
      timeoutSec: this.settings.supportSeconds, default: 'no',
    }), (ans) => {
      supporters.length = 0; refused = 0;
      for (const [p, v] of Object.entries(ans)) { if (v === 'support') supporters.push(p); else refused++; }
      return supporters.length >= needed || eligible.length - refused < needed;
    });
    const sup = supporters.slice(0, needed);
    if (sup.length >= needed) {
      this.log(`📣 ${sup.map((p) => this.name(p)).join(' and ')} support${sup.length === 1 ? 's' : ''} the ${cardName}!`, { kind: 'alert' });
      return true;
    }
    this.log(`No support — the ${cardName} has no effect.`, { kind: 'alert' });
    return false;
  }

  // ───────────────────────── crown ─────────────────────────
  async checkCrown() {
    for (let guard = 0; guard < 20; guard++) {
      if (this.phase === 'over') return;
      const kg = this.gold(this.king());
      const contenders = this.nobles().filter((p) => this.gold(p) > kg);
      if (!contenders.length) return;
      let newKing = contenders[0];
      if (contenders.length > 1) {
        this.log(`${contenders.map((p) => this.name(p)).join(', ')} all have more gold than the King at the same time — they roll for the crown!`, { kind: 'alert' });
        const order = await this.rollOff(contenders, 'crown roll-off');
        newKing = order[0];
        for (const p of order.slice(1)) this.lose(p, 100, {});
      }
      this.crownChange(newKing, { swapGold: false, reason: 'has more gold than the King' });
    }
  }

  crownChange(newKing, { swapGold, reason }) {
    const oldKing = this.king();
    if (newKing === oldKing) return;
    const seat = this.seatOf(newKing);
    const nk = this.players[newKing];
    const ok = this.players[oldKing];
    // Royal Bomb: "If you become king, the card is discarded."
    for (const c of nk.hand.filter((c) => c.id === 'royal-bomb')) { this.takeFromHand(newKing, c.uid); this.discard(c); this.log(`${nk.name}'s Royal Bomb is discarded.`); }
    // Bad Blood stops / Indebted debts are gone if the owner becomes King
    const bb = this.badBlood.filter((b) => b.owner === newKing);
    if (bb.length) { this.badBlood = this.badBlood.filter((b) => b.owner !== newKing); this.log(`${nk.name}'s Bad Blood ends.`); }
    const dd = this.debts.filter((d) => d.owner === newKing);
    if (dd.length) { this.debts = this.debts.filter((d) => d.owner !== newKing); this.log(`Debts owed to ${nk.name} are gone.`); }
    // Physically swap seats and cards (face-down knights stay with the seat)
    this.seats[0] = newKing;
    this.seats[seat] = oldKing;
    [nk.hand, ok.hand] = [ok.hand, nk.hand];
    if (swapGold) [nk.gold, ok.gold] = [ok.gold, nk.gold];
    this.log(`👑 ${nk.name} ${reason} and becomes THE KING! ${ok.name} is demoted to Noble${swapGold ? ' (they switched gold)' : ''}.`, { kind: 'crown' });
    this.topUp(newKing);
    this.topUp(oldKing);
    // Scout: backing a noble to become king
    for (const b of this.bets.filter((b) => b.type === 'scout' && b.target === newKing)) {
      this.bets.splice(this.bets.indexOf(b), 1);
      this.discard(b.card);
      this.log(`Scout pays off for ${this.name(b.owner)}!`);
      this.gain(b.owner, 300);
    }
    if (this.turn && (this.turn.pid === newKing || this.turn.pid === oldKing)) {
      this.turn.ended = true;
      if (this.turn.wait) this.turn.wait({ abort: true });
    }
    this.emit();
  }

  // Serialize all state-changing resolutions (card plays, crown checks, round effects)
  exclusive(fn) {
    const run = async () => { this.busy++; try { return await fn(); } finally { this.busy--; } };
    const p = this._chain.then(run, run);
    this._chain = p.catch((e) => this.onError(e));
    return p;
  }

  requestCrownCheck() {
    if (this.phase === 'over' || this.phase === 'starting' || this.phase === 'intro') return;
    this.exclusive(() => this.checkCrown()).catch((e) => this.onError(e));
  }

  // ───────────────────────── main loop ─────────────────────────
  start() {
    this.loop = this.run().catch((e) => { this.onError(e); this.log('⚠ The game hit an internal error: ' + e.message, { kind: 'alert' }); });
    return this.loop;
  }

  async run() {
    await this.introPhase();
    for (let r = 1; r <= 4; r++) {
      this.round = r;
      this.dir = r % 2 === 1 ? 'cw' : 'ccw';
      this.phase = 'play';
      this.log(`━━ ROUND ${['ONE', 'TWO', 'THREE', 'FOUR'][r - 1]} — turn order goes ${this.dir === 'cw' ? 'clockwise' : 'counter-clockwise'} ━━`, { kind: 'round' });
      if (r > 1) await this.exclusive(() => this.roundStart());
      await this.exclusive(() => this.checkCrown());
      const n = this.seats.length;
      const order = [0];
      for (let i = 1; i < n; i++) order.push(this.dir === 'cw' ? i : n - i);
      for (const seat of order) {
        await this.runTurn(seat);
        if (this.phase === 'over') return;
      }
      if (r < 4) {
        await this.negotiation();
        await this.exclusive(() => this.roundEnd());
        await this.exclusive(() => this.checkCrown());
      }
    }
    this.finish();
  }

  roundStart() {
    for (const b of this.badBlood) {
      this.log(`Bad Blood: ${this.name(b.owner)} collects 200 (until ${this.name(b.a)} or ${this.name(b.b)} pays the other 200).`);
      this.gain(b.owner, 200);
    }
    for (const d of this.debts) {
      this.log(`Indebted: ${this.name(d.debtor)} owes ${this.name(d.owner)} 100.`);
      this.lose(d.debtor, 100, { by: d.owner, card: 'indebted', to: d.owner });
    }
  }

  roundEnd() {
    for (const b of this.bets.filter((b) => b.deadline === this.round)) {
      this.bets.splice(this.bets.indexOf(b), 1);
      this.discard(b.card);
      this.log(`${this.name(b.owner)}'s ${b.type === 'scout' ? 'Scout' : 'Hindsight'} bet on ${this.name(b.target)} failed.`);
      this.lose(b.owner, 100, { by: b.owner, card: b.type });
    }
  }

  finish() {
    // Bets whose deadline is past the end of the game simply expire.
    for (const b of this.bets) this.discard(b.card);
    this.bets = [];
    for (const p of [...this.prompts.values()]) p.resolve(null);
    this.phase = 'over';
    this.turn = null;
    this.resolving = null;
    this.winner = this.king();
    this.log(`🏆 The game is over. ${this.name(this.winner)} ends the game as THE KING and wins!`, { kind: 'crown' });
  }

  playsFor(pid) {
    return this.isKing(pid) ? (this.nobles().length === 3 ? 2 : 3) : 2;
  }

  async runTurn(seat) {
    const pid = this.seats[seat];
    const wasKing = seat === 0;
    // "You should always have at least 8 cards" — refill anyone short (e.g. after a deck ran dry)
    for (const p of this.seats) this.topUp(p, false);
    // King's Eye and Shifting Tides last "until your next turn"
    this.effects.kingsEye = this.effects.kingsEye.filter((e) => !(e.owner === pid && this.turnsDone[pid] >= e.until));
    this.effects.tides = this.effects.tides.filter((e) => !(e.owner === pid && this.turnsDone[pid] >= e.until));
    const base = this.playsFor(pid);
    this.turn = { pid, seat, playsLeft: base, base, ended: false };
    this.log(`${wasKing ? '👑 ' : ''}${this.name(pid)}'s turn — play ${base} cards.`, { kind: 'turn' });
    while (this.turn.playsLeft > 0 && !this.turn.ended && this.phase === 'play') {
      if (!this.hand(pid).length) { this.log(`${this.name(pid)} has no cards left to play.`); break; }
      const action = await new Promise((res) => { this.turn.wait = res; this.scheduleBot(pid); this.emit(); });
      this.turn.wait = null;
      if (action.abort) break;
      await this.exclusive(() => this.resolvePlay(pid, action));
      await this.exclusive(() => this.checkCrown());
    }
    const stillHere = this.seats[seat] === pid;
    if (stillHere && !this.turn.ended) {
      const got = this.draw(pid, base);
      this.topUp(pid, false);
      this.log(`${this.name(pid)} ends their turn and draws ${got} card${got === 1 ? '' : 's'}.`);
    } else {
      this.log(`${this.name(pid)}'s turn ends early because the crown changed hands.`);
      for (const p of this.seats) this.topUp(p, false);
    }
    this.turnsDone[pid]++;
    for (const k of ['isoLook', 'isoGold']) if (this.effects[k][pid] !== undefined && this.turnsDone[pid] >= this.effects[k][pid]) delete this.effects[k][pid];
    this.turn = null;
    this.emit();
  }

  // ───────────────────────── playing cards ─────────────────────────
  playReason(pid, card) {
    const d = this.def(card);
    if (d.reactionOnly) return 'Only played out of turn, when someone plays “Betray the King”.';
    if (d.restrict) return d.restrict(this, pid) || null;
    return null;
  }

  // Called from the network layer
  play(pid, { uid, faceDown = false, target = null }) {
    if (this.phase !== 'play' || !this.turn || this.turn.pid !== pid || !this.turn.wait) throw new GameError('It is not your turn to play a card.');
    if (this.busy) throw new GameError('Wait for the current card to finish.');
    const card = this.hand(pid).find((c) => c.uid === uid);
    if (!card) throw new GameError('That card is not in your hand.');
    const d = this.def(card);
    if (d.faceDownOnly) faceDown = true;
    if (faceDown) {
      if (card.id === 'royal-bomb') throw new GameError('The Royal Bomb can only be played, discarded or given away in negotiation.');
      if (this.isKing(pid)) {
        if (!target || !this.nobles().includes(target)) throw new GameError('Choose a noble to place this card in front of.');
      } else target = pid;
    } else {
      const r = this.playReason(pid, card);
      if (r) throw new GameError(r);
    }
    const w = this.turn.wait;
    this.turn.wait = null;
    w({ uid, faceDown, target });
  }

  async resolvePlay(pid, { uid, faceDown, target }) {
    const card = this.takeFromHand(pid, uid);
    if (!card) return;
    const d = this.def(card);
    if (faceDown) {
      const seat = this.seatOf(target);
      this.fd[seat].push({ fid: this.nextId++, card, knownTo: [pid] });
      this.turn.playsLeft--;
      this.log(target === pid
        ? `${this.name(pid)} places a card face down — they claim it is a Knight.`
        : `👑 The King places a card face down in front of ${this.name(target)} — a Knight to protect them?`, { kind: 'play' });
      return;
    }
    const ctx = { pid, card, committed: false, keep: false, extraPlays: 0 };
    this.ctx = ctx;
    try {
      await d.play(this, ctx);
      this.commit();
      if (!ctx.keep) this.discard(card);
      if (this.turn) this.turn.playsLeft += ctx.extraPlays - 1;
    } catch (e) {
      if (e instanceof Cancel && !ctx.committed) {
        this.hand(pid).push(card);
      } else {
        if (!(e instanceof Cancel)) {
          this.onError(e);
          this.log(`⚠ ${d.name} could not resolve: ${e.message}`, { kind: 'alert' });
        }
        if (!ctx.committed) { this.hand(pid).push(card); } else { this.discard(card); if (this.turn) this.turn.playsLeft--; }
      }
    } finally {
      this.ctx = null;
      this.resolving = null;
      this.emit();
    }
  }

  // King Maker: played out of turn when Betray the King is played
  async kingMakerWindow() {
    const nobles = this.nobles();
    const sides = [];
    const answers = await this.askAll(nobles, (p) => {
      const has = this.hand(p).some((c) => c.id === 'king-maker');
      return {
        kind: 'choice', title: 'Play King Maker?', card: 'king-maker',
        text: has ? 'Choose a side. If your side fails you pay 300 gold to the bank.' : 'Waiting for anyone holding King Maker…',
        options: [
          { value: 'support', label: 'King Maker: SUPPORT the King (+1 to roll)', disabled: !has },
          { value: 'oppose', label: 'King Maker: OPPOSE the King (−1 to roll)', disabled: !has },
          { value: 'pass', label: 'Pass' },
        ],
        timeoutSec: this.settings.reactionSeconds, default: 'pass',
      };
    });
    for (const p of nobles) {
      const side = answers[p];
      if (side !== 'support' && side !== 'oppose') continue;
      const c = this.hand(p).find((x) => x.id === 'king-maker');
      if (!c) continue;
      this.takeFromHand(p, c.uid);
      this.discard(c);
      sides.push({ pid: p, side });
      this.log(`👑 ${this.name(p)} plays KING MAKER and ${side === 'support' ? 'SUPPORTS the King (+1)' : 'OPPOSES the King (−1)'}!`, { kind: 'alert' });
      this.topUp(p);
    }
    return sides;
  }

  // ───────────────────────── first-time tour ─────────────────────────
  // Before round one, wait for players who asked for the guide to finish the quick tour
  // (or until the time limit), so nobody is thrown into the game unprepared.
  learnersPending() {
    if (!this.intro) return [];
    // a refresh or a brief drop doesn't count as leaving; someone who really leaves is put on
    // autopilot after a minute away, which ends their wait
    return this.seats.filter((p) => this.players[p].learning && !this.isAuto(p) && !this.intro.done.has(p));
  }

  async introPhase() {
    const secs = this.settings.introSeconds;
    this.intro = { endsAt: Date.now() + secs * 1000, done: new Set() };
    const pending = this.learnersPending().filter((p) => this.players[p].connected);
    if (!pending.length || secs <= 0) { this.intro = null; return; }
    this.phase = 'intro';
    this.log(`${pending.map((p) => this.name(p)).join(', ')} ${pending.length > 1 ? 'are' : 'is'} new to the game and taking the quick tour. Round one starts when they're ready.`);
    await new Promise((res) => {
      this.intro.finish = res;
      this.intro.timer = setTimeout(res, secs * 1000);
      this.checkIntro();
    });
    clearTimeout(this.intro.timer);
    this.intro = null;
  }

  checkIntro() {
    if (this.intro && this.intro.finish && !this.learnersPending().length) this.intro.finish();
  }

  introDone(pid) {
    if (!this.players[pid] || !this.intro || this.intro.done.has(pid)) return;
    this.intro.done.add(pid);
    this.log(`${this.name(pid)} finished the tour.`);
    this.checkIntro();
  }

  setLearning(pid, on) {
    const p = this.players[pid];
    if (!p || p.isBot) return;
    p.learning = !!on;
    this.checkIntro();
    this.emit();
  }

  // ───────────────────────── negotiation ─────────────────────────
  async negotiation() {
    const secs = this.settings.negotiationSeconds;
    this.phase = 'negotiation';
    this.neg = { endsAt: Date.now() + secs * 1000, ready: new Set(), received: {} };
    this.log(`━━ NEGOTIATION PHASE — ${secs >= 60 ? Math.round(secs / 60) + ' minute' + (secs >= 120 ? 's' : '') : secs + ' seconds'}. Trade gold (max 400 received each), exchange cards, make deals. Nothing is binding! ━━`, { kind: 'round' });
    for (const pid of this.seats) if (this.isAuto(pid)) this.neg.ready.add(pid);
    if (secs > 0) {
      await new Promise((res) => {
        this.neg.finish = res;
        this.neg.timer = setTimeout(res, secs * 1000);
        this.checkNegReady();
      });
      clearTimeout(this.neg.timer);
    }
    for (const t of this.trades.values()) { const p = this.prompts.get(t.promptId); if (p) p.resolve(null); }
    this.trades.clear();
    for (const p of [...this.prompts.values()]) if (p.negotiation) p.resolve(null);
    await this._chain; // let pending crown checks settle
    this.neg = null;
    this.phase = 'play';
    this.log('Negotiation is over.');
  }

  checkNegReady() {
    if (!this.neg || !this.neg.finish) return;
    const humans = this.seats.filter((p) => !this.isAuto(p) && this.players[p].connected);
    if (humans.every((p) => this.neg.ready.has(p))) this.neg.finish();
  }

  requireNeg() {
    if (this.phase !== 'negotiation' || !this.neg) throw new GameError('Only during the Negotiation Phase.');
  }

  setReady(pid, ready) {
    this.requireNeg();
    if (ready) this.neg.ready.add(pid); else this.neg.ready.delete(pid);
    this.log(`${this.name(pid)} ${ready ? 'is done negotiating' : 'wants to keep negotiating'}.`);
    this.checkNegReady();
  }

  giveGold(pid, to, amount) {
    this.requireNeg();
    amount = Number(amount);
    if (!this.players[to] || to === pid) throw new GameError('Choose another player.');
    if (!Number.isInteger(amount) || amount <= 0 || amount % 100 !== 0) throw new GameError('Gold moves in steps of 100.');
    if (amount > this.gold(pid)) throw new GameError('You do not have that much gold.');
    const rec = this.neg.received[to] || 0;
    if (rec + amount > 400) throw new GameError(`${this.name(to)} can only receive ${400 - rec} more gold this negotiation phase (max 400).`);
    this.neg.received[to] = rec + amount;
    this.players[pid].gold -= amount;
    const got = Math.min(MAX_GOLD, this.gold(to) + amount) - this.gold(to);
    this.players[to].gold += got;
    this.log(`🤝 ${this.name(pid)} gives ${amount} gold to ${this.name(to)}.`, { kind: 'gold' });
    this.requestCrownCheck();
  }

  offerTrade(pid, to, uid) {
    this.requireNeg();
    if (this.isKing(pid) || this.isKing(to)) throw new GameError('The King cannot exchange cards: nobles can’t hold King cards and vice versa.');
    if (!this.players[to] || to === pid) throw new GameError('Choose another noble.');
    const card = this.hand(pid).find((c) => c.uid === uid);
    if (!card) throw new GameError('That card is not in your hand.');
    if ([...this.trades.values()].some((t) => t.from === pid && t.uid === uid)) throw new GameError('You already offered that card.');
    const tid = this.nextId++;
    const { id, promise } = this.askRaw(to, {
      kind: 'cards', negotiation: true, title: `${this.name(pid)} offers you a card in exchange`,
      text: `You will receive: ${this.def(card).name}. Pick one of your cards to give back, or decline.`,
      offered: { id: card.id }, cards: this.hand(to).map((c) => ({ uid: c.uid, id: c.id })),
      options: [{ value: 'decline', label: 'Decline' }], default: 'decline',
    });
    this.trades.set(tid, { tid, from: pid, to, uid, promptId: id });
    this.log(`${this.name(pid)} offers ${this.name(to)} a card exchange.`);
    promise.then((ans) => {
      this.trades.delete(tid);
      if (!ans || ans === 'decline') { if (ans === 'decline') this.log(`${this.name(to)} declines ${this.name(pid)}'s exchange.`); return; }
      if (this.phase !== 'negotiation' || this.isKing(pid) || this.isKing(to)) return;
      const a = this.takeFromHand(pid, uid);
      const b = a && this.takeFromHand(to, ans);
      if (!a || !b) { if (a) this.hand(pid).push(a); this.log('The exchange fell through.'); return; }
      this.hand(pid).push(b);
      this.hand(to).push(a);
      this.log(`🔁 ${this.name(pid)} and ${this.name(to)} exchange a card.`);
      this.log(`You gave ${this.def(a).name} and received ${this.def(b).name}.`, { to: [pid], kind: 'private' });
      this.log(`You gave ${this.def(b).name} and received ${this.def(a).name}.`, { to: [to], kind: 'private' });
    });
  }

  discardRestriction(card) {
    const d = this.def(card);
    return d.discardRestrict ? d.discardRestrict(this) : null;
  }

  // "You can discard cards but only as a deal with someone else."
  dealDiscard(pid, partner, uid) {
    this.requireNeg();
    if (!this.players[partner] || partner === pid) throw new GameError('Choose who the deal is with.');
    const card = this.hand(pid).find((c) => c.uid === uid);
    if (!card) throw new GameError('That card is not in your hand.');
    const r = this.discardRestriction(card);
    if (r) throw new GameError(r);
    const { promise } = this.askRaw(partner, {
      kind: 'choice', negotiation: true, title: `${this.name(pid)} wants to discard a card as part of a deal with you`,
      text: 'Confirm that this discard is part of your deal.', options: [{ value: 'yes', label: 'Yes, it’s our deal' }, { value: 'no', label: 'No deal' }], default: 'no',
    });
    promise.then((ans) => {
      if (ans !== 'yes' || this.phase !== 'negotiation') { if (ans === 'no') this.log(`${this.name(partner)} rejects ${this.name(pid)}'s deal discard.`); return; }
      const c = this.takeFromHand(pid, uid);
      if (!c) return;
      this.discard(c);
      this.log(`${this.name(pid)} discards ${this.def(c).name} as part of a deal with ${this.name(partner)}.`);
      this.topUp(pid);
    });
  }

  // Royal Bomb "can only be discarded or given away by you during the Negotiation Phase"
  bombAction(pid, action, to) {
    this.requireNeg();
    const c = this.hand(pid).find((x) => x.id === 'royal-bomb');
    if (!c) throw new GameError('You do not hold the Royal Bomb.');
    if (action === 'give') {
      if (!this.nobles().includes(to) || to === pid) throw new GameError('Give it to another noble.');
      this.takeFromHand(pid, c.uid);
      this.hand(to).push(c);
      this.log(`💣 ${this.name(pid)} hands the ROYAL BOMB to ${this.name(to)}!`, { kind: 'alert' });
    } else {
      this.takeFromHand(pid, c.uid);
      this.discard(c);
      this.log(`💣 ${this.name(pid)} discards the Royal Bomb.`, { kind: 'alert' });
    }
    this.topUp(pid);
  }

  // Bad Blood: "They can make this payment out of turn."
  payBadBlood(pid, id) {
    if (this.phase === 'over') throw new GameError('The game is over.');
    const b = this.badBlood.find((x) => x.id === id);
    if (!b || (b.a !== pid && b.b !== pid)) throw new GameError('That Bad Blood is not yours to settle.');
    if (this.gold(pid) < 200) throw new GameError('You need 200 gold.');
    const other = b.a === pid ? b.b : b.a;
    this.players[pid].gold -= 200;
    this.players[other].gold = Math.min(MAX_GOLD, this.gold(other) + 200);
    this.badBlood = this.badBlood.filter((x) => x !== b);
    this.log(`${this.name(pid)} gives ${this.name(other)} 200 gold — ${this.name(b.owner)}'s Bad Blood ends.`, { kind: 'gold' });
    this.requestCrownCheck();
  }

  // Indebted: "until another player frees them by paying you 200. This payment can be made at any time."
  freeDebt(pid, id) {
    if (this.phase === 'over') throw new GameError('The game is over.');
    const d = this.debts.find((x) => x.id === id);
    if (!d) throw new GameError('That debt no longer exists.');
    if (pid === d.debtor || pid === d.owner) throw new GameError('Another player has to free them.');
    if (this.gold(pid) < 200) throw new GameError('You need 200 gold.');
    this.players[pid].gold -= 200;
    this.players[d.owner].gold = Math.min(MAX_GOLD, this.gold(d.owner) + 200);
    this.debts = this.debts.filter((x) => x !== d);
    this.log(`${this.name(pid)} pays ${this.name(d.owner)} 200 to free ${this.name(d.debtor)} from their debt.`, { kind: 'gold' });
    this.requestCrownCheck();
  }

  addChat(pid, text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    this.chat.push({ i: this.chat.length, t: Date.now(), pid, name: this.name(pid), text });
    if (this.chat.length > 300) this.chat.splice(0, 50);
    this.emit();
  }

  // ───────────────────────── bots / autopilot ─────────────────────────
  scheduleBot(pid) {
    if (!this.isAuto(pid)) return;
    const delay = this.players[pid].isBot ? this.settings.botDelayMs : Math.min(400, this.settings.botDelayMs);
    const run = () => {
      try {
        if (!this.isAuto(pid)) return;
        for (const p of this.prompts.values()) {
          if (p.pid === pid) { p.resolve(bot.answer(this, pid, p)); return; }
        }
        if (this.turn && this.turn.pid === pid && this.turn.wait && !this.busy) this.play(pid, bot.choosePlay(this, pid));
      } catch (e) { this.onError(e); }
    };
    if (delay <= 0) setImmediate(run); else setTimeout(run, delay);
  }

  setAuto(pid, on) {
    const p = this.players[pid];
    if (!p || p.isBot) return;
    p.auto = !!on;
    if (on) {
      this.scheduleBot(pid);
      for (const pr of this.prompts.values()) if (pr.pid === pid) this.scheduleBot(pid);
      if (this.neg) { this.neg.ready.add(pid); this.checkNegReady(); }
      this.checkIntro();
    }
    this.emit();
  }

  setConnected(pid, on) {
    if (!this.players[pid]) return;
    this.players[pid].connected = on;
    if (this.neg) this.checkNegReady();
    this.checkIntro();
    this.emit();
  }

  // ───────────────────────── views ─────────────────────────
  cardView(c) { return { uid: c.uid, id: c.id }; }

  view(pid) {
    const me = this.players[pid];
    const statuses = (p) => {
      const s = [];
      if (this.effects.isoLook[p] !== undefined) s.push({ id: 'iso-look', label: 'Isolation: cards hidden' });
      if (this.effects.isoGold[p] !== undefined) s.push({ id: 'iso-gold', label: 'Isolation: gold protected' });
      for (const e of this.effects.kingsEye) if (e.target === p) s.push({ id: 'kings-eye', label: "Protected by King's Eye" });
      for (const e of this.effects.tides) if (e.a === p || e.b === p) s.push({ id: 'tides', label: `Shifting Tides with ${this.name(e.a === p ? e.b : e.a)}` });
      return s;
    };
    const players = this.seats.map((p, seat) => {
      const pl = this.players[p];
      return {
        pid: p, name: pl.name, seat, gold: pl.gold, isKing: seat === 0, handCount: pl.hand.length,
        connected: pl.connected, isBot: pl.isBot, auto: pl.auto, learning: pl.learning,
        faceDown: this.fd[seat].map((f) => ({ fid: f.fid, deck: f.card.deck, known: f.knownTo.includes(pid) ? f.card.id : null })),
        bets: this.bets.filter((b) => b.owner === p).map((b) => ({ type: b.type, target: b.target, deadline: b.deadline })),
        statuses: statuses(p),
      };
    });
    const hand = me ? me.hand.map((c) => {
      const d = this.def(c);
      const reason = this.playReason(pid, c);
      return { uid: c.uid, id: c.id, playable: !d.faceDownOnly && !reason, reason, faceDownOnly: !!d.faceDownOnly, canFaceDown: c.id !== 'royal-bomb' };
    }) : [];
    const myPrompts = [...this.prompts.values()].filter((p) => p.pid === pid).map((p) => {
      const { resolve, timer, botTimer, ...rest } = p;
      return rest;
    });
    const waiting = [...this.prompts.values()].map((p) => ({ pid: p.pid, name: this.name(p.pid), title: p.title }));
    return {
      phase: this.phase, round: this.round, dir: this.dir, me: pid,
      players, hand, prompts: myPrompts, waiting,
      turn: this.turn ? { pid: this.turn.pid, playsLeft: this.turn.playsLeft, canPlay: !!this.turn.wait && !this.busy } : null,
      resolving: this.resolving,
      decks: {
        noble: { draw: this.decks.noble.draw.length, discard: this.decks.noble.discard.length, top: this.decks.noble.discard.length ? this.decks.noble.discard[this.decks.noble.discard.length - 1].id : null },
        king: { draw: this.decks.king.draw.length, discard: this.decks.king.discard.length, top: this.decks.king.discard.length ? this.decks.king.discard[this.decks.king.discard.length - 1].id : null },
      },
      badBlood: this.badBlood.map((b) => ({ ...b })),
      debts: this.debts.map((d) => ({ ...d })),
      intro: this.intro ? { endsAt: this.intro.endsAt, pending: this.learnersPending() } : null,
      negotiation: this.neg ? { endsAt: this.neg.endsAt, ready: [...this.neg.ready], received: this.neg.received } : null,
      lastRoll: this.lastRoll,
      log: this.logEntries.filter((e) => !e.to || e.to.includes(pid)).slice(-200),
      chat: this.chat.slice(-150),
      winner: this.winner,
      settings: this.settings,
    };
  }
}

module.exports = { Game, GameError, Cancel, MAX_GOLD, HAND_MIN };
