# One King One Crown — Research Dossier (for browser replica)

Sources (all read directly):
- Official site + "Royal Advisor" FAQ: https://onecrown.store/
- Official Game Guide PDF (18 pp, read as images): https://cdn.shopify.com/s/files/1/1045/2605/3717/files/Game_Guide_Print.pdf?v=1789294911
- Official Print-and-Play PDF (28 pp, every card read as images): https://cdn.shopify.com/s/files/1/1045/2605/3717/files/Print_At_Home_OKOC.pdf?v=1789749340
- Existing fan implementation (for cross-check only): https://github.com/ZackBudai/okoc-online (Node.js, CC BY-NC-SA 4.0; states 74 Noble + 25 King cards — matches my count)
- Not obtained: BoardGameGeek page (HTTP 403), no gameplay video was found via search (not needed — rules are fully documented, but see "Open questions").
- Page renders of every PDF page are in `reference/` (guide1..18.png, cards1..28.png; cards5 = character cards, cards3/4 = round tracker, timer art and tokens, cards7–23 odd = Noble fronts, cards23 (last 7) + 25 + 27 = King fronts).

## 1. Licence (important)
Official game is CC BY-NC-SA 4.0. Publisher explicitly permits free digital variants/translations if: credit the original design, release under the **same license**, **non-commercial**, no paywall, no digital resale. So a free browser version for friends is allowed; we must credit the original (onecrown.store) and ship the code/assets under CC BY-NC-SA 4.0. Art is simple black/white/grey vector illustration; reusing it in the replica is covered by the same licence (with credit). Publisher is Yancey Intl (support@yanceyintl.com). Retail box $29.99.

## 2. Overview
- 4–8 players. 4 rounds. 30–60 min.
- Win: **be The King when the game ends** (after the last card of round 4).
- Become King by having **more gold than the current King** (plus special card effects: Betray the King, People's Champion, etc.). Gold is capped 0–2000.
- Social-manipulation game: negotiation, lying and betrayal are encouraged; no deal is binding.

## 3. Components (print-and-play = box contents)
- **Character cards**: 1 King (starts at 1000 gold), 8 Noble (start at 600). Face = a 3×7 grid of numbers 0,100,…,2000 (0–2000 in 100 steps); the starting value is a highlighted cell. King card is black-background/inverse of Noble. Backs: black with four hands over five crown spikes.
- **Gold tokens**: one token per player, placed on the grid cell of current gold (24 eye-icon square tokens per sheet are provided).
- **Round tracker**: board with ROUND ONE/TWO/THREE/FOUR. Icons show direction each round: R1 clockwise, R2 counter-clockwise, R3 clockwise, R4 counter-clockwise. A token marks the current round.
- **Dice** (standard d6; "use the dice provided"). Sand-timer art (2-minute negotiation timer).
- **King deck**: 25 cards (back: black crown-face with two eyes). **Noble deck**: 74 cards (back: grid of hooded figures).

## 4. Setup
1. Shuffle & deal character cards face down. Holder of the King card is King; others are Nobles. Reveal all character cards face up.
2. Gold: King 1000, Nobles 600 each (token on grid).
3. Everyone draws **8 cards**: King from King deck, Nobles from the shared Noble deck. Nobles cannot hold/use King cards and vice versa. King deck sits in front of the King; Noble deck in the middle.
4. Round tracker in the middle, token on Round One. Sit in a circle.
Turn order: starts at King, then next noble clockwise (R1, R3) or counter-clockwise (R2, R4).

## 5. Round structure
Each round = (1) Playing Phase, (2) Negotiation Phase. **Round 4 has no negotiation** — game ends right after the last card of round 4.
- **King's turn (always first)**: plays **3 cards**, then draws 3. With only **3 nobles** (4 players): plays **2**, draws 2.
- **Each Noble's turn**: plays **2 cards**, then draws 2.
- Hand is always topped back to **at least 8**; may exceed 8 (e.g. via Sub Rosa theft) but never go below. If you lose/discard a card, replace it instantly.
- Helping Hand: draw extra cards and play an extra card; the Helping Hand itself doesn't count toward your quota (see card list).
- **Negotiation Phase**: max **2 minutes** (all may agree to end early). Players may trade gold, exchange cards, gather support for a Betrayal, make deals/alliances. Nothing is binding; lying/betraying deals is allowed. Rules: (a) a player can't **receive more than 400 gold** in a single negotiation phase; (b) cards can only be **exchanged** (give one only if you get one back); (c) you may discard cards only as part of a deal with someone, never just to get a replacement.
- End of round: move round token; next round starts at The King. After round 4 whoever is King wins.

## 6. Changing the King
When a player becomes King at any time: they **physically swap seats, character cards and hands** with the former King (new King takes the old King's seat and cards as they are; former King becomes a Noble with the Noble card/hand). After demotion, play continues with the next noble in turn order (FAQ: "next noble in the turn order"). If two players become King simultaneously: both roll; **lower roll loses 100 gold** and the other becomes King. Gold carries over per FAQ for Betray the King / People's Champion ("switch gold with the King and take their place").
Note: The King's gold swap vs. hand swap — the guide says swap seats and cards (hands + character card). Gold goes with the character card per FAQ on Betray the King (gold swapped).

## 7. Extra rules
- Gold limits 0–2000 (cannot exceed/drop below; at 0 you still play and others can still "take" from you, you just stay at 0).
- "Bank" = infinite supply; gain/lose to bank means just adjusting gold.
- Knight cards (see below) can be **bluffed**: any card placed face down in front of you may be claimed as a Knight; it deters but gives NO protection if fake.
- King cannot protect themselves from "Betray the King"; the King's Knight card is to be placed in front of a Noble (or bluffed face-down in front of them).

## 8. Royal Advisor FAQ (official clarifications — verbatim-in-spirit)
- Dotted line on a card separates two options; choose only one when played.
- People's Champion: if you win the roll and become King you switch gold with the King and take their place, like Betray the King. You may nominate yourself.
- Betrayal cards: playable anytime you want (on your turn); but AFTER it is played, someone must support it or it is discarded with no effect.
- Knight given face-down by the King: recipient cannot look at it; must trust it's real. A Noble's Knights stay when they become King, but the new occupant of their old seat can't verify them. (Text: "The Knight cards remain, but the new noble that takes their place cannot check if they're real or not.")
- Knights protect once against a Betrayal targeting you, then are discarded. The King can't *use* a Noble Knight; King's own Knight is placed face down in front of a Noble they pick (or a bluff).
- Helping Hand: draw 2 cards and may play one more card this turn; the Helping Hand does not count as one of your plays.
- Isolation (gold option): you can't lose gold until your next turn to cards played by *other players*, **except Royal Bomb and Betrayals**. Cards *you* play can still make you lose gold (Icarus, Scout, Hindsight).
- Bad Blood stops the moment its owner becomes King.
- Sub Rosa: if you look at a face-down Knight then roll ≥4 you may still take a card, but must take **at random without looking** at their hand. Taking a card still lets you draw 2 at end of turn (hand may exceed 8, never below).
- Anchor: King picks Player A and Player B. A chooses: lose 200 to the bank, or force B to lose 100 **to the King**.
- Debt Collector: you can't pick the King (only nobles).
- Final round: no negotiation phase. Negotiation: no need to use full 2 minutes.
- At 0 or 2000 gold: stay (see above).
- King plays 3 cards (2 with only 3 nobles). If two become King at once, both roll; lower loses 100 and the other becomes King.
- If the King loses their place and swaps with a Noble, next play goes to the next noble in turn order.

## 9. COMPLETE CARD LIST (text transcribed from the card images)

### Noble deck — 74 cards (24 unique-type slots, copies in brackets)
1. **Actors** ×3 — Everyone must thank the king for their glorious rule however horrible and cruel it might have been. ┄┄ Everyone must laugh at the player of your choice. (choose one; art: three figures, central one with a smiling theatre mask)
2. **Allies** ×3 — Pick a noble. They choose if you gain 100 gold or lose 200 to the bank. Other players can convince them to take the second option.
3. **Bad Blood** ×3 — Pick two nobles. You gain 200 gold from the bank at the beginning of every round until one of them gives the other 200 gold. They can make this payment out of turn.
4. **Beggar's Blessing** ×3 — All nobles with 300 gold or lower gain 200.
5. **Betrayal** ×4 — Take all gold from another noble. Requires vocal support from another noble after it's played or it has no effect. Not playable in the first round. (grey card style, heart with two swords)
6. **Betray the King** ×2 — The King rolls: 1–3, you switch places and gold. 4–6, they remain king and gain 200 gold from the bank. After it's played, you must gain vocal support from TWO players or it has no effect. Not playable in the first round. (heart with three swords)
7. **Council Meeting** ×3 — If all players vote yes, you take 100 gold from the king. If one votes no, you lose 100 to the bank. ┄┄ Draw two cards, but you must praise the king.
8. **Divine Right** ×1 — If you roll 5+: You gain 1200 gold. Play only if you have 300 gold or less. Can only be played or discarded in the last 2 rounds.
9. **Grudge** ×2 — Pick a player. They have to agree to you taking 200 gold from the noble of your choice. If they disagree, you lose 100 gold to the bank.
10. **Helping Hand** (noble) ×3 — Draw 2 extra cards and play an extra card. So, if this is your first card, you get to play 3 more now.
11. **Hindsight** ×2 — Back a specific noble to play the "Betrayal" card before the end of the next round. If correct, gain 300 gold from the bank. If not, lose 100. Keep this in front of you until then.
12. **Icarus** ×2 — If you roll a 4–6, all nobles must pay you 100 gold. If you fail, you must pay each noble 100 gold. You can only play this card if you can afford it.
13. **Indebted** ×2 — If you roll a 3–6, a noble has to pay you 100 gold at the beginning of every round until another player frees them by paying you 200. This payment can be made at any time. Any debts are gone if you become king.
14. **Isolation** ×3 — No one can look at your cards until the end of your next turn. ┄┄ No one can take gold from you until the end of your next turn. This does not apply to the Betrayal card.
15. **King Maker** ×2 — Play this card out of turn when you or someone plays "Betray the King". Choose a side: support (+1 to the King's roll) or oppose (−1 to the King's roll). If your side fails, pay 300 gold to the bank.
16. **Knight** (noble) ×2 — Place this card FACE DOWN in front of you to protect you from one betrayal. Placing a knight down counts as a card played.
17. **Loyalty** ×3 — Pick a player. They choose whether to pay you 100 gold or force the king pay you. ┄┄ Force a player to pay the king 100 gold and pledge their loyalty to them.
18. **Meat for Meat** ×4 — You and another noble roll. If you roll higher, you collect 200 from them.
19. **People's Champion** ×1 — Nominate a noble as King. If all other nobles agree, they roll against the current King to take the throne. Can only be played or discarded in the last round.
20. **Royal Bomb** ×1 — You and everyone else (excluding the king) lose 800 gold. This card cannot be stolen and can only be discarded or given away by you during the "Negotiation Phase". If you become king, the card is discarded. Use this card to pressure and negotiate. (grey card, biohazard icon)
21. **Scout** ×2 — Back a noble to become king by the end of the next round. If you're correct, earn 300 gold from the bank. If you're wrong, lose 100. Keep this card in front of you until then.
22. **Shadow Deal** ×5 — Give another player 100 or 200 gold (you pick) from the bank. You can give it to the king.
23. **Sub Rosa** (noble) ×5 — Look at any player's hand or one face down knight card (pick one). If you roll a 4 or higher you can take a card from their hand.
24. **Subsidies** ×3 — All nobles get gold for as much gold as they have: No gold – Receive 300; 100–300 – Receive 200; 400–500 – Receive 100.
25. **Suppress Rebellion** ×2 — If the king pathetically rolls a 1–3, the bank must give you 200 gold and every other noble 100 gold.
26. **Tithe** ×2 — Pick a player. They must pick a noble to give you 100 gold. (art: "Deed of Tithe Obligation" blackletter scroll)
27. **Unprotected** ×2 — If you roll a 5–6, all face down knights in play are removed except yours.
28. **Wrath** ×4 — You lose 100 gold, but a noble of your choice loses 300. ┄┄ Make a player lose 100 to the bank.

(Tally: 3+3+3+3+4+2+3+1+2+3+2+2+2+3+2+2+3+4+1+1+2+5+5+3+2+2+2+4 = 74 ✓; matches PDF pages 7–21 (odd pages, 9 cards each = 72) plus 2 Wrath on page 23. Even pages are the matching card backs.)

### King deck — 25 cards
1. **Anchor** ×2 — Player loses 200 gold to the bank or lets the player of your choice lose 100 to you. (FAQ: King picks A and B; A chooses lose 200 to bank, or B loses 100 to King.)
2. **Bend the Knee** ×2 — Force a player to thank you for everything you've done. If they refuse, they pay the bank 300 gold. If they cannot afford to, they must thank you.
3. **Black Plague** ×1 (grey card) — All nobles pair up and each roll a die. If either noble in a pair rolls a 1, both nobles in that pair lose 200 gold. If there is an odd number of nobles, roll with a lone one, but only they can lose gold.
4. **Debt Collector** ×2 — Pick a player. This player picks someone to lose 200 gold to the bank. (FAQ: cannot pick the King.)
5. **Eye for an Eye** ×1 — You lose 100 gold to the bank but a player of your choice loses 300.
6. **Helping Hand** (king) ×1 — First draw two, then play an extra card. So, if this is your first card, you play 4 more now (or 3, if you're only playing with 3 nobles).
7. **King's Eye** ×2 — Protect a player of your choice until your next turn. If a noble looks at their cards or takes gold from them, they must pay the bank 100 gold.
8. **Knight** (king) ×1 — Place this card face down in front of a player to protect them from one Betrayal card. They can't look at it.
9. **Loyal Dog** ×3 — Give a player 100 to 300 gold (you pick) from the bank but they must say "Thank you my king, I pledge my loyalty to you my king."
10. **Mad King** ×1 — Force everyone to roll dice. Whoever rolls a 1 loses 300 to the bank. You must roll as well. If you roll a 1 you lose 500.
11. **Royal Parrot** ×2 — As the royal parrot, a player of your choice has to pay the bank 100 gold then repeat a sentence you give them in a high-pitched voice. 300 to the bank if they refuse.
12. **Scapegoat** ×1 — Each noble must vote on another noble to lose 300 gold to the bank, starting from the noble to your left. A tie is decided by a dice roll.
13. **Shifting Tides** ×1 — Pick two nobles. They can only take gold from each other until your next turn. This does not include Betrayal cards.
14. **Snakes** ×1 — Pick a player and announce it. All nobles must vote by raising their hand. If even one noble raises their hand, the chosen player loses 300 gold to the bank.
15. **Sub Rosa** (king) ×2 — Look at another player's hand. If you roll a 4 or higher, you can also discard a card.
16. **We Ride Together** ×2 — Pick two players. Whoever rolls lower between them has to lose 200 gold to the bank. Players can agree to lose 100 gold each instead only AFTER they both roll. Roll again if they tie.
(Tally: 2+2+1+2+1+1+2+1+3+1+2+1+1+1+2+2 = 25 ✓)

## 10. Visual / UX style to replicate
- Strict monochrome: black, white, a few mid-greys. Flat vector "faceless hooded figure" art: Nobles = black rounded-arch figures with two white eyes; King = square black body with five-spike crown; Knight = grey helmet. Font: **Montserrat Bold/ExtraBold**, ALL-CAPS card titles, centered; effect text sentence case below; dotted line (┄┄) splits two-option cards; illustration in lower half of card.
- Card backs: King = black crown-face; Noble = rows of hooded figures; Character = hands over crown spikes.
- Special-feeling cards (Betrayal, Betray the King, Royal Bomb, Black Plague, and several king cards) have a light-grey/off-white background and grey art; most cards pure white with 3px black border.
- Character card = 3×7 gold grid (0…2000 step 100), starting cell highlighted; token marker.
- Round tracker with four round emblems and clockwise/counter-clockwise arrows; hourglass emblem for negotiation timer.
- Tone: dry, cheeky copy ("How evil of you not to pay…", "thanks love you").

## 11. Design observations / open questions for implementation
Physical-game behaviors that are verbal/honor-based and need explicit digital design decisions:
1. **Spoken/verbal cards** (Actors, Council Meeting praise, Loyal Dog, Royal Parrot, Bend the Knee, Loyalty, Grudge agree/disagree, Snakes/Scapegoat votes, Betrayal "vocal support"): implement as in-app prompts, votes, and a chat/voice channel; suggest built-in voice/video chat or external call + in-app "supports/refuses" buttons. Fan implementation uses a typed-and-checked mode or honour system.
2. **Knight bluffing**: need face-down "cards in front of you" slot where any hand card may be placed hidden; owner can claim anything; Sub Rosa lets looker see real Knight; Unprotected removes face-down cards except the player's own (bluffs included).
3. **Hidden information & Isolation/King's Eye**: server must enforce who can see hands.
4. **Round 1 restriction**: Betrayal & Betray the King not playable in round 1.
5. **Rules not fully specified** (need decisions): what happens to hand/gold/cards-in-front on King swap exactly (guide says swap seats and cards; gold travels per FAQ for Betray the King); whether turn-order direction resumes from the new King's former seat; whether Hindsight/Scout/Bad Blood/Indebted persist across swaps; tie rules for Council Meeting / Scapegoat voting; whether "play a card" can be skipped / is a turn forced to play full 2 cards if hand is unplayable (Divine Right, Betrayal R1); discard-pile reshuffle when decks run out (not stated — decks are 74/25 vs. 8 players × draws; reshuffle discards is the sensible default); Meat for Meat/Icarus roll timing; max 400 gold received per negotiation phase tracking; "deal discards" in negotiation.
6. Timing: King Maker is an out-of-turn reaction to Betray the King; Betrayal has a support window; Isolation has an end-of-next-turn duration; Hindsight/Scout resolve "by the end of next round".
7. Gold changes trigger an automatic "who is King?" check (more gold than King ⇒ takes the crown, with simultaneous-crown roll rule).
8. Player count 4–8 (3 nobles ⇒ King plays 2); the print-and-play includes character cards for 1 King + 8 Nobles (9 players?) — check: sheet shows 9 character cards (1 King + 8 Nobles), but official max is 8 players, so one spare.
9. A working open-source fan implementation exists (ZackBudai/okoc-online, same licence); we could study its card logic (`server/cards.js`) or fork it rather than rewriting, but should confirm with you whether you want a fresh build.
