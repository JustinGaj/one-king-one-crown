'use strict';
// Plays many complete games with bots and checks the rules' invariants.
// Usage: node test/sim.js [games=200]
const assert = require('assert');
const { Game } = require('../server/game');
const { DEFS } = require('../server/cards');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countCards(g) {
  const n = { noble: 0, king: 0 };
  const add = (c) => { n[c.deck]++; };
  for (const d of ['noble', 'king']) { g.decks[d].draw.forEach(add); g.decks[d].discard.forEach(add); }
  for (const p of Object.values(g.players)) p.hand.forEach(add);
  g.fd.forEach((a) => a.forEach((f) => add(f.card)));
  g.bets.forEach((b) => add(b.card));
  if (g.ctx) add(g.ctx.card);
  return n;
}

function check(g) {
  for (const p of Object.values(g.players)) {
    assert(p.gold >= 0 && p.gold <= 2000, `gold out of range: ${p.gold}`);
    assert(p.gold % 100 === 0, `gold not a multiple of 100: ${p.gold}`);
  }
  assert.strictEqual(new Set(g.seats).size, g.seats.length, 'duplicate seat');
  const k = g.seats[0];
  for (const c of g.players[k].hand) assert.strictEqual(c.deck, 'king', 'King holds a noble card');
  for (const p of g.nobles()) for (const c of g.players[p].hand) assert.strictEqual(c.deck, 'noble', 'Noble holds a King card');
  const n = countCards(g);
  assert.strictEqual(n.noble, 74, `noble cards ${n.noble}`);
  assert.strictEqual(n.king, 25, `king cards ${n.king}`);
}

async function playOne(seed, nPlayers) {
  const rng = mulberry32(seed);
  const players = Array.from({ length: nPlayers }, (_, i) => ({ pid: 'p' + i, name: 'Bot' + i, isBot: true }));
  let errors = [];
  const g = new Game({
    players, rng,
    settings: { botDelayMs: 0, negotiationSeconds: 0 },
    onError: (e) => errors.push(e),
  });
  const played = {};
  const origResolve = g.resolvePlay.bind(g);
  g.resolvePlay = async (pid, a) => {
    if (g.turn && !g.turn.checked) {
      g.turn.checked = true;
      for (const p of g.seats) {
        const d = g.decks[g.deckOf(p)];
        assert(g.hand(p).length >= 8 || d.draw.length + d.discard.length === 0, `hand below 8 at turn start: ${g.hand(p).length}`);
      }
    }
    const c = g.hand(pid).find((x) => x.uid === a.uid);
    if (c) played[a.faceDown ? 'face-down' : c.id] = (played[a.faceDown ? 'face-down' : c.id] || 0) + 1;
    await origResolve(pid, a);
    check(g);
  };
  check(g);
  await Promise.race([g.start(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout seed ' + seed)), 20000))]);
  if (errors.length) throw errors[0];
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.winner, g.seats[0]);
  check(g);
  return { played, crowns: g.logEntries.filter((e) => e.kind === 'crown').length };
}

(async () => {
  const games = Number(process.argv[2] || 200);
  const totals = {};
  let crowns = 0;
  for (let i = 0; i < games; i++) {
    const np = 4 + (i % 5);
    try {
      const r = await playOne(1000 + i, np);
      crowns += r.crowns;
      for (const [k, v] of Object.entries(r.played)) totals[k] = (totals[k] || 0) + v;
    } catch (e) {
      console.error(`Game ${i} (seed ${1000 + i}, ${np} players) failed:`, e);
      process.exit(1);
    }
  }
  const never = Object.keys(DEFS).filter((id) => !totals[id] && !DEFS[id].reactionOnly && !DEFS[id].faceDownOnly);
  console.log(`OK — ${games} full games, ${crowns} crown changes.`);
  console.log('Cards played:', Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  if (never.length) { console.error('Never played:', never.join(', ')); process.exit(1); }
  process.exit(0);
})();
