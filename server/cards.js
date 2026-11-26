'use strict';
// Every card in One King One Crown (official print-and-play edition).
// Noble deck: 74 cards. King deck: 25 cards. Card text is transcribed from the cards.
// play(g, ctx) resolves the card. ctx = { pid, card, committed, keep, extraPlays }.
// Prompts with { cancel: true } let the player take the card back until something happens.

const others = (g, pid) => g.others(pid);
const noblesBut = (g, ...ex) => g.nobles().filter((p) => !ex.includes(p));
const lookBlocked = (g) => (p) => (g.effects.isoLook[p] !== undefined ? 'Isolation: their cards can’t be looked at' : null);
const say = (g, pid, title, o) => g.say(pid, title, o);
const resp = (g) => g.settings.responseSeconds;

// Everyone in `pids` says something at the same time
async function sayAll(g, pids, title, prefill) {
  await g.askAll(pids, () => ({ kind: 'say', title, prefill, timeoutSec: g.settings.sayingSeconds, default: prefill }))
    .then((ans) => { for (const p of pids) if (ans[p]) g.log(`🗣 ${g.name(p)}: “${ans[p]}”`, { kind: 'say' }); });
}

// Simultaneous public vote. Returns { pid: value }
async function vote(g, pids, title, text, options, def) {
  const ans = await g.askAll(pids, () => ({ kind: 'choice', title, text, options, timeoutSec: g.settings.voteSeconds, default: def }));
  for (const p of pids) if (ans[p] == null) ans[p] = def;
  const labels = Object.fromEntries(options.map((o) => [o.value, o.label]));
  g.log(`Votes — ${pids.map((p) => `${g.name(p)}: ${labels[ans[p]]}`).join(', ')}`, { kind: 'vote' });
  return ans;
}

const NOBLE = [
  {
    id: 'actors', name: 'Actors', copies: 3,
    text: 'Everyone must thank the king for their glorious rule however horrible and cruel it might have been. ┄┄ Everyone must laugh at the player of your choice.',
    async play(g, ctx) {
      const opt = await g.choose(ctx.pid, 'Actors — choose one', [
        { value: 'thank', label: 'Everyone must thank the King for their glorious rule' },
        { value: 'laugh', label: 'Everyone must laugh at the player of your choice' },
      ], { cancel: true });
      if (opt === 'thank') {
        g.commit();
        await sayAll(g, noblesBut(g), 'Actors: thank the King for their glorious rule!', 'Thank you, my King, for your glorious rule!');
      } else {
        const t = await g.pickPlayer(ctx.pid, 'Who must everyone laugh at?', g.seats);
        g.log(`Everyone must laugh at ${g.name(t)}!`);
        await sayAll(g, g.seats.filter((p) => p !== t), `Actors: laugh at ${g.name(t)}!`, 'HA HA HA HA!');
      }
    },
  },
  {
    id: 'allies', name: 'Allies', copies: 3,
    text: 'Pick a noble. They choose if you gain 100 gold or lose 200 to the bank. Other players can convince them to take the second option.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Allies — pick a noble', noblesBut(g, ctx.pid));
      const c = await g.choose(t, `Allies: decide ${g.name(ctx.pid)}'s fate`, [
        { value: 'gain', label: `${g.name(ctx.pid)} gains 100 gold` },
        { value: 'lose', label: `${g.name(ctx.pid)} loses 200 to the bank` },
      ], { text: 'Other players may try to convince you to take the second option.', timeoutSec: resp(g), default: 'gain' });
      if (c === 'gain') g.gain(ctx.pid, 100); else g.lose(ctx.pid, 200, { by: ctx.pid, card: 'allies' });
    },
  },
  {
    id: 'bad-blood', name: 'Bad Blood', copies: 3,
    text: 'Pick two nobles. You gain 200 gold from the bank at the beginning of every round until one of them gives the other 200 gold. They can make this payment out of turn.',
    async play(g, ctx) {
      const a = await g.pickPlayer(ctx.pid, 'Bad Blood — pick the first noble', noblesBut(g, ctx.pid));
      const b = await g.pickPlayer(ctx.pid, 'Bad Blood — pick the second noble', noblesBut(g, ctx.pid, a));
      g.commit();
      g.badBlood.push({ id: g.nextId++, owner: ctx.pid, a, b });
      g.log(`Bad Blood between ${g.name(a)} and ${g.name(b)}: ${g.name(ctx.pid)} gains 200 every round until one of them gives the other 200.`);
    },
  },
  {
    id: 'beggars-blessing', name: "Beggar's Blessing", copies: 3,
    text: 'All nobles with 300 gold or lower gain 200.',
    async play(g) {
      g.commit();
      const poor = g.nobles().filter((p) => g.gold(p) <= 300);
      if (!poor.length) g.log('No noble has 300 gold or lower.');
      for (const p of poor) g.gain(p, 200);
    },
  },
  {
    id: 'betrayal', name: 'Betrayal', copies: 4,
    text: 'Take all gold from another noble. Requires vocal support from another noble after it’s played or it has no effect. Not playable in the first round.',
    restrict: (g) => (g.round === 1 ? 'Not playable in the first round.' : null),
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Betrayal — who do you betray?', noblesBut(g, ctx.pid));
      g.commit();
      g.log(`🗡 ${g.name(ctx.pid)} BETRAYS ${g.name(t)}!`, { kind: 'alert' });
      // Hindsight: anyone who backed this noble to play Betrayal wins their bet
      for (const b of g.bets.filter((b) => b.type === 'hindsight' && b.target === ctx.pid)) {
        g.bets.splice(g.bets.indexOf(b), 1);
        g.discard(b.card);
        g.log(`Hindsight pays off for ${g.name(b.owner)}!`);
        g.gain(b.owner, 300);
      }
      const ok = await g.supportWindow(ctx.pid, noblesBut(g, ctx.pid), 1, 'Betrayal');
      if (!ok || !g.players[t]) return;
      if (g.isKing(t)) { g.log(`${g.name(t)} is now the King — the Betrayal fizzles.`); return; }
      const seat = g.seatOf(t);
      const real = g.fd[seat].find((f) => f.card.id === 'knight' || f.card.id === 'king-knight');
      if (real) {
        g.fd[seat].splice(g.fd[seat].indexOf(real), 1);
        g.discard(real.card);
        g.log(`🛡 A real KNIGHT protects ${g.name(t)}! The Knight is discarded.`, { kind: 'alert' });
        return;
      }
      if (g.fd[seat].length) g.log(`${g.name(t)}'s face-down “Knights” offer no protection…`, { kind: 'alert' });
      const amt = g.gold(t);
      g.lose(t, amt, { by: ctx.pid, card: 'betrayal', to: ctx.pid });
    },
  },
  {
    id: 'betray-the-king', name: 'Betray the King', copies: 2,
    text: 'The King rolls: 1–3, you switch places and gold. 4–6, they remain king and gain 200 gold from the bank. After it’s played, you must gain vocal support from TWO players or it has no effect. Not playable in the first round.',
    restrict: (g) => (g.round === 1 ? 'Not playable in the first round.' : null),
    async play(g, ctx) {
      g.commit();
      const king = g.king();
      g.log(`🗡👑 ${g.name(ctx.pid)} tries to BETRAY THE KING!`, { kind: 'alert' });
      const ok = await g.supportWindow(ctx.pid, g.others(ctx.pid).filter((p) => p !== king), 2, 'Betray the King');
      if (!ok) return;
      const makers = await g.kingMakerWindow();
      if (g.king() !== king || g.isKing(ctx.pid)) { g.log('The crown already changed hands — Betray the King fizzles.'); return; }
      const roll = await g.rollDie(king, 'Betray the King');
      const mod = makers.reduce((s, m) => s + (m.side === 'support' ? 1 : -1), 0);
      const total = roll + mod;
      if (mod) g.log(`King Maker modifies the roll by ${mod > 0 ? '+' : ''}${mod}: ${total}.`);
      const kingWins = total >= 4;
      if (kingWins) {
        g.log(`The King survives the betrayal (${total}).`, { kind: 'alert' });
        g.gain(king, 200);
      } else {
        g.crownChange(ctx.pid, { swapGold: true, reason: `wins the Betray the King roll (${total})` });
      }
      for (const m of makers) {
        const failed = (m.side === 'support') !== kingWins;
        if (failed) { g.log(`${g.name(m.pid)}'s King Maker side failed.`); g.lose(m.pid, 300, { by: m.pid, card: 'king-maker' }); }
      }
    },
  },
  {
    id: 'council-meeting', name: 'Council Meeting', copies: 3,
    text: 'If all players vote yes, you take 100 gold from the king. If one votes no, you lose 100 to the bank. ┄┄ Draw two cards, but you must praise the king.',
    async play(g, ctx) {
      const opt = await g.choose(ctx.pid, 'Council Meeting — choose one', [
        { value: 'vote', label: 'Call a vote: all yes → take 100 from the King; one no → lose 100' },
        { value: 'draw', label: 'Draw two cards, but you must praise the King' },
      ], { cancel: true });
      g.commit();
      if (opt === 'vote') {
        const voters = g.others(ctx.pid);
        const v = await vote(g, voters, `Council Meeting: should ${g.name(ctx.pid)} take 100 gold from the King?`, 'If even one player votes no, they lose 100 instead.', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], 'no');
        if (voters.every((p) => v[p] === 'yes')) g.lose(g.king(), 100, { by: ctx.pid, card: 'council-meeting', to: ctx.pid });
        else g.lose(ctx.pid, 100, { by: ctx.pid, card: 'council-meeting' });
      } else {
        const n = g.draw(ctx.pid, 2);
        g.log(`${g.name(ctx.pid)} draws ${n} cards and must praise the King.`);
        await say(g, ctx.pid, 'Council Meeting: praise the King!', { prefill: 'All hail our wise and generous King!' });
      }
    },
  },
  {
    id: 'divine-right', name: 'Divine Right', copies: 1,
    text: 'If you roll 5+: You gain 1200 gold. Play only if you have 300 gold or less. Can only be played or discarded in the last 2 rounds.',
    restrict: (g, pid) => (g.round < 3 ? 'Only in the last 2 rounds.' : g.gold(pid) > 300 ? 'Play only if you have 300 gold or less.' : null),
    discardRestrict: (g) => (g.round < 3 ? 'Divine Right can only be discarded in the last 2 rounds.' : null),
    async play(g, ctx) {
      const r = await g.rollDie(ctx.pid, 'Divine Right (5+)');
      if (r >= 5) { g.log('✨ Divine Right!'); g.gain(ctx.pid, 1200); } else g.log('The heavens are silent.');
    },
  },
  {
    id: 'grudge', name: 'Grudge', copies: 2,
    text: 'Pick a player. They have to agree to you taking 200 gold from the noble of your choice. If they disagree, you lose 100 gold to the bank.',
    async play(g, ctx) {
      const judge = await g.pickPlayer(ctx.pid, 'Grudge — pick the player who must agree', others(g, ctx.pid));
      const victim = await g.pickPlayer(ctx.pid, 'Grudge — which noble do you want to take 200 from?', noblesBut(g, ctx.pid));
      const c = await g.choose(judge, `Grudge: let ${g.name(ctx.pid)} take 200 gold from ${g.name(victim)}?`, [
        { value: 'agree', label: 'Agree' }, { value: 'disagree', label: `Disagree (${g.name(ctx.pid)} loses 100)` },
      ], { timeoutSec: resp(g), default: 'disagree' });
      g.log(`${g.name(judge)} ${c === 'agree' ? 'agrees' : 'disagrees'}.`);
      if (c === 'agree') g.lose(victim, 200, { by: ctx.pid, card: 'grudge', to: ctx.pid });
      else g.lose(ctx.pid, 100, { by: ctx.pid, card: 'grudge' });
    },
  },
  {
    id: 'helping-hand', name: 'Helping Hand', copies: 3,
    text: 'Draw 2 extra cards and play an extra card. So, if this is your first card, you get to play 3 more now.',
    async play(g, ctx) {
      g.commit();
      const n = g.draw(ctx.pid, 2);
      g.log(`${g.name(ctx.pid)} draws ${n} cards and may play an extra card.`);
      ctx.extraPlays = 2; // Helping Hand itself doesn't count, plus one extra play
    },
  },
  {
    id: 'hindsight', name: 'Hindsight', copies: 2,
    text: 'Back a specific noble to play the “Betrayal” card before the end of the next round. If correct, gain 300 gold from the bank. If not, lose 100. Keep this in front of you until then.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Hindsight — who will play “Betrayal” before the end of next round?', g.nobles());
      g.commit();
      ctx.keep = true;
      g.bets.push({ type: 'hindsight', owner: ctx.pid, target: t, deadline: g.round + 1, card: ctx.card });
      g.log(`${g.name(ctx.pid)} bets that ${g.name(t)} will play Betrayal before the end of round ${g.round + 1}.`);
    },
  },
  {
    id: 'icarus', name: 'Icarus', copies: 2,
    text: 'If you roll a 4-6, all nobles must pay you 100 gold. If you fail, you must pay each noble 100 gold. You can only play this card if you can afford it.',
    restrict: (g, pid) => (g.gold(pid) < 100 * noblesBut(g, pid).length ? 'You can’t afford it.' : null),
    async play(g, ctx) {
      const r = await g.rollDie(ctx.pid, 'Icarus (4–6)');
      const rest = noblesBut(g, ctx.pid);
      if (r >= 4) { g.log('Icarus soars!'); for (const p of rest) g.lose(p, 100, { by: ctx.pid, card: 'icarus', to: ctx.pid }); } else { g.log('Icarus falls…'); for (const p of rest) g.lose(ctx.pid, 100, { by: ctx.pid, card: 'icarus', to: p }); }
    },
  },
  {
    id: 'indebted', name: 'Indebted', copies: 2,
    text: 'If you roll a 3-6, a noble has to pay you 100 gold at the beginning of every round until another player frees them by paying you 200. This payment can be made at any time. Any debts are gone if you become king.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Indebted — which noble?', noblesBut(g, ctx.pid));
      const r = await g.rollDie(ctx.pid, 'Indebted (3–6)');
      if (r >= 3) {
        g.debts.push({ id: g.nextId++, owner: ctx.pid, debtor: t });
        g.log(`${g.name(t)} is now INDEBTED to ${g.name(ctx.pid)}: 100 gold at the start of every round until someone pays ${g.name(ctx.pid)} 200 to free them.`);
      } else g.log('The debt does not stick.');
    },
  },
  {
    id: 'isolation', name: 'Isolation', copies: 3,
    text: 'No one can look at your cards until the end of your next turn. ┄┄ No one can take gold from you until the end of your next turn. This does not apply to the Betrayal card.',
    async play(g, ctx) {
      const opt = await g.choose(ctx.pid, 'Isolation — choose one', [
        { value: 'look', label: 'No one can look at your cards until the end of your next turn' },
        { value: 'gold', label: 'No one can take gold from you until the end of your next turn (not Betrayal / Royal Bomb)' },
      ], { cancel: true });
      g.commit();
      const until = g.turnsDone[ctx.pid] + 2;
      if (opt === 'look') { g.effects.isoLook[ctx.pid] = until; g.log(`${g.name(ctx.pid)} is isolated: no one can look at their cards until the end of their next turn.`); } else { g.effects.isoGold[ctx.pid] = until; g.log(`${g.name(ctx.pid)} is isolated: no one can take their gold until the end of their next turn.`); }
    },
  },
  {
    id: 'king-maker', name: 'King Maker', copies: 2, reactionOnly: true,
    text: 'Play this card out of turn when you or someone plays “Betray the King”. Choose a side: support (+1 to the King’s roll) or oppose (–1 to the King’s roll). If your side fails, pay 300 gold to the bank.',
    async play() {},
  },
  {
    id: 'knight', name: 'Knight', copies: 2, faceDownOnly: true,
    text: 'Place this card FACE DOWN in front of you to protect you from one betrayal. Placing a knight down counts as a card played.',
    async play() {},
  },
  {
    id: 'loyalty', name: 'Loyalty', copies: 3,
    text: 'Pick a player. They choose whether to pay you 100 gold or force the king pay you. ┄┄ Force a player to pay the king 100 gold and pledge their loyalty to them.',
    async play(g, ctx) {
      const opt = await g.choose(ctx.pid, 'Loyalty — choose one', [
        { value: 'pay', label: 'Pick a player: they pay you 100 or force the King to pay you' },
        { value: 'pledge', label: 'Force a player to pay the King 100 and pledge their loyalty' },
      ], { cancel: true });
      if (opt === 'pay') {
        const t = await g.pickPlayer(ctx.pid, 'Loyalty — pick a player', others(g, ctx.pid));
        const c = await g.choose(t, `Loyalty: ${g.name(ctx.pid)} gets 100 gold — from whom?`, [
          { value: 'me', label: 'I pay 100' }, { value: 'king', label: 'Force the King to pay 100' },
        ], { timeoutSec: resp(g), default: 'king' });
        g.lose(c === 'me' ? t : g.king(), 100, { by: ctx.pid, card: 'loyalty', to: ctx.pid });
      } else {
        const t = await g.pickPlayer(ctx.pid, 'Loyalty — who must pay the King and pledge loyalty?', noblesBut(g, ctx.pid));
        g.lose(t, 100, { by: ctx.pid, card: 'loyalty', to: g.king() });
        await say(g, t, 'Loyalty: pledge your loyalty to the King', { prefill: 'I pledge my loyalty to you, my King.' });
      }
    },
  },
  {
    id: 'meat-for-meat', name: 'Meat for Meat', copies: 4,
    text: 'You and another noble roll. If you roll higher, you collect 200 from them.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Meat for Meat — roll against which noble?', noblesBut(g, ctx.pid));
      const a = await g.rollDie(ctx.pid, 'Meat for Meat');
      const b = await g.rollDie(t, 'Meat for Meat');
      if (a > b) g.lose(t, 200, { by: ctx.pid, card: 'meat-for-meat', to: ctx.pid }); else g.log(`${g.name(ctx.pid)} did not roll higher.`);
    },
  },
  {
    id: 'peoples-champion', name: 'People’s Champion', copies: 1,
    text: 'Nominate a noble as King. If all other nobles agree, they roll against the current King to take the throne. Can only be played or discarded in the last round.',
    restrict: (g) => (g.round < 4 ? 'Only in the last round.' : null),
    discardRestrict: (g) => (g.round < 4 ? 'People’s Champion can only be discarded in the last round.' : null),
    async play(g, ctx) {
      const nom = await g.pickPlayer(ctx.pid, 'People’s Champion — nominate a noble as King (you may pick yourself)', g.nobles());
      g.log(`${g.name(ctx.pid)} nominates ${g.name(nom)} as the People’s Champion!`, { kind: 'alert' });
      const voters = noblesBut(g, ctx.pid);
      const v = await vote(g, voters, `People’s Champion: should ${g.name(nom)} challenge the King?`, 'All other nobles must agree.', [{ value: 'yes', label: 'Agree' }, { value: 'no', label: 'Disagree' }], 'no');
      if (!voters.every((p) => v[p] === 'yes')) { g.log('Not every noble agreed. The King keeps the throne.'); return; }
      const king = g.king();
      if (g.isKing(nom)) return;
      const order = await g.rollOff([nom, king], 'People’s Champion');
      if (order[0] === nom) g.crownChange(nom, { swapGold: true, reason: 'is carried to the throne as the People’s Champion' });
      else g.log('The King holds the throne.');
    },
  },
  {
    id: 'royal-bomb', name: 'Royal Bomb', copies: 1, noFaceDown: true,
    text: 'You and everyone else (excluding the king) lose 800 gold. This card cannot be stolen and can only be discarded or given away by you during the “Negotiation Phase”. If you become king, the card is discarded. Use this card to pressure and negotiate.',
    async play(g, ctx) {
      g.commit();
      g.log('💣💥 THE ROYAL BOMB GOES OFF!', { kind: 'alert' });
      for (const p of g.nobles()) g.lose(p, 800, { by: ctx.pid, card: 'royal-bomb' });
    },
  },
  {
    id: 'scout', name: 'Scout', copies: 2,
    text: 'Back a noble to become king by the end of the next round. If you’re correct, earn 300 gold from the bank. If you’re wrong, lose 100. Keep this card in front of you until then.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Scout — who will become King by the end of next round?', g.nobles());
      g.commit();
      ctx.keep = true;
      g.bets.push({ type: 'scout', owner: ctx.pid, target: t, deadline: g.round + 1, card: ctx.card });
      g.log(`${g.name(ctx.pid)} bets that ${g.name(t)} will become King by the end of round ${g.round + 1}.`);
    },
  },
  {
    id: 'shadow-deal', name: 'Shadow Deal', copies: 5,
    text: 'Give another player 100 or 200 gold (you pick) from the bank. You can give it to the king.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Shadow Deal — give gold to whom?', others(g, ctx.pid));
      const amt = await g.choose(ctx.pid, `How much should ${g.name(t)} get from the bank?`, [{ value: 100, label: '100 gold' }, { value: 200, label: '200 gold' }], { cancel: true });
      g.log(`${g.name(ctx.pid)} makes a Shadow Deal with ${g.name(t)}.`);
      g.gain(t, amt);
    },
  },
  {
    id: 'sub-rosa', name: 'Sub Rosa', copies: 5,
    text: 'Look at any player’s hand or one face down knight card (pick one). If you roll a 4 or higher you can take a card from their hand.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Sub Rosa — whose secrets?', others(g, ctx.pid), { disabled: lookBlocked(g) });
      const fds = g.fd[g.seatOf(t)];
      const mode = fds.length
        ? await g.choose(ctx.pid, 'Sub Rosa — look at…', [{ value: 'hand', label: `${g.name(t)}'s hand` }, { value: 'knight', label: `One of ${g.name(t)}'s face-down Knight cards` }], { cancel: true })
        : 'hand';
      g.commit();
      g.kingsEyePenalty(ctx.pid, t, 'looked at the cards of');
      if (mode === 'hand') {
        g.log(`${g.name(ctx.pid)} looks at ${g.name(t)}'s hand.`);
        await g.ask(ctx.pid, { kind: 'info', title: `${g.name(t)}'s hand`, cards: g.hand(t).map((c) => ({ uid: c.uid, id: c.id })) });
      } else {
        let f = fds[0];
        if (fds.length > 1) {
          const i = await g.choose(ctx.pid, 'Which face-down card?', fds.map((x, i) => ({ value: i, label: `Face-down card #${i + 1}` })));
          f = fds[i] || fds[0];
        }
        g.log(`${g.name(ctx.pid)} peeks at one of ${g.name(t)}'s face-down cards.`);
        if (!f.knownTo.includes(ctx.pid)) f.knownTo.push(ctx.pid);
        await g.ask(ctx.pid, { kind: 'info', title: 'The face-down card is…', cards: [{ uid: f.card.uid, id: f.card.id }] });
      }
      const r = await g.rollDie(ctx.pid, 'Sub Rosa (4+ to take a card)');
      if (r < 4 || !g.players[t]) return;
      const stealable = g.hand(t).filter((c) => c.id !== 'royal-bomb');
      if (!stealable.length) { g.log('There is nothing they can take.'); return; }
      let uid;
      if (mode === 'hand') uid = await g.ask(ctx.pid, { kind: 'cards', title: `Take a card from ${g.name(t)}`, cards: stealable.map((c) => ({ uid: c.uid, id: c.id })) });
      else uid = stealable[Math.floor(g.rng() * stealable.length)].uid; // FAQ: looked at a knight → take at random
      const c = g.takeFromHand(t, uid);
      if (!c) return;
      if (c.deck === 'king') {
        // Nobles cannot hold King cards — the stolen King card is discarded instead.
        g.discard(c);
        g.log(`${g.name(ctx.pid)} rips a card from the King's hand: ${g.def(c).name} is discarded.`);
      } else {
        g.hand(ctx.pid).push(c);
        g.log(`${g.name(ctx.pid)} takes a card from ${g.name(t)}.`);
        g.log(`You took ${g.def(c).name}.`, { to: [ctx.pid], kind: 'private' });
        g.log(`${g.name(ctx.pid)} took your ${g.def(c).name}.`, { to: [t], kind: 'private' });
      }
      g.topUp(t);
    },
  },
  {
    id: 'subsidies', name: 'Subsidies', copies: 3,
    text: 'All nobles get gold for as much gold as they have: No gold – Receive 300. 100-300 – Receive 200. 400-500 – Receive 100.',
    async play(g) {
      g.commit();
      const pay = g.nobles().map((p) => [p, g.gold(p)]).map(([p, gd]) => [p, gd === 0 ? 300 : gd <= 300 ? 200 : gd <= 500 ? 100 : 0]);
      if (!pay.some(([, a]) => a)) g.log('No noble is poor enough for subsidies.');
      for (const [p, a] of pay) if (a) g.gain(p, a);
    },
  },
  {
    id: 'suppress-rebellion', name: 'Suppress Rebellion', copies: 2,
    text: 'If the king pathetically rolls a 1-3, the bank must give you 200 gold and every other noble 100 gold.',
    async play(g, ctx) {
      const r = await g.rollDie(g.king(), 'Suppress Rebellion');
      if (r <= 3) {
        g.log('The King pathetically fails to suppress the rebellion!');
        g.gain(ctx.pid, 200);
        for (const p of noblesBut(g, ctx.pid)) g.gain(p, 100);
      } else g.log('The rebellion is suppressed.');
    },
  },
  {
    id: 'tithe', name: 'Tithe', copies: 2,
    text: 'Pick a player. They must pick a noble to give you 100 gold.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Tithe — who decides who pays?', others(g, ctx.pid));
      const payer = await g.pickPlayer(t, `Tithe: pick a noble who must give ${g.name(ctx.pid)} 100 gold`, noblesBut(g, ctx.pid), { cancel: false, timeoutSec: resp(g) });
      g.log(`${g.name(t)} picks ${g.name(payer)} to pay the tithe.`);
      g.lose(payer, 100, { by: ctx.pid, card: 'tithe', to: ctx.pid });
    },
  },
  {
    id: 'unprotected', name: 'Unprotected', copies: 2,
    text: 'If you roll a 5-6, all face down knights in play are removed except yours.',
    async play(g, ctx) {
      const r = await g.rollDie(ctx.pid, 'Unprotected (5–6)');
      if (r < 5) { g.log('The knights stand firm.'); return; }
      const mine = g.seatOf(ctx.pid);
      let n = 0;
      g.fd.forEach((arr, seat) => {
        if (seat === mine) return;
        for (const f of arr) { g.discard(f.card); n++; }
        arr.length = 0;
      });
      g.log(`⚔ All face-down knights except ${g.name(ctx.pid)}'s are removed (${n} card${n === 1 ? '' : 's'}).`, { kind: 'alert' });
    },
  },
  {
    id: 'wrath', name: 'Wrath', copies: 4,
    text: 'You lose 100 gold, but a noble of your choice loses 300. ┄┄ Make a player lose 100 to the bank.',
    async play(g, ctx) {
      const opt = await g.choose(ctx.pid, 'Wrath — choose one', [
        { value: 'big', label: 'You lose 100 gold, but a noble of your choice loses 300' },
        { value: 'small', label: 'Make a player lose 100 to the bank' },
      ], { cancel: true });
      if (opt === 'big') {
        const t = await g.pickPlayer(ctx.pid, 'Wrath — which noble loses 300?', noblesBut(g, ctx.pid));
        g.lose(ctx.pid, 100, { by: ctx.pid, card: 'wrath' });
        g.lose(t, 300, { by: ctx.pid, card: 'wrath' });
      } else {
        const t = await g.pickPlayer(ctx.pid, 'Wrath — who loses 100?', others(g, ctx.pid));
        g.lose(t, 100, { by: ctx.pid, card: 'wrath' });
      }
    },
  },
];

const KING = [
  {
    id: 'anchor', name: 'Anchor', copies: 2,
    text: 'Player loses 200 gold to the bank or lets the player of your choice lose 100 to you.',
    async play(g, ctx) {
      const a = await g.pickPlayer(ctx.pid, 'Anchor — who makes the choice?', g.nobles());
      const b = await g.pickPlayer(ctx.pid, `Anchor — if ${g.name(a)} refuses to sink, who loses 100 to you?`, noblesBut(g, a));
      const c = await g.choose(a, 'Anchor: choose', [
        { value: 'self', label: 'I lose 200 gold to the bank' },
        { value: 'other', label: `${g.name(b)} loses 100 to the King` },
      ], { timeoutSec: resp(g), default: 'other' });
      if (c === 'self') g.lose(a, 200, { by: ctx.pid, card: 'anchor' }); else g.lose(b, 100, { by: ctx.pid, card: 'anchor', to: ctx.pid });
    },
  },
  {
    id: 'bend-the-knee', name: 'Bend the Knee', copies: 2,
    text: 'Force a player to thank you for everything you’ve done for them. If they refuse, they pay the bank 300 gold. If they cannot afford to, they must thank you.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Bend the Knee — who must thank you?', g.nobles());
      const s = await say(g, t, 'Bend the Knee: thank the King for everything they’ve done for you', {
        prefill: 'Thank you, my King, for everything you have done for me.', allowRefuse: true,
        refuseLabel: 'Refuse (pay 300 to the bank)', refuseDisabled: g.gold(t) < 300, judge: ctx.pid,
      });
      if (s === null) g.lose(t, 300, { by: ctx.pid, card: 'bend-the-knee' });
    },
  },
  {
    id: 'black-plague', name: 'Black Plague', copies: 1,
    text: 'All nobles pair up and each roll a die. If either noble in a pair rolls a 1, both nobles in that pair lose 200 gold. If there is an odd number of nobles, roll with a lone one, but only they can lose gold.',
    async play(g, ctx) {
      g.commit();
      const ns = g.nobles().slice();
      for (let i = ns.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [ns[i], ns[j]] = [ns[j], ns[i]]; }
      const pairs = [];
      for (let i = 0; i < ns.length; i += 2) pairs.push(ns.slice(i, i + 2));
      g.log(`☠ The Black Plague spreads. Pairs: ${pairs.map((p) => p.map((x) => g.name(x)).join(' & ') + (p.length === 1 ? ' & the King' : '')).join(', ')}.`, { kind: 'alert' });
      for (const pair of pairs) {
        const rollers = pair.length === 1 ? [pair[0], ctx.pid] : pair;
        let sick = false;
        for (const p of rollers) if ((await g.rollDie(p, 'Black Plague')) === 1) sick = true;
        if (sick) for (const p of pair) g.lose(p, 200, { by: ctx.pid, card: 'black-plague' });
      }
    },
  },
  {
    id: 'debt-collector', name: 'Debt Collector', copies: 2,
    text: 'Pick a player. This player picks someone to lose 200 gold to the bank.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Debt Collector — who becomes your debt collector?', g.nobles());
      const v = await g.pickPlayer(t, 'Debt Collector: pick a noble to lose 200 gold to the bank', noblesBut(g, t), { cancel: false, timeoutSec: resp(g) });
      g.log(`${g.name(t)} sends the debt collector to ${g.name(v)}.`);
      g.lose(v, 200, { by: ctx.pid, card: 'debt-collector' });
    },
  },
  {
    id: 'eye-for-an-eye', name: 'Eye for an Eye', copies: 1,
    text: 'You lose 100 gold to the bank but a player of your choice loses 300.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Eye for an Eye — who loses 300?', g.nobles());
      g.lose(ctx.pid, 100, { by: ctx.pid, card: 'eye-for-an-eye' });
      g.lose(t, 300, { by: ctx.pid, card: 'eye-for-an-eye' });
    },
  },
  {
    id: 'king-helping-hand', name: 'Helping Hand', copies: 1,
    text: 'First draw two, then play an extra card. So, if this is your first card, you play 4 more now (or 3, if you’re only playing with 3 nobles).',
    async play(g, ctx) {
      g.commit();
      const n = g.draw(ctx.pid, 2);
      g.log(`The King draws ${n} cards and may play an extra card.`);
      ctx.extraPlays = 2;
    },
  },
  {
    id: 'king-knight', name: 'Knight', copies: 1, faceDownOnly: true,
    text: 'Place this card face down in front of a player to protect them from one Betrayal card. They can’t look at it.',
    async play() {},
  },
  {
    id: 'kings-eye', name: 'King’s Eye', copies: 2,
    text: 'Protect a player of your choice until your next turn. If a noble looks at their cards or takes gold from them, they must pay the bank 100 gold.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'King’s Eye — protect whom?', g.nobles());
      g.commit();
      g.effects.kingsEye.push({ owner: ctx.pid, target: t, until: g.turnsDone[ctx.pid] + 1 });
      g.log(`👁 ${g.name(t)} is under the King’s Eye until the King's next turn.`);
    },
  },
  {
    id: 'loyal-dog', name: 'Loyal Dog', copies: 3,
    text: 'Give a player 100 to 300 gold (you pick) from the bank but they must say “Thank you my king, I pledge my loyalty to you my king.”',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Loyal Dog — reward whom?', g.nobles());
      const amt = await g.choose(ctx.pid, `How much for ${g.name(t)}?`, [100, 200, 300].map((v) => ({ value: v, label: `${v} gold` })), { cancel: true });
      g.gain(t, amt);
      await say(g, t, 'Loyal Dog: you must say it', { exact: 'Thank you my king, I pledge my loyalty to you my king.' });
    },
  },
  {
    id: 'mad-king', name: 'Mad King', copies: 1,
    text: 'Force everyone to roll dice. Whoever rolls a 1 loses 300 to the bank. You must roll as well. If you roll a 1 you lose 500.',
    async play(g, ctx) {
      g.commit();
      g.log('🔥 The MAD KING forces everyone to roll!', { kind: 'alert' });
      const rolls = {};
      await Promise.all(g.seats.map(async (p) => { rolls[p] = await g.rollDie(p, 'Mad King'); }));
      for (const p of g.seats) if (rolls[p] === 1) g.lose(p, p === ctx.pid ? 500 : 300, { by: ctx.pid, card: 'mad-king' });
    },
  },
  {
    id: 'royal-parrot', name: 'Royal Parrot', copies: 2,
    text: 'As the royal parrot, a player of your choice has to pay the bank 100 gold then repeat a sentence you give them in a high-pitched voice. 300 to the bank if they refuse.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Royal Parrot — who is your parrot?', g.nobles());
      const sentence = await g.ask(ctx.pid, { kind: 'say', title: `What must ${g.name(t)} repeat in a high-pitched voice?`, prefill: 'I am the King’s pretty little parrot!' });
      g.lose(t, 100, { by: ctx.pid, card: 'royal-parrot' });
      g.log(`🦜 ${g.name(t)} must repeat in a high-pitched voice: “${sentence}”`);
      const s = await say(g, t, 'Royal Parrot: repeat it in a high-pitched voice!', { exact: sentence, allowRefuse: true, refuseLabel: 'Refuse (pay 300 to the bank)', judge: ctx.pid });
      if (s === null) g.lose(t, 300, { by: ctx.pid, card: 'royal-parrot' });
    },
  },
  {
    id: 'scapegoat', name: 'Scapegoat', copies: 1,
    text: 'Each noble must vote on another noble to lose 300 gold to the bank, starting from the noble to your left. A tie is decided by a dice roll.',
    async play(g, ctx) {
      g.commit();
      const tally = {};
      for (const p of g.nobles()) { // seat 1 is to the King's left, going clockwise
        const v = await g.pickPlayer(p, 'Scapegoat: vote for a noble to lose 300 gold', noblesBut(g, p), { cancel: false, timeoutSec: g.settings.voteSeconds });
        tally[v] = (tally[v] || 0) + 1;
        g.log(`${g.name(p)} votes for ${g.name(v)}.`, { kind: 'vote' });
      }
      const max = Math.max(...Object.values(tally));
      let tied = Object.keys(tally).filter((p) => tally[p] === max);
      let goat = tied[0];
      if (tied.length > 1) {
        g.log(`Tie between ${tied.map((p) => g.name(p)).join(', ')} — lowest roll is the scapegoat.`);
        const order = await g.rollOff(tied, 'Scapegoat tie');
        goat = order[order.length - 1];
      }
      g.log(`🐐 ${g.name(goat)} is the scapegoat!`, { kind: 'alert' });
      g.lose(goat, 300, { by: ctx.pid, card: 'scapegoat' });
    },
  },
  {
    id: 'shifting-tides', name: 'Shifting Tides', copies: 1,
    text: 'Pick two nobles. They can only take gold from each other until your next turn. This does not include Betrayal cards.',
    async play(g, ctx) {
      const a = await g.pickPlayer(ctx.pid, 'Shifting Tides — first noble', g.nobles());
      const b = await g.pickPlayer(ctx.pid, 'Shifting Tides — second noble', noblesBut(g, a));
      g.commit();
      g.effects.tides.push({ owner: ctx.pid, a, b, until: g.turnsDone[ctx.pid] + 1 });
      g.log(`🌊 Until the King's next turn, ${g.name(a)} and ${g.name(b)} can only take gold from each other.`);
    },
  },
  {
    id: 'snakes', name: 'Snakes', copies: 1,
    text: 'Pick a player and announce it. All nobles must vote by raising their hand. If even one noble raises their hand, the chosen player loses 300 gold to the bank.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Snakes — pick a player', g.nobles());
      g.log(`🐍 The King names ${g.name(t)}. Will any noble raise their hand?`, { kind: 'alert' });
      const voters = g.nobles();
      const v = await vote(g, voters, `Snakes: raise your hand against ${g.name(t)}?`, `If even one noble raises their hand, ${g.name(t)} loses 300 gold.`, [{ value: 'raise', label: '✋ Raise hand' }, { value: 'down', label: 'Keep it down' }], 'down');
      if (voters.some((p) => v[p] === 'raise')) g.lose(t, 300, { by: ctx.pid, card: 'snakes' }); else g.log('No hands were raised.');
    },
  },
  {
    id: 'king-sub-rosa', name: 'Sub Rosa', copies: 2,
    text: 'Look at another player’s hand. If you roll a 4 or higher, you can also discard a card.',
    async play(g, ctx) {
      const t = await g.pickPlayer(ctx.pid, 'Sub Rosa — whose hand?', g.nobles(), { disabled: lookBlocked(g) });
      g.commit();
      g.log(`The King looks at ${g.name(t)}'s hand.`);
      await g.ask(ctx.pid, { kind: 'info', title: `${g.name(t)}'s hand`, cards: g.hand(t).map((c) => ({ uid: c.uid, id: c.id })) });
      const r = await g.rollDie(ctx.pid, 'Sub Rosa (4+ to discard a card)');
      if (r < 4) return;
      const ok = g.hand(t).filter((c) => c.id !== 'royal-bomb');
      if (!ok.length) return;
      const uid = await g.ask(ctx.pid, { kind: 'cards', title: `Discard one of ${g.name(t)}'s cards`, cards: ok.map((c) => ({ uid: c.uid, id: c.id })) });
      const c = g.takeFromHand(t, uid);
      if (!c) return;
      g.discard(c);
      g.log(`The King discards ${g.name(t)}'s ${g.def(c).name}.`);
      g.topUp(t);
    },
  },
  {
    id: 'we-ride-together', name: 'We Ride Together', copies: 2,
    text: 'Pick two players. Whoever rolls lower between them has to lose 200 gold to the bank. Players can agree to lose 100 gold each instead only AFTER they both roll. Roll again if they tie.',
    async play(g, ctx) {
      const a = await g.pickPlayer(ctx.pid, 'We Ride Together — first rider', g.nobles());
      const b = await g.pickPlayer(ctx.pid, 'We Ride Together — second rider', noblesBut(g, a));
      let ra; let rb;
      do { ra = await g.rollDie(a, 'We Ride Together'); rb = await g.rollDie(b, 'We Ride Together'); } while (ra === rb);
      const lower = ra < rb ? a : b;
      const ans = await g.askAll([a, b], (p) => ({
        kind: 'choice', title: 'We Ride Together: split the loss?',
        text: `${g.name(lower)} rolled lower and must lose 200. You can both agree to lose 100 each instead.`,
        options: [{ value: 'split', label: 'Agree: we each lose 100' }, { value: 'no', label: p === lower ? 'No, I’ll take the 200' : 'No deal' }],
        timeoutSec: g.settings.voteSeconds, default: 'no',
      }), (x) => Object.values(x).includes('no'));
      if (ans[a] === 'split' && ans[b] === 'split') { g.log('They ride together and split the loss.'); g.lose(a, 100, { by: ctx.pid, card: 'we-ride-together' }); g.lose(b, 100, { by: ctx.pid, card: 'we-ride-together' }); } else g.lose(lower, 200, { by: ctx.pid, card: 'we-ride-together' });
    },
  },
];

const DEFS = {};
for (const d of NOBLE) DEFS[d.id] = { ...d, deck: 'noble' };
for (const d of KING) DEFS[d.id] = { ...d, deck: 'king' };

function buildDeck(deck, nextUid) {
  const cards = [];
  for (const d of Object.values(DEFS)) if (d.deck === deck) for (let i = 0; i < d.copies; i++) cards.push({ uid: nextUid(), id: d.id, deck });
  return cards;
}

const CATALOG = Object.values(DEFS).map(({ id, name, deck, copies, text, reactionOnly, faceDownOnly }) => ({ id, name, deck, copies, text, reactionOnly: !!reactionOnly, faceDownOnly: !!faceDownOnly }));

module.exports = { DEFS, buildDeck, CATALOG };
