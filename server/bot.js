'use strict';
// Simple random-but-legal player. Used for AI seats, for players who are away
// (autopilot), and for the automated full-game simulation tests.

function pick(g, arr) { return arr[Math.floor(g.rng() * arr.length)]; }

function answer(g, pid, p) {
  switch (p.kind) {
    case 'choice': {
      const opts = (p.options || []).filter((o) => !o.disabled);
      if (!opts.length) return p.default;
      return pick(g, opts).value;
    }
    case 'cards': {
      if (p.negotiation && g.rng() < 0.5) return 'decline';
      const cards = (p.cards || []).filter((c) => !c.disabled);
      if (cards.length) return pick(g, cards).uid;
      return p.default;
    }
    case 'say':
      if (p.allowRefuse && !p.refuseDisabled && g.rng() < 0.3) return 'refuse';
      return p.exact || p.prefill || 'Long live the King!';
    default:
      return true;
  }
}

function choosePlay(g, pid) {
  const hand = g.hand(pid);
  const playable = hand.filter((c) => !g.def(c).faceDownOnly && !g.playReason(pid, c));
  const king = g.isKing(pid);
  if (playable.length && g.rng() < 0.8) return { uid: pick(g, playable).uid };
  const fd = hand.filter((c) => c.id !== 'royal-bomb');
  if (!fd.length) return { uid: pick(g, playable).uid };
  return { uid: pick(g, fd).uid, faceDown: true, target: king ? pick(g, g.nobles()) : pid };
}

module.exports = { answer, choosePlay };
