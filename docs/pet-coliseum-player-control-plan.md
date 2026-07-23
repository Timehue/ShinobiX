# Pet Coliseum — giving the player control of the fight

**Status: Phases 0 and 1 SHIPPED** behind `petPlayerControl.v1` (default ON,
casual PvE only). See §9 for what actually landed and how it differs from the
plan below; §§1–8 are the original research and design brainstorm, kept because
the reasoning still explains why the mechanics are what they are.

Two corrections to the research, discovered while implementing:

- The live Coliseum runs **`pet-duel-cinematic.ts`**, not `pet-duel-sim.ts`. That
  engine *is* mirrored into `api/_pet-sim/` and used server-authoritatively by
  the pet ladder and sector war, so the wrapper-preserving refactor was mandatory.
- A look-ahead buffer does **not** have to mean input latency. See §9.2.

## 1. Why the Coliseum underperforms

The feel overhaul (`docs/pet-coliseum-feel-overhaul.md`) fixed *legibility* — the
pets plant, telegraph, and the camera cuts to the action. It could not fix
*agency*, because there is none. The player picks a pet, presses Fight, and
watches. Every remaining complaint ("boring", "same every time", "I stopped
watching") is an agency complaint, not a presentation complaint, and no amount of
extra VFX will move it.

Auto-battler design writing lands on the same conclusion: when combat resolves
itself, the pre-combat choices have to carry the entire decision load, and if they
don't, the mode reads as a slot machine with a long animation. The genre's own
fix has consistently been to inject small, frequent, low-APM decisions into the
fight itself rather than to deepen the pre-fight loadout further.

## 2. The architectural blocker (read this first)

`runPetDuel()` resolves the **entire** fight before frame 1 and returns a
`DuelResult { snapshots[], events[] }`. `PetColiseum.tsx` then plays it back by
indexing `duel.snapshots[tick]` against a clock. Nothing about the current
pipeline can accept input, because by the time the player sees frame 1 the winner
is already decided.

So every idea below depends on one enabling refactor:

**Phase 0 — make the sim resumable.** Split `simulate()`
(`shinobij.client/src/lib/pet-duel-sim.ts:1087`) into:

```
createDuel(fighters, seed, accuracyEnabled) -> DuelSim   // everything above the `for (let t...)` loop
stepDuel(sim, commands?) -> { snapshot, events }         // exactly one iteration of the existing loop body
runPetDuel(...)                                          // unchanged signature; loops stepDuel with no commands
```

`runPetDuel` / `runPetPartyDuel` stay as thin wrappers, so with no commands the
output is byte-identical and `pet-sim-parity.test.ts` plus the
`default == explicit-off` assertions keep passing. This is the repo's standard
"keep the old signature as a wrapper" extraction, and it is the only sim change
Phase 0 makes.

The renderer barely changes: `snapshots` becomes an append-only array that grows
one entry per tick instead of arriving complete, and `DuelDirector` still reads
`snapshots[tick]` and drains `events` by index. Live mode advances the sim from
the r3f clock at a fixed 30 Hz accumulator; replay mode (sector war, ladder) keeps
the one-shot path untouched.

**One correctness trap:** commands must be applied at a fixed tick boundary
(queue on touch, consume at the next tick), never at the frame the touch lands.
Otherwise the fight becomes frame-rate and input-lag dependent, and the
`plantedMotion` tick-parity fairness fix stops meaning anything.

## 3. Design constraints this has to respect

1. **It is still a pet.** The fantasy is a creature that fights for you. If the
   player must input constantly, we have built a fighting game and broken the
   pet fantasy — and locked out the players who are here to grind.
2. **Mobile, one thumb.** No keyboard, no precision aiming, targets ≥44 px.
3. **Show the 3D models.** Controls that produce distinct, camera-worthy poses
   beat controls that produce HUD numbers. Prompts should live **in the 3D
   scene**, on/near the pet, so the player's eyes stay on the models.
4. **Do not rewrite balance.** Casual PvE is client-authoritative, so this can
   ship without touching competitive outcomes, but PvE difficulty will need a
   pass once a skilled player can outplay the AI.
5. **Ship ON with an opt-out**, per the house rule — an "Auto" toggle that
   restores pure-AI behavior mid-fight for grinders.

## 4. Five candidate mechanics

### A — Command deck *(the backbone)*

Three-to-four ability buttons along the bottom, mirroring the pet's
`abilities[]`. Tapping a ready ability sets the pet's `pendingIdx` at its next
decision window. **Tap nothing and the AI picks exactly as it does today** — it
is an opt-in override, not an obligation, which is what protects constraint #1.

This is Ni no Kuni / *Digimon World: Next Order*: you issue orders, the partner
handles its own footwork and spacing. It is also nearly free to build, because
the sim already has a single explicit ability-choice point (`pendingIdx`) that we
just let the player pre-empt.

*Cost control:* commanding an ability off-rhythm spends extra stamina, so
button-mashing is self-limiting inside the economy the sim already has.

### B — Bond meter → Bond Break *(the payoff)*

A gauge that fills on landed hits, clean dodges, and well-timed inputs. When it
is full, one big button fires the pet's **signature** as a full cinematic:
camera cut-in, hero pose, hit-stop. The signature already exists and already has
a cut-in — today it fires on a 9-second AI cooldown. Moving it from "the AI does
it at you" to "you spend the meter" hands the player authorship of the fight's
highlight, and it is the single best showcase we have for the 3D rigs.

Directly modelled on Monster Hunter Stories' Kinship gauge, where the meter both
gates the big move and is fed by playing well.

### C — Timed action commands *(the moment-to-moment hook)*

The Super Mario RPG / Paper Mario layer, and the best fit for our sim, because
`windup` / `strike` / `stagger` are already discrete states with known tick
counts and the feel overhaul already ships a scaled wind-up telegraph:

- **Perfect Strike** — tap in the tail of your own `windup` → bonus damage and a
  brighter impact.
- **Brace** — tap during the *enemy's* wind-up → damage reduction, with a real
  block pose and spark on the model.
- **Slip** — tap late in the enemy's wind-up → trigger the existing `dodge`
  state, and feed the Bond meter.

This gives the player something to do every one to two seconds while keeping the
stakes right: missing a prompt costs a *bonus*, never the fight. It also converts
the wind-up telegraph we already built from decoration into a game mechanic.

Keep the bonuses small — roughly +15% on a single hit, −30% on a single incoming
hit — so mastery is felt but the outcome distribution stays sane.

### D — Stance dial *(strategy at zero APM)*

Three stances — Aggressive / Balanced / Guarded — swapping `neutralRange`, dash
willingness, and ability-class preference. This is FF12's Gambits compressed into
one control, and it is the accessibility floor: a player who does not want to tap
anything can still express a plan and still lose or win on that plan. Each stance
gets its own idle and locomotion pose, so the choice is *visible* on the model.

### E — Clash *(the drama spike, later)*

Straight from Monster Hunter Stories' head-to-head. When both pets commit heavy
moves in the same window, the sim halts, the camera slams to a nose-to-nose
two-shot of the rigs, and both sides pick Power / Speed / Tech inside ~1.5 s.
The winner nullifies the incoming move and counters, launching the loser.

This is the most spectacular use of two 3D models we can build, and it is the
most invasive sim change of the five. It belongs after the basics land.

### Scoring

| Mechanic | Player agency | 3D showcase | Build cost | Balance risk | Mobile |
|---|---|---|---|---|---|
| A Command deck | High | Medium | **Low** | Low | Good |
| B Bond Break | Medium | **Very high** | Low | Low | Excellent |
| C Action commands | **High** | High | Medium | Medium | Good |
| D Stance dial | Medium | Medium | **Low** | Low | Excellent |
| E Clash | High | **Very high** | High | High | Good |

## 5. Recommended stack and phasing

- **Phase 0 — resumable sim.** `createDuel` / `stepDuel` + wrappers, live
  playback in the renderer. No behavior change, no balance change, parity intact.
- **Phase 1 — the MVP: A + B + D.** Command deck, Bond Break, stance dial. This
  is a complete, shippable control layer with low balance risk, and it alone
  should resolve the agency complaint.
- **Phase 2 — C.** Timed action commands, once the HUD and input-timing plumbing
  from Phase 1 is proven.
- **Phase 3 — E.** Clash.
- **Phase 4 — promotion to competitive** (needs sign-off; see below).

## 6. Gating — how this ships without touching competitive outcomes

Reuse the `plantedMotion` playbook exactly. A new flag, `petPlayerControl.v1`,
default ON, applies **only on client-authoritative casual PvE** — the same call
sites that already pass `plantedMotion=true`:

| Caller | Player control | Why |
|---|---|---|
| `PetArena.tsx` 1v1 vs AI (`pveOpp`) | on | client-authoritative; server does not re-sim |
| `PetArena.tsx` 2v2 PvE | on | same |
| `Dungeon.tsx` (Hollow Gate) | on | pure client-side PvE |
| `PetArena.tsx` ranked, `pet-ladder`, `sector-pet`, clan-war | **off** | server-authoritative; must stay one-shot |
| `SectorWarPetBattle.tsx` / `PetLadder.tsx` replays | **off** | must match the server |

Because authoritative callers never enter live mode, there is no desync, no
`api/_pet-sim/*` regeneration risk beyond Phase 0's no-op, no need to touch the
drift-prone hand copy `api/pet-ladder/_duel-sim.ts`, and no balance sign-off
required to ship Phases 0–3.

**Phase 4 (competitive) requires the input-log pattern**, and this is the
anti-cheat-critical part: the client records `{tick, command}[]` and posts *the
log*, never the outcome. The server replays the same seeded sim with that log and
derives the result itself. That satisfies the house rule that the server never
pays out from client-supplied outcomes. Additional validation the server must do:
reject commands on ticks where the ability was on cooldown or unaffordable, and
cap commands per second so a bot cannot frame-perfect every prompt. Do not ship
Phase 4 until the log replay is byte-identical in a parity test.

## 7. UI sketch (mobile-first)

- **Bottom thumb arc:** 3–4 ability buttons, each showing its cooldown sweep and
  stamina cost. Greyed when unaffordable.
- **Center-bottom:** the Bond Break button, dark until the meter fills, then
  pulsing. It is the only button that should ever glow.
- **Top-left of the pet, in-world:** the stance chip.
- **On the model, not the HUD:** the action-command cue — a ring that contracts
  into the pet's silhouette during a wind-up, so the timing read keeps the
  player's eyes on the 3D character.
- **Top-right:** the Auto toggle (opt-out), which hands the fight back to the AI
  mid-duel without ending it.

## 8. Risks and gotchas

- `PetColiseum.tsx` is already 8,398 lines. The command HUD goes in a **new**
  component module, not appended to it. Same for `App.tsx` (line-budget ratchet).
- `petDuelEngine.v1=0` falls back to the old round engine, which has no control
  layer. The new flag must imply the new engine, and the HUD must not render on
  the fallback path.
- Player skill will make current PvE opponents trivial. Expect to re-tune enemy
  HP/damage for controlled fights **only** (gated the same way), and re-run
  `scripts/pet-duel-balance.ts` on the default path to prove it did not move.
- Live stepping runs the sim on the render thread. 30 Hz of `stepDuel` for two
  fighters is cheap, but the 4v4 tactical path is not — measure before extending
  control there, and consider capping catch-up ticks per frame.
- Never hand-edit `api/_pet-sim/*`; regenerate with `node scripts/gen-pet-sim.mjs`.
- Do not change `ARENA_X` / `ARENA_Y` — the renderer's field-to-floor mapping
  normalizes by them.

## 9. What shipped

### 9.1 The resumable engine

`simulate()` in `shinobij.client/src/lib/pet-duel-cinematic.ts` split into
`createDuelState` / `stepDuelState` / `finishDuelState`, composed back together by
`simulate()` in the same order the fused loop ran. `runPetDuelCinematic` and
`runPetPartyDuelCinematic` are untouched wrappers, so the ladder, sector war and
the generated `api/_pet-sim/` mirror are unaffected. The RNG cursor moved out of
its closure into an external `RngState` cell so it can be checkpointed; the
arithmetic is unchanged.

Two traps in that refactor, both caught by the byte-identity check and worth
knowing before touching this again:

- The scratch globals must be **cleared before** the opening `snapPos` pass:
  `snapPos` consults `SIM_WALLS` through `walkableAt`, so a previous duel's
  barriers would otherwise displace this duel's spawn positions.
- `_cinematicInitiativeTeam` is **mutated mid-fight** — a landed exchange hands
  the pressure beat over. Loading it into the globals each tick without writing it
  back silently reset initiative to its opening value every tick, which diverged
  the fight at around tick 46.

### 9.2 Zero-latency commands, via rewind

`shinobij.client/src/lib/pet-duel-live.ts` runs the sim `LOOKAHEAD_TICKS` (1.6 s)
ahead of playback, because the presentation layer genuinely needs that: the stage
director fits movement tracks and can re-launch a route up to 1.35 s before a
wind-up, and `DuelDirector` reads ~2.2 s ahead to avoid promising a payoff for an
attack that is about to miss. Playing the newest tick would have stripped all of
it.

The buffer does not cost responsiveness. On every command the controller restores
a checkpoint taken at the end of the last tick the player actually saw, applies
the order there, and re-simulates the buffer. The engine is deterministic and
costs microseconds a tick, so replaying 1.6 s is free — and the already-played
prefix is bit-identical, which `pet-duel-live.test.ts` asserts directly.

### 9.3 The controls

The deck is one anchored HUD bar with three fixed zones — **stance left, moves
centre, Bond Break right** — so the eye finds the same control in the same place
mid-fight. On a phone it splits into two rows (plan and payoff on top, moves in
the thumb arc below) rather than wrapping into a four-row wall: at 390 px that
wrap cost 289 px of a 720 px screen, and the two-row split brings it to 167 px.
Desktop is a single 104 px bar. Every target is ≥44 px in both layouts.

- **Command deck** (`components/PetDuelCommandDeck.tsx`) — basic plus the pet's
  non-signature moves. An order sets `pendingIdx` at the pet's next decision
  window and otherwise leaves the AI in charge. Two sim changes were needed to
  make an order actually mean something: a standing order cancels the post-attack
  exit beat (`holdRepos`), and a ready-but-out-of-reach order suppresses the
  opportunistic basic (`closingForOrder`) — without the latter a ranged pet would
  park at poke range and an ordered melee move could sit queued all fight.
- **Stance dial** — Press / Balance / Guard, folded into the three knobs the AI
  already reasons with (`aggression`, `retreatHp`, `dodgeBias`). Balanced is
  numerically the shipped brain, so an undialled fighter is byte-identical.
- **Bond Break** (`lib/pet-bond-meter.ts`) — a pure fold over the event log, so it
  needs no sim state and self-heals across a rewind. Filling it unleashes the
  signature *through* the cooldown the AI hoards it behind. Gains are tuned for
  roughly two Breaks in an aggressive 35–45 s fight, one in a defensive one.
- **Auto** — hands the pet back to its brain mid-fight and drops any standing
  order, per the house rule that a feature ships ON with an opt-out.

### 9.4 Gating as built

`petPlayerControl.v1` (default ON) applies at exactly two call sites, both in
`PetArena.tsx`: the 1v1 against a built-in AI opponent (`pveOpp`) and the PvE 2v2.
Ranked, the pet ladder, sector war, clan war, casual-vs-player and every replay
screen still call `runPetDuelCinematic` and get the unchanged watch-only duel.
Reward settlement was extracted into `settle1v1` / `settleParty` and now fires
from `PetColiseumDuel`'s `onOutcome` for a live fight; the Hollow Gate loss path
was converted to a functional updater, because a controlled duel settles up to a
minute after it began and the captured character is stale by then.

Every duel-renderer call site, and why it is or is not commanded:

| Call site | Engine | Commanded | Why |
|---|---|---|---|
| `PetArena` 1v1 vs built-in AI | cinematic, live | **yes** | client-authoritative PvE |
| `PetArena` 2v2 PvE | cinematic, live | **yes** | same |
| `PetArena` 1v1 vs player / clan war | cinematic, one-shot | no | both clients must derive the same fight from the seed |
| `PetArena` ranked | cinematic, one-shot | no | server-authoritative |
| `PetLadder` / `SectorWarPetBattle` replays | cinematic, one-shot | no | must match what the server resolved |
| `Dungeon` (Hollow Gate Rare Beast Seal) | **old `pet-duel-sim`**, one-shot | no | see below |
| `petvfx.html?control=1` | cinematic, live | yes | dev QA route |

**The Hollow Gate gap is deliberate, and it is the one place a player will notice
an inconsistency**: they command their pet in the Pet Arena but only watch it in
the Rare Beast Seal. `Dungeon.tsx` never moved onto the cinematic engine — it
still calls `runPetDuel(..., plantedMotion=true)` — so wiring control there is not
a flag flip. It means switching Hollow Gate to a different engine (different
`TTK_HP`, different AI), which changes that gate's PvE difficulty, plus the same
`onOutcome` refactor its `onExit` branch needs. That is a balance change, so it
is left for an explicit decision rather than folded in here.

### 9.5 Verification

- `pet-duel-live.test.ts` — an uncommanded live duel is `deepEqual` to
  `runPetDuelCinematic` across 8 seeds (1v1) and 4 seeds (2v2); checkpoint/restore
  replays identically; orders, Bond Break, Auto, stance clamping, enemy-command
  rejection, buffer invariants, prefix stability across a rewind, and the meter.
- A throwaway harness compared 92 duels against the pre-refactor engine
  byte-for-byte before the permanent test replaced it.
- Root `npm test` (3606 tests), client `npm run lint`, client and root
  `npm run build` all pass.
- Browser QA via `/petvfx.html?control=1&cine=1` (add `&mobileqa=1` for 390 px):
  deck renders, orders/stance/Auto all light up and reach the sim, the played
  prefix survives a rewind unchanged, and every control is ≥44 px on both layouts.
  Note the r3f render loop is throttled while the preview pane is hidden, so drive
  playback through the harness's `window.__petLiveDuel` hook rather than expecting
  the clock to advance on its own.

### 9.6 CLOSED — the reward now follows the fight the player played

**Fixed via option 1 (server replays the input log).** What follows is the
original problem statement, then what shipped.

#### The problem (as it stood)

`api/pet/battle-start.ts` seals an `authoritativeOutcome` by running its own
`runPetDuel` / `runPetPartyDuel` (the **old** `pet-duel-sim.ts` engine) over the
same seed, and `api/pet/battle-result.ts` then **overrides** whatever the client
reports with that sealed value (`outcome = tokenData.authoritativeOutcome`).

So the casual reward is already decided by a server-side AI-vs-AI simulation on a
*different engine* than the one the player watches. That mismatch predates this
work — the Coliseum has run on `pet-duel-cinematic.ts` for a while — but player
control turns a quiet inconsistency into an actively bad experience: a player who
outplays the AI can be told they lost, and paid accordingly.

Three ways out, in order of preference:

1. **Server replays the input log** (this is Phase 4 brought forward). The client
   posts `{tick, command}[]`; the server steps the same seeded cinematic sim with
   that log and derives the outcome itself. Cheat-proof and correct, and it also
   fixes the pre-existing engine mismatch. Needs the command layer ported into the
   generated `api/_pet-sim/` mirror and a parity assertion on the replay.
2. **Seal a reward CEILING instead of an outcome.** battle-start keeps sealing the
   opponent level (it already does, and that is what bounds the payout);
   battle-result accepts the client's win/loss and pays from the sealed level. The
   existing 5 s / 12-per-minute / 100-per-day caps still bound abuse. Weaker than
   today against a modified client, and it is a deliberate softening of an
   anti-cheat control — it should not be done without sign-off.
3. Ship as-is and accept that rewards do not track the played fight. Not
   recommended.

#### What shipped — option 1

Option 2 was **not** taken: it softens an anti-cheat control and was never
signed off. The outcome is now derived server-side from the player's inputs.

- `lib/pet-duel-live.ts` records every **accepted** command as
  `{ t, cmd }`, stamped with the tick it landed on (after the rewind, so `t` is
  the tick the order actually took effect). The log is append-only: the rewind
  point is `playbackTick + 1`, which never moves backwards, so an applied command
  is baked into every later checkpoint and is never undone. Exposed as
  `LiveDuel.inputLog()`.
- `PetArena.tsx` posts it as `inputLog` on all three `battle-result` reports
  (1v1 win, 1v1 loss/draw, 2v2). Omitted for a watch-only duel.
- `api/pet/_duel-replay.ts` parses/validates the log and steps the same seeded
  cinematic sim with it. `api/pet/battle-start.ts` seals the sim params;
  `api/pet/battle-result.ts` replays and uses the outcome **it** derives.
  `body.outcome` is now ignored entirely on the casual path — the client is
  trusted to say which buttons it pressed, never what pressing them achieved.
- The command layer needed no porting: `gen-pet-sim.mjs` already copies
  `pet-duel-cinematic.ts` verbatim, so the mirror had it. What the generator DID
  need was `pet-bond-meter.ts` (see the Bond Break note below).

**The engine mismatch is fixed too, for PvE.** `battle-start` now seals its
baseline by replaying the *cinematic* engine with an empty log — which
reproduces the uncommanded AI fight exactly — instead of running the retired
`pet-duel-sim`. So a watch-only PvE duel is also finally scored on the engine it
was rendered with. Casual-vs-player and clan-war 1v1 are untouched (they are not
commandable, and both clients must derive the same fight).

**What is validated, and what deliberately is not:**

- **Bond Break is gated on the meter, server-side.** This was the real hole. The
  engine does not gate Break at all — `applyDuelCommand` accepts it
  unconditionally *and* it zeroes the signature cooldown, so the only thing
  standing between a modified client and a signature every five seconds was a
  `disabled` attribute in the deck. The meter is a pure fold over the event log,
  so the server recomputes it during replay and drops a Break that was not paid
  for. This is why `pet-bond-meter.ts` is now in the server mirror.
- **Rate is capped** — `MAX_COMMANDS_PER_SECOND` on a sliding window, plus a
  total. This is the genuine exploit surface: a script re-ordering every tick.
- **Cooldown / stamina on an ordinary order is NOT rejected**, on purpose. The
  engine already refuses to *execute* an unaffordable or on-cooldown move
  (`commandedOffensive` / `readySupport`); a queued order simply waits out
  `DUEL_ORDER_TICKS` for its window, and the deck **dims** rather than disables
  those buttons because queuing the next move early is intended play. Rejecting
  at issue time would break replay parity and punish honest players for a cheat
  the engine already makes impossible.

**Accuracy is pinned for commanded duels** (`CONTROLLED_DUEL_ACCURACY = true`).
The per-device `petAccuracy.v1` flag cannot survive this design: the server
cannot see a browser's localStorage, so an unpinned flag desynchronises the
replay, and a flag that turns miss chance off is a client-controlled lever on the
outcome. `true` is the flag's own browser default, so this is the fight
essentially every player was already getting. Watch-only duels still read it.

**Failure behaviour is never a payout.** A malformed log, a pet that can no
longer be resolved, or a replay that throws all fall back to the sealed
baseline — the uncommanded fight. Never better than what this replaced.

**Parity assertion:** `pet-duel-live.test.ts` drives a real commanded duel
through the rewind path, then replays its `inputLog()` with the server's exact
loop and asserts `deepEqual` on the outcome across four seeds; a second test
asserts an empty log reproduces `runPetDuelCinematic`. `api/pet/_duel-replay.test.ts`
covers the validation the client cannot be trusted with — hand-written logs,
unpaid Bond Breaks, the rate cap, and enemy-actor commands.

**Residual risk:** the replay re-resolves the player's pets from the live save at
report time, so a pet edited mid-fight (gear swap in another tab) would resolve a
different fight and fall back to the baseline. The 15-minute token TTL bounds
this, and it fails safe.

### 9.7 Not built yet

Phase 2 (timed action commands) and Phase 3 (Clash) are unstarted.

Phase 4 (promotion to **competitive**) is still not done, but the bar has dropped:
§9.6 built the input-log replay it depended on, and casual PvE now runs on it. What
Phase 4 still needs is the part §6 describes — ranked/ladder/sector-war are
two-sided, so promoting them means deciding how a *second* player's inputs and a
disconnect are handled, not just replaying one log. Note also that §6's premise
("casual PvE is client-authoritative, so this ships without touching competitive
outcomes") no longer describes casual PvE.

## Sources

- [Auto battler — Grokipedia](https://grokipedia.com/page/Auto_battler)
- [What If Idle RPGs Let You Design the Auto-Battle? — Medium](https://medium.com/@sexwoojisung/what-if-idle-rpgs-let-you-design-the-auto-battle-0ab3cdb24295)
- [Games based entirely on Auto Battle — RPG Maker Forums](https://forums.rpgmakerweb.com/threads/games-based-entirely-on-auto-battle.104321/)
- [Monster Hunter Stories — Monster Hunter Wiki](https://monsterhunterwiki.org/wiki/Monster_Hunter_Stories)
- [Monster Hunter Stories 2: Wings of Ruin — Wikipedia](https://en.wikipedia.org/wiki/Monster_Hunter_Stories_2:_Wings_of_Ruin)
- [Action Command — Super Mario Wiki](https://www.mariowiki.com/Action_Command)
- [Notes on Combat Systems in Paper Mario — Dampfkraft](https://www.dampfkraft.com/games/paper-mario-combat.html)
- [Super Mario RPG Game Design: Timed Hits in Turn-Based Combat — Kokutech](https://www.kokutech.com/blog/gamedev/design-patterns/unique-mechanics/super-mario-rpg)
- [Digimon World — Wikipedia](https://en.wikipedia.org/wiki/Digimon_World)
- [Digimon World: Next Order — Steam](https://store.steampowered.com/app/1530160/Digimon_World_Next_Order/)
