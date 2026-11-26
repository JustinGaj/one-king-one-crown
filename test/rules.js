'use strict';
// Scenario tests for specific rules and card interactions. Usage: node test/rules.js
const assert = require('assert');
const { Game } = require('../server/game');

let rolls = [];
let seq = 42;
let script = () => undefined;

function setup(n = 5, round = 2) {
  rolls = [];
  script = () => undefined;
  const players = Array.from({ length: n }, (_, i) => ({ pid: 'p' + i, name: 'P' + i }));
  let g;
  const answerAll = () => {
    for (const p of [...g.prompts.values()]) {
      let v = script(p, g);
      if (v === undefined) v = p.kind === 'roll' || p.kind === 'info' ? true : p.default;
      if (v === undefined && p.kind === 'choice') v = p.options.find((o) => !o.disabled).value;
      if (v === undefined && p.kind === 'cards') v = p.cards[0].uid;
      if (v === undefined && p.kind === 'say') v = p.prefill || 'ok';
      try { g.answer(p.pid, p.id, v); } catch (e) { /* already answered */ }
    }
  };
  g = new Game({ players, rng: () => (rolls.length ? (rolls.shift() - 1) / 6 + 0.01 : ((seq = (seq * 9301 + 49297) % 233280) / 233280)), settings: { botDelayMs: 0, negotiationSeconds: 0 }, onChange: () => setImmediate(answerAll), onError: (e) => { throw e; } });
  g.seats = players.map((p) => p.pid); // p0 is King, p1.. clockwise
  for (const p of Object.values(g.players)) { for (const c of p.hand) g.decks[c.deck].draw.push(c); p.hand = []; }
  for (const p of g.seats) g.topUp(p, false);
  g.players.p0.gold = 1000;
  for (const p of g.nobles()) g.players[p].gold = 600;
  g.phase = 'play';
  g.round = round;
  return g;
}

function give(g, pid, id) {
  const own = g.hand(pid).find((c) => c.id === id && !c.given);
  if (own) { own.given = true; return own; }
  for (const d of ['noble', 'king']) {
    for (const pile of [g.decks[d].draw, g.decks[d].discard]) {
      const i = pile.findIndex((c) => c.id === id);
      if (i >= 0) { const c = pile.splice(i, 1)[0]; g.hand(pid).push(c); return c; }
    }
    for (const p of Object.values(g.players)) {
      const i = p.hand.findIndex((c) => c.id === id);
      if (i >= 0 && p.pid !== pid) { const c = p.hand.splice(i, 1)[0]; g.hand(pid).push(c); return c; }
    }
  }
  throw new Error('no card ' + id);
}

async function play(g, pid, id, opts = {}) {
  const c = give(g, pid, id);
  if (!g.turn || g.turn.pid !== pid) g.turn = { pid, seat: g.seatOf(pid), playsLeft: g.playsFor(pid), base: g.playsFor(pid) };
  await g.resolvePlay(pid, { uid: c.uid, faceDown: !!opts.faceDown, target: opts.target || pid });
  await g.checkCrown();
  return c;
}

const pickBy = (map) => (p) => { for (const [re, v] of map) if (re.test(p.title)) return typeof v === 'function' ? v(p) : v; return undefined; };

const tests = {
  async 'Betrayal needs support, then takes all gold'() {
    let g = setup();
    script = pickBy([[/Betrayal — who/, 'p2'], [/Support/, 'no']]);
    await play(g, 'p1', 'betrayal');
    assert.strictEqual(g.gold('p2'), 600, 'no support → no effect');
    g = setup();
    script = pickBy([[/Betrayal — who/, 'p2'], [/Support/, (p) => (p.pid === 'p3' ? 'support' : 'no')]]);
    await play(g, 'p1', 'betrayal');
    assert.strictEqual(g.gold('p2'), 0);
    assert.strictEqual(g.gold('p1'), 1200);
  },
  async 'Betrayal is not playable in round 1'() {
    const g = setup(5, 1);
    const c = give(g, 'p1', 'betrayal');
    assert(g.playReason('p1', c));
  },
  async 'A real Knight blocks one Betrayal; a bluff does not'() {
    let g = setup();
    script = pickBy([[/Betrayal — who/, 'p2'], [/Support/, 'support']]);
    await play(g, 'p2', 'knight', { faceDown: true });
    await play(g, 'p1', 'betrayal');
    assert.strictEqual(g.gold('p2'), 600);
    assert.strictEqual(g.fd[2].length, 0, 'knight consumed');
    g = setup();
    script = pickBy([[/Betrayal — who/, 'p2'], [/Support/, 'support']]);
    await play(g, 'p2', 'wrath', { faceDown: true }); // bluff
    await play(g, 'p1', 'betrayal');
    assert.strictEqual(g.gold('p2'), 0);
  },
  async 'Isolation blocks other players’ cards but not Betrayal, Royal Bomb or your own cards'() {
    const g = setup();
    script = pickBy([[/Isolation/, 'gold'], [/Wrath — choose/, 'big'], [/Wrath — which/, 'p1'], [/Betrayal — who/, 'p1'], [/Support/, 'support']]);
    await play(g, 'p1', 'isolation');
    await play(g, 'p2', 'wrath');
    assert.strictEqual(g.gold('p1'), 600, 'protected from Wrath');
    assert.strictEqual(g.gold('p2'), 500, 'Wrath user still pays 100');
    await play(g, 'p3', 'betrayal');
    assert.strictEqual(g.gold('p1'), 0, 'Betrayal ignores Isolation');
  },
  async 'Royal Bomb hits every noble including the player, not the King'() {
    const g = setup();
    g.effects.isoGold.p2 = 99;
    await play(g, 'p1', 'royal-bomb');
    for (const p of g.nobles()) assert.strictEqual(g.gold(p), 0);
    assert.strictEqual(g.gold('p0'), 1000);
  },
  async 'Gold is capped at 2000 and floors at 0'() {
    const g = setup();
    g.players.p1.gold = 1900;
    script = pickBy([[/Shadow Deal/, 'p1'], [/How much/, 200]]);
    await play(g, 'p2', 'shadow-deal');
    assert.strictEqual(g.gold('p1'), 2000);
    g.players.p3.gold = 100;
    script = pickBy([[/Wrath — choose/, 'small'], [/Wrath — who/, 'p3']]);
    await play(g, 'p2', 'wrath');
    g.lose('p3', 500, {});
    assert.strictEqual(g.gold('p3'), 0);
  },
  async 'Having more gold than the King takes the crown: seats and hands swap, knights stay with the seat'() {
    const g = setup();
    await play(g, 'p2', 'knight', { faceDown: true });
    const nobleHand = g.hand('p2').map((c) => c.uid);
    g.players.p2.gold = 1100;
    await g.checkCrown();
    assert.strictEqual(g.king(), 'p2');
    assert.strictEqual(g.seats[2], 'p0', 'old King takes the noble seat');
    assert.strictEqual(g.gold('p2'), 1100, 'gold does not swap');
    assert(g.hand('p0').every((c) => c.deck === 'noble'));
    assert(g.hand('p2').every((c) => c.deck === 'king'));
    assert(nobleHand.every((u) => g.hand('p0').some((c) => c.uid === u)), 'old King received the noble hand');
    assert.strictEqual(g.fd[2].length, 1, 'knight stays in front of the seat');
  },
  async 'Two players passing the King at once roll off; the loser pays 100'() {
    const g = setup();
    g.players.p1.gold = 1200; g.players.p2.gold = 1200;
    rolls = [2, 5];
    await g.checkCrown();
    assert.strictEqual(g.king(), 'p2');
    assert.strictEqual(g.gold('p1'), 1100);
  },
  async 'Betray the King: needs TWO supporters; roll 1–3 switches places and gold'() {
    const g = setup();
    script = pickBy([[/Support/, 'support'], [/King Maker/, 'pass']]);
    rolls = [2];
    await play(g, 'p1', 'betray-the-king');
    assert.strictEqual(g.king(), 'p1');
    assert.strictEqual(g.gold('p1'), 1000);
    assert.strictEqual(g.gold('p0'), 600);
  },
  async 'Betray the King: roll 4–6 the King stays and gains 200'() {
    const g = setup();
    script = pickBy([[/Support/, 'support'], [/King Maker/, 'pass']]);
    rolls = [5];
    await play(g, 'p1', 'betray-the-king');
    assert.strictEqual(g.king(), 'p0');
    assert.strictEqual(g.gold('p0'), 1200);
  },
  async 'King Maker +1 can save the King; the failed side pays 300'() {
    const g = setup();
    give(g, 'p3', 'king-maker');
    give(g, 'p4', 'king-maker');
    script = pickBy([[/Support/, 'support'], [/King Maker/, (p) => (p.pid === 'p3' ? 'support' : p.pid === 'p4' ? 'support' : 'pass')]]);
    rolls = [2]; // 2 + 2 = 4 → King wins
    await play(g, 'p1', 'betray-the-king');
    assert.strictEqual(g.king(), 'p0');
    assert.strictEqual(g.gold('p3'), 600);
    assert(!g.hand('p3').some((c) => c.id === 'king-maker'), 'King Maker was used');
  },
  async 'King Maker on the losing side pays 300'() {
    const g = setup();
    give(g, 'p3', 'king-maker');
    script = pickBy([[/Support/, 'support'], [/King Maker/, (p) => (p.pid === 'p3' ? 'oppose' : 'pass')]]);
    rolls = [5]; // 5 - 1 = 4 → King wins, opposer fails
    await play(g, 'p1', 'betray-the-king');
    assert.strictEqual(g.king(), 'p0');
    assert.strictEqual(g.gold('p3'), 300);
  },
  async 'Helping Hand: does not count and gives one extra play'() {
    const g = setup();
    g.turn = { pid: 'p1', seat: 1, playsLeft: 2, base: 2 };
    const before = g.hand('p1').length;
    await play(g, 'p1', 'helping-hand');
    assert.strictEqual(g.turn.playsLeft, 3, 'noble plays 3 more');
    assert.strictEqual(g.hand('p1').length, before + 2);
    g.turn = { pid: 'p0', seat: 0, playsLeft: 3, base: 3 };
    await play(g, 'p0', 'king-helping-hand');
    assert.strictEqual(g.turn.playsLeft, 4, 'King plays 4 more');
  },
  async 'King plays 3 cards, or 2 with only 3 nobles'() {
    assert.strictEqual(setup(5).playsFor('p0'), 3);
    assert.strictEqual(setup(4).playsFor('p0'), 2);
    assert.strictEqual(setup(4).playsFor('p1'), 2);
  },
  async 'Divine Right / People’s Champion round limits'() {
    const g = setup(5, 2);
    g.players.p1.gold = 200;
    assert(g.playReason('p1', give(g, 'p1', 'divine-right')));
    g.round = 3;
    assert(!g.playReason('p1', g.hand('p1').find((c) => c.id === 'divine-right')));
    g.players.p1.gold = 400;
    assert(g.playReason('p1', g.hand('p1').find((c) => c.id === 'divine-right')), 'needs ≤300 gold');
    assert(g.playReason('p1', give(g, 'p1', 'peoples-champion')));
    g.round = 4;
    assert(!g.playReason('p1', g.hand('p1').find((c) => c.id === 'peoples-champion')));
  },
  async 'People’s Champion: all nobles agree, nominee wins the roll and swaps gold'() {
    const g = setup(5, 4);
    script = pickBy([[/nominate/, 'p3'], [/challenge/, 'yes']]);
    rolls = [6, 1];
    await play(g, 'p1', 'peoples-champion');
    assert.strictEqual(g.king(), 'p3');
    assert.strictEqual(g.gold('p3'), 1000);
  },
  async 'Hindsight pays when the backed noble plays Betrayal'() {
    const g = setup();
    script = pickBy([[/Hindsight/, 'p2'], [/Betrayal — who/, 'p3'], [/Support/, 'no']]);
    await play(g, 'p1', 'hindsight');
    await play(g, 'p2', 'betrayal');
    assert.strictEqual(g.gold('p1'), 900);
    assert.strictEqual(g.bets.length, 0);
  },
  async 'Scout pays when the backed noble becomes King; failed bets cost 100 at the deadline'() {
    let g = setup();
    script = pickBy([[/Scout/, 'p2']]);
    await play(g, 'p1', 'scout');
    g.players.p2.gold = 1500;
    await g.checkCrown();
    assert.strictEqual(g.gold('p1'), 900);
    g = setup();
    script = pickBy([[/Scout/, 'p2']]);
    await play(g, 'p1', 'scout');
    g.round = 3;
    g.roundEnd();
    assert.strictEqual(g.gold('p1'), 500);
  },
  async 'Shifting Tides: chosen nobles can only take gold from each other'() {
    const g = setup();
    script = pickBy([[/first noble/, 'p1'], [/second noble/, 'p2'], [/pick the player who must agree/, 'p3'], [/take 200 from/, 'p4'], [/Grudge:/, 'agree']]);
    await play(g, 'p0', 'shifting-tides');
    await play(g, 'p1', 'grudge');
    assert.strictEqual(g.gold('p4'), 600, 'blocked by Shifting Tides');
  },
  async 'Sub Rosa cannot look at an Isolated hand; King’s Eye fines a noble who looks'() {
    const g = setup();
    g.effects.isoLook.p2 = 99;
    script = pickBy([[/whose secrets/, (p) => { assert(p.options.find((o) => o.value === 'p2').disabled); return 'p3'; }]]);
    rolls = [1];
    g.effects.kingsEye.push({ owner: 'p0', target: 'p3', until: 99 });
    await play(g, 'p1', 'sub-rosa');
    assert.strictEqual(g.gold('p1'), 500);
  },
  async 'Sub Rosa on a 4+ steals a card; a Royal Bomb cannot be stolen'() {
    const g = setup();
    give(g, 'p2', 'royal-bomb');
    script = pickBy([[/whose secrets/, 'p2'], [/Take a card/, (p) => { assert(!p.cards.some((c) => c.id === 'royal-bomb')); return p.cards[0].uid; }]]);
    rolls = [4];
    const victimCards = g.hand('p2').map((c) => c.uid);
    await play(g, 'p1', 'sub-rosa');
    assert.strictEqual(g.hand('p1').filter((c) => victimCards.includes(c.uid)).length, 1, 'took exactly one of their cards');
    assert(g.hand('p2').length >= 8, 'victim draws a replacement');
  },
  async 'Bad Blood pays 200 each round until settled'() {
    const g = setup();
    script = pickBy([[/first noble/, 'p2'], [/second noble/, 'p3']]);
    await play(g, 'p1', 'bad-blood');
    g.roundStart();
    assert.strictEqual(g.gold('p1'), 800);
    g.payBadBlood('p2', g.badBlood[0].id);
    assert.strictEqual(g.gold('p3'), 800);
    g.roundStart();
    assert.strictEqual(g.gold('p1'), 800);
  },
  async 'Indebted: 100 per round until another player pays 200; gone if owner becomes King'() {
    const g = setup();
    script = pickBy([[/Indebted/, 'p2']]);
    rolls = [3];
    await play(g, 'p1', 'indebted');
    g.roundStart();
    assert.strictEqual(g.gold('p2'), 500);
    assert.strictEqual(g.gold('p1'), 700);
    assert.throws(() => g.freeDebt('p2', g.debts[0].id));
    g.freeDebt('p3', g.debts[0].id);
    assert.strictEqual(g.debts.length, 0);
  },
  async 'Icarus requires affording 100 per other noble'() {
    const g = setup();
    g.players.p1.gold = 200;
    assert(g.playReason('p1', give(g, 'p1', 'icarus')));
    g.players.p1.gold = 300;
    assert(!g.playReason('p1', g.hand('p1').find((c) => c.id === 'icarus')));
    rolls = [2];
    await play(g, 'p1', 'icarus');
    assert.strictEqual(g.gold('p1'), 0);
    assert.strictEqual(g.gold('p2'), 700);
  },
  async 'Mad King: 1s lose 300, the King loses 500'() {
    const g = setup();
    g.players.p0.gold = 1500;
    rolls = [1, 1, 6, 6, 6];
    await play(g, 'p0', 'mad-king');
    assert.strictEqual(g.gold('p0'), 1000);
    assert.strictEqual(g.gold('p1'), 300);
    assert.strictEqual(g.gold('p2'), 600);
  },
  async 'Snakes: one raised hand is enough'() {
    const g = setup();
    script = pickBy([[/Snakes — pick/, 'p2'], [/raise your hand/, (p) => (p.pid === 'p4' ? 'raise' : 'down')]]);
    await play(g, 'p0', 'snakes');
    assert.strictEqual(g.gold('p2'), 300);
  },
  async 'Negotiation: a player cannot receive more than 400 gold'() {
    const g = setup();
    g.phase = 'negotiation';
    g.neg = { endsAt: 0, ready: new Set(), received: {} };
    g.giveGold('p1', 'p2', 300);
    assert.throws(() => g.giveGold('p3', 'p2', 200));
    g.giveGold('p3', 'p2', 100);
    assert.strictEqual(g.gold('p2'), 1000);
  },
  async 'Royal Bomb is discarded when its holder becomes King'() {
    const g = setup();
    give(g, 'p1', 'royal-bomb');
    g.players.p1.gold = 1500;
    await g.checkCrown();
    assert(!g.hand('p0').some((c) => c.id === 'royal-bomb'));
    assert(!g.hand('p1').some((c) => c.id === 'royal-bomb'));
  },
  async 'Face-down cards can be bluffs; the King places them in front of a noble'() {
    const g = setup();
    g.turn = { pid: 'p0', seat: 0, playsLeft: 3, base: 3 };
    await play(g, 'p0', 'eye-for-an-eye', { faceDown: true, target: 'p3' });
    assert.strictEqual(g.fd[3].length, 1);
    assert.strictEqual(g.view('p3').players[3].faceDown[0].known, null, 'the noble can’t see it');
    assert.strictEqual(g.view('p0').players[3].faceDown[0].known, 'eye-for-an-eye', 'the King knows');
    assert.strictEqual(g.turn.playsLeft, 2, 'counts as a card played');
  },
  async 'Unprotected removes every face-down card except yours'() {
    const g = setup();
    await play(g, 'p1', 'knight', { faceDown: true });
    await play(g, 'p2', 'wrath', { faceDown: true });
    rolls = [6];
    await play(g, 'p1', 'unprotected');
    assert.strictEqual(g.fd[1].length, 1);
    assert.strictEqual(g.fd[2].length, 0);
  },
  async 'Scapegoat: most votes loses 300; ties roll'() {
    const g = setup();
    script = pickBy([[/Scapegoat/, (p) => (p.pid === 'p1' ? 'p2' : p.pid === 'p2' ? 'p1' : p.pid === 'p3' ? 'p1' : 'p2')]]);
    rolls = [3, 5];
    await play(g, 'p0', 'scapegoat');
    assert.deepStrictEqual([g.gold('p1'), g.gold('p2')].sort(), [300, 600], 'exactly one tied noble is the scapegoat');
    assert.strictEqual(g.gold('p3'), 600);
  },
  async 'Royal Parrot: the King judges whether it was really said'() {
    let g = setup();
    script = pickBy([[/who is your parrot/, 'p1'], [/really say it/, 'yes']]);
    await play(g, 'p0', 'royal-parrot');
    assert.strictEqual(g.gold('p1'), 500, 'pays 100, the King accepts the line');
    g = setup();
    script = pickBy([[/who is your parrot/, 'p1'], [/really say it/, 'no']]);
    await play(g, 'p0', 'royal-parrot');
    assert.strictEqual(g.gold('p1'), 200, 'the King did not hear it: counts as refusing (100 + 300)');
  },
  async 'Bend the Knee: a player who cannot afford to refuse must say it again'() {
    const g = setup();
    g.players.p1.gold = 200;
    let asked = 0;
    script = pickBy([[/who must thank you/, 'p1'], [/really say it/, () => (++asked === 1 ? 'no' : 'yes')]]);
    await play(g, 'p0', 'bend-the-knee');
    assert.strictEqual(asked, 2, 'asked to say it twice');
    assert.strictEqual(g.gold('p1'), 200, 'no gold lost');
  },
  async 'First-time players: round one waits for the tour, then starts'() {
    const players = ['a', 'b', 'c', 'd'].map((pid, i) => ({ pid, name: pid.toUpperCase(), learning: i < 2, isBot: i === 3 }));
    const g = new Game({ players, settings: { botDelayMs: 0, negotiationSeconds: 0, introSeconds: 60 }, onError: (e) => { throw e; } });
    g.start();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(g.phase, 'intro');
    assert.deepStrictEqual(g.view('a').intro.pending.sort(), ['a', 'b']);
    assert.strictEqual(g.view('a').players.find((p) => p.pid === 'a').learning, true);
    g.introDone('a');
    assert.strictEqual(g.phase, 'intro', 'still waiting for b');
    g.setLearning('b', false); // b turns the guide off instead
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(g.round, 1);
    assert.notStrictEqual(g.phase, 'intro');
    assert.strictEqual(g.intro, null);
    for (const p of g.seats) g.setAuto(p, true); // let the rest of the game finish
  },
  async 'No tour wait when nobody asked for it'() {
    const players = ['a', 'b', 'c', 'd'].map((pid) => ({ pid, name: pid.toUpperCase() }));
    const g = new Game({ players, settings: { botDelayMs: 0, negotiationSeconds: 0 }, onError: (e) => { throw e; } });
    g.start();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(g.round, 1);
    assert.notStrictEqual(g.phase, 'intro');
    for (const p of g.seats) g.setAuto(p, true);
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n    ', e.message); }
  }
  console.log(failed ? `${failed} failed` : `All ${Object.keys(tests).length} rule tests passed.`);
  process.exit(failed ? 1 : 0);
})();
