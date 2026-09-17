# The First Five Fights

How a brand-new shinobi learns the tactical combat system by playing it. This
is the encounter-design record for the onboarding pass of 2026-09-17; the
implementation lives in the files named under each fight. Nothing here changes
the combat engine, jutsu balance, PvP, or later PvE.

## The lesson

The player has 100 AP each turn. Move costs 30 per tile, Attack 40, the kunai
throw 40, Heal/Clear/Cleanse 60, Flicker 20. Every starter bloodline ships three
60 AP strikes and one 40 AP utility (all range 4, cooldown 7), and every
non-bloodline starter jutsu is either a 60 AP single-tag strike or a 40 AP
two-tag utility with no damage. That split is the game's own design, so the
fights teach it rather than a rule invented for the tutorial:

- **40 AP changes the fight.** A hex on the enemy, a brace on yourself, a
  reposition. It leaves 60 AP for something else this turn.
- **60 AP capitalizes on the opening.** The heavy strike, once the board is
  where you want it. It is most of the turn.

By the fifth fight the player should be asking "which commitment fits this
situation", not "which button hits hardest".

## What the audit found

Measured against the live Solo-PvE engine with a freshly created level-1
character (see `api/_first-fights-onboarding.test.ts`):

| Action (level 1 kit)      | AP | Damage |
|---------------------------|----|--------|
| Basic Attack (range 1)    | 40 | ~188   |
| Rustfang Kunai (range 4)  | 40 | ~267   |
| Any 60 AP bloodline strike| 60 | ~395   |

Before this pass every sealed early enemy was a generic one-move template:
the spar dummy had 37 effective HP, the E-Rank Drill partner 187, the chapter-1
story boss 201, the D-Rank Mist Sentinel 230. Each died to the first heavy cast
on round 2, after a round spent walking. Nothing before level 15 showed the
player a shield, a status on themselves, or a reason to prefer a cheap move.
The authored client AI kits (Wound, Poison, Shield, Flicker, rule programs)
only reached hunts and explore ambushes. Enemy hits in the easy band are capped
at 20% per hit and 30% per turn with a mercy floor below level 10, so fight
length, not enemy stats, is the real difficulty lever.

## The sequence

Levels come from stat points, so the order below is the order the game's own
gates produce: spar at level 1, the Drill from level 1 (the Logbook asks for
three AI wins), the village story at level 4, the D-Rank at level 5, and the
field from then on.

### Fight 1: the Academy spar (level 1)

- **Enemy:** the Academy Training Dummy, unchanged except HP 50 → 400 authored
  (300 after the shared band). `api/story/_academy-spar.ts`.
- **Why the HP change:** at 37 HP the dummy died to whichever button was
  pressed first, so a new player never saw two actions in one turn. At 300 it
  survives one cheap action (Attack ~188, kunai ~267) and falls to the second;
  it still dies to a single heavy strike. It spends its first turn walking, so
  the guaranteed first win is unchanged (`scripts/release-certification.mjs`
  and the onboarding express e2e both still win on basic attacks alone).
- **Setup:** player at tile 62, dummy at 33, seven tiles apart; the dummy walks
  in. Player kit: two bloodline strikes, the bloodline utility, Flicker, kunai.
- **Teaches:** Move, targeting, Attack, casting a jutsu, Wait, and that Attack
  (40) and a jutsu (60) are different-sized commitments on the same 100 AP bar.
- **Guidance (moderate):** control-level lines in the combat feedback band
  (`lib/first-fight-coach.ts`, lesson `academySpar`). The first line still
  reads "Move → tap a lit tile toward the dummy." After the first Attack:
  "Attack took 40. A jutsu takes 60 — heavier, and most of what's left."
- **Difficulty:** very forgiving. A player who only Waits is punched for 30%
  of max HP per adjacent turn and dies around round 6, as before.

### Fight 2: the E-Rank Drill (levels 1–4, repeatable)

- **Enemy:** "Academy Sparring Partner", now a Bukijutsu thrower with an
  authored kit: Stone Kunai Rain (40 AP, Decrease Damage Given on the player,
  range 4) and Torrent Chain Slash (60 AP, Siphon, range 4). 800 HP authored
  (600 effective). `api/_authoritative-pve.ts` `FIRST_FIGHT_MISSION_KITS`.
- **Behavior:** walks to four tiles and holds. Hexes the player as soon as it
  is in range, casts its 60 from round 3 (the easy band holds burst until
  then), and only punches a player who steps next to it.
- **Teaches:** range and positioning (your jutsu reach four tiles; walking
  three tiles is a whole turn, Flicker is 20 AP), and that a 40 AP move used
  against you changes the exchange. The player's own 40 AP utility is the
  natural answer.
- **Guidance (moderate/light):** a band line on round one about range, one
  companion bubble when the hex lands ("Your Hematoma Veil does the same to it
  for forty, and still leaves you sixty"), a band line while out of reach, and
  one line after a heavy cast leaves exactly the cheap technique's AP
  ("Hematoma Veil fits your 40 AP. Or Wait."), which is the 60 + 40 = 100
  lesson at the moment the two lit cards on the bar already say it. Only on
  the player's first meeting with this opponent, at Academy rank
  (`firstFightLessonForMission`). Repeats are plain fights.
- **Difficulty:** forgiving. Naive play wins in three rounds untouched; a
  passive player takes one capped 60 on round 3 and nothing else. Walking into
  its reach costs a capped punch, which is why the express e2e fixture (a
  stat-10 account the server normalizes to 500 HP) is now seeded at 450 HP
  instead of 20: from 20 it sits under the 25% mercy line and dies to that punch.

### Fight 3: village story, chapter 1 (level 4)

- **Enemy:** the chapter-1 boss of every village (Training Scout, Wooden Root
  Guardian, Snow Warden Pup, Hidden Blade Trainee). Authored kit: Whispering
  Gale (40 AP, Shield + Absorb on itself) and Hollow Voice Cyclone (60 AP,
  Siphon). 520 HP authored (390 effective), just under the chapter-2 template
  so the chapter HP ramp stays monotonic. `api/story/_authoritative-story-combat.ts`.
- **Behavior:** braces on its very first turn (~267 shield plus Absorb, a
  self-cast that needs no range), then closes to four tiles and holds. It
  re-braces when the Absorb lapses and the cooldown allows, and only trades
  punches with a player who steps next to it.
- **Teaches:** reading a defensive state, then setup before payoff. A heavy
  strike into the fresh shield is mostly eaten (the test pins this); the
  efficient line is to chip the guard with cheap actions or apply a 40 AP
  setup, then commit the 60 to what is underneath. Clear does not remove a
  shield pool, so the answer is tempo, not a button.
- **Guidance (light):** three once-only companion bubbles: when the shield
  appears, if a 60 goes into it, and when the guard is down. The chapter's own
  mentor lines and boss barks are untouched.
- **Difficulty:** moderate resistance without punishment. A player who only
  Waits takes one capped heavy cast on round 3; naive play wins in about
  four rounds.

### Fight 4: the D-Rank Errand (level 5)

- **Enemy:** the Mist Sentinel, now a Genjutsu mist-user with Gale Net Snare
  (40 AP, Poison + Increase Damage Taken on the player) and Buried Memory Field
  (60 AP, Siphon). 1,400 HP authored (1,050 effective).
- **Behavior:** the same stand-off program as the Drill; the net lands as soon
  as it is in range.
- **Teaches:** a status that is worth answering. Under `combatResourcesV2`
  poison taxes chakra spend, so the player's own heavy casts bite back (about
  52 HP per 60 AP cast at level 5). Cleanse (60 AP, no chakra) clears it. The
  decision is real in both directions: cleanse and give up a heavy cast this
  turn, or push through and pay in HP.
- **Guidance (very light):** one companion bubble when the poison lands that
  names both options honestly, and one more only if the player has already cast
  a 60 through the poison and can still Cleanse.
- **Difficulty:** moderate, recoverable. Naive play wins in three rounds at
  roughly 88% HP; a passive player keeps 80%.

### Fight 5: the field (level 5+)

The exam is the game's existing wild: explore ambushes, hunts and wanderers.
They already use the authored client AI kits and rule programs and get no
coach. The explore pool picks the closest-level opponent: the authored
Academy Sparring Partner for levels 1–5 (Wound, Poison, Flicker in and punch,
a heal at low HP; about three rounds ending near half HP) and the authored
Mist Sentinel for levels 6–12 (Shield, two Decrease Damage Taken stances,
Reflect and Absorb, a Decrease Damage Given hex, Poison; the one early fight
where Clear pays for itself). Both combine everything the four authored fights
showed, and the mercy floor still applies. No change was made here.

## Starter loadout change

`lib/create-character.ts` now pre-equips two strikes and the bloodline's 40 AP
utility instead of the first three strikes. The third strike stays learned and
is one tap away in the Profile; the Academy loadout beat (equip Flicker to
reach four) is unchanged. Without this the cheap technique was never on the
bar during the fights that teach it. Mastery seeding, the Flicker beat, and
the four-jutsu target are untouched.

## Copy budgets and surfaces

On a phone the combat feedback band is one 10 px line with an ellipsis, so
every band line stays under 55 characters; the companion bubble clamps at three
lines, so bubbles stay under 120 characters and share the story bark's 6.5 s
cadence because they sit over the vitals on a phone. `first-fight-coach.test.ts`
sweeps every reachable line against both budgets, and a real-client run on
desktop and phone (throwaway live spec, not committed) confirmed the opening
band, the hex bubble, the in-range band and the after-cast band all render
unclipped.

## Player-experience check (2026-09-17)

A full new-player run in a real browser (desktop 1366×768 and the phone
preset) against a local Express build: intro cinematic, vow, companion, the
nine-step companion path (training, Flicker unlock, loadout, gear, Resonance
Trial, Academy Trial claim, Logbook, field assignment, Field Seal), the First
Contract choice, the E-Rank Drill with the coach, the claim, and a repeat
Drill. Every hand-off landed on the promised screen with the gold pulse on the
right control, the band lines and the hex bubble rendered as designed, and the
repeat run was silent. Two things were fixed from what the run showed:

- **Hex bubble on cooldown.** A player who had already spent the cheap
  technique on the Drill enemy heard "your Hematoma Veil does the same to it
  for forty, and still leaves you sixty" while the card sat on cooldown. The
  bubble now names the mirror instead ("the way your Hematoma Veil hexed it")
  when the forty is not ready, and the self-buff variant falls back to the
  neutral line. Pinned in `first-fight-coach.test.ts`.
- **Claim receipt under the Back button.** The Mission Hall's floating
  "← Back" sits at the top-left of the card, exactly where the "E-Rank Drill
  recorded" receipt renders after the first claim, so the receipt's title was
  covered on desktop and phone. `hub-screens-skin.css` now gives the receipt
  room below the button.

Left as observations (outside this pass): the newbie auto-grant that pays out
on the first combat claim is not mentioned by the receipt ("What changed:
+10 ryo" while the purse rose by far more), and the loadout step's "spend your
stat points before we spar" is advisory only (the step completes on the fourth
equipped jutsu). Every new save boots at sector 40 by server default
(`_sanitize-ledger.ts`), which is where the companion path begins.

## What was not changed

Damage, AP, regen, movement, targeting, status and cooldown rules; every jutsu
definition; PvP; C-Rank and above; chapters 2–9; hunts, ambushes, wanderers,
towers, rifts, Hollow Gate; combat HUD, camera and audio. The tutorial-only
surface is the `coach` prop on `MissionArenaFight` and the pure line picker in
`lib/first-fight-coach.ts`; it is display-only and never gates an action.

## Known quirk worth a look later

Absorb heals after damage is applied and after HP has clamped at zero, so a
lethal hit on an Absorbing enemy can leave it standing at the absorbed amount
(the guardian survives a 409 hit at 130 HP with 81 HP). This is live PvP
behavior in `api/pvp/move.ts` and was left alone; it makes the guardian one
action sturdier than its HP suggests.
