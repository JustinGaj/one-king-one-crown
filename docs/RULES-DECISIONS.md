# Rules as implemented

Everything follows the official **Game Guide**, the **card text**, and the **Royal Advisor FAQ** on
[onecrown.store](https://onecrown.store/) (see `RESEARCH.md`). The physical game leaves a few
situations to the table; this page lists every call this online version makes, so you can
change one if your group plays it differently. The code reference is in brackets.

## Straight from the official rules
- 4–8 players, 4 rounds. The King starts with 1000 gold; Nobles with 600. Gold stays within 0–2000.
- Everyone holds 8 cards. The King draws from the King deck (25), Nobles from the Noble deck (74).
- The King plays 3 cards, or 2 with only 3 nobles; Nobles play 2. Then you draw the same number.
- Turn order starts at the King: rounds 1 and 3 clockwise, rounds 2 and 4 counter-clockwise.
- Negotiation lasts up to 2 minutes after rounds 1–3 (none after round 4). A player can receive at
  most 400 gold per negotiation. Cards are exchanged one-for-one only. You can discard only as a
  deal with someone else.
- Having more gold than the King makes you King at once. You swap seats and hands; face-down
  Knights stay at their seat. Two simultaneous new Kings roll; each lower roll loses 100.
- Betrayal needs one supporter and Betray the King needs two, given after the card is played.
  Neither is playable in round 1.
- Any card can be placed face down as a "Knight" (bluff). Only real Knights protect, and each
  protects once. Placing one counts as a card played.
- The FAQ rulings: Isolation (gold) blocks other players' cards except Betrayals and Royal Bomb;
  Bad Blood stops when its owner becomes King; Sub Rosa after peeking at a Knight steals at
  random; Anchor: King picks A and B, and A chooses between losing 200 and B losing 100 to the
  King; Debt Collector can't pick the King; People's Champion may nominate yourself.

## Calls this version makes where the rules are silent
| Situation | What happens here |
|---|---|
| A deck runs out | Its discard pile is shuffled into a new deck. |
| Hands below 8 (e.g. after a deck ran dry) | Topped up at the start of every turn and whenever you lose a card. Hands may exceed 8. |
| Crown changes in the middle of a turn | The turn of the player who became King or lost the crown ends right away; play continues with the next seat (FAQ). |
| When "more gold than the King" is checked | After each card finishes resolving, after each negotiation gift, and after out-of-turn payments. A tie with the King is not "more". |
| Two-option cards (dotted line) | You pick the option when you play the card. You can take a card back until anything happens. |
| Betrayal support | Every other noble gets a "support / stay silent" button for 45 s; the first supporter is enough. Betray the King: any two players except the King. |
| King Maker | When Betray the King gets its support, every noble sees a 20 s window. Only holders of King Maker can pick a side (nobody can tell who holds one). Several can stack. |
| Betrayal vs. bluff Knights | If the target has no real Knight, the betrayal succeeds; the bluffs stay on the table. |
| Hindsight | Pays as soon as the backed noble *plays* Betrayal, even without support. |
| Scout | Pays as soon as the backed noble becomes King. |
| Bets past the end of the game | Hindsight/Scout bets whose deadline is "end of round 5" simply expire. The game ends after the last card of round 4. |
| Hindsight / Scout target | Any noble, including yourself. |
| Sub Rosa (Noble) taking from the King | Nobles can't hold King cards, so the taken card is discarded instead. |
| Royal Bomb | Can't be stolen, discarded by the King's Sub Rosa, or placed face down. Can be given away (one-way) or discarded during negotiation. |
| Royal Parrot | The target pays 100. If they refuse to repeat the sentence, they pay another 300. |
| Bend the Knee | "Refuse" is disabled when the target has less than 300 gold. |
| Black Plague pairs | Pairs are drawn at random. With an odd number of nobles, the lone noble rolls with the King, and only the noble can lose gold. |
| Scapegoat | Nobles vote one by one, starting with the noble on the King's left (clockwise). A tie is broken by a roll: the lowest roll is the scapegoat. |
| Snakes / Council Meeting / People's Champion votes | Votes are secret until everyone answers, then shown together. |
| King's Eye | Fines a noble who looks at the protected player's cards (Sub Rosa) or takes gold from them (to themselves), Betrayal included. |
| Shifting Tides | The two nobles can't *take* gold for themselves from anyone except each other (Betrayals excepted). |
| Indebted | The debt payment at the start of a round counts as the owner's card (Isolation blocks it). Anyone except the debtor and the owner can pay 200 to free them. |
| Spoken parts (Actors, praise, pledges, Parrot) | Typed into the game and shown to the table; say them on your voice call too. |
| Timers | A player who doesn't roll within 20 s rolls automatically. Votes default to "no" after 60 s. Other answers wait 2 minutes, then take the default. The host can "Skip waiting". |
| Disconnects | After 1 minute away, autopilot plays for you until you return. Anyone can turn on autopilot, and the host can turn it on for others. |
