# Pet Coliseum — retiring the legacy duel sim

**Status:** scope only, nothing implemented. Written 2026-08-14, after the Pet
Showdown rebuild (rounds 1–47) shipped to main at `7b7c91ba4`.

**The question this answers:** "did you retire the old Pet Coliseum and tie
everything together with the new one?" No. The new turn-based battle shipped
*additive* — it sits above the legacy entry on the Arena screen, shares the
reward spine, and touches nothing else. This document scopes finishing the job.

---

## 0. Naming, so the rest of this is readable

Three names that this repo's code blurs together:

| Name | What it means here |
|---|---|
| **Pet Coliseum** | The **mode** — the arena battle. It is *supposed to be* the new turn-based system. The screen still calls the new entry "Pet Showdown" and the old one "Enter the Coliseum", which is the confusion this document exists to end. |
| **The legacy duel sim** | The **implementation** currently sitting under the Coliseum mode: `pet-duel-cinematic`, `pet-duel-sim`, `pet-duel-doctrine`, `pet-duel-live`, `pet-duel-lockstep`, and `PetColiseum.tsx`. **This is the thing being retired.** |
| **Warfront / Tactical Arena** | A **separate game mode**. Lane war, positional, its own engine (`pet-warfront-sim`, `pet-board-sim`, walkmask/map/strategy). Not a remnant of the Coliseum, not a migration target, not in scope. |

The mode is not being retired. The **sim underneath it** is, so that the
Coliseum mode is the turn-based battle everywhere it appears instead of in one
of two places depending on which button you press.

---

## 1. What is actually left to do

The new engine already runs the Coliseum mode when you enter through the Pet
Showdown button. Four other places still enter the Coliseum mode through the
legacy sim:

| Entry | Server path | Currently resolves via |
|---|---|---|
| Arena exhibition ("Enter the Coliseum") | `pet/battle-start` → `pet/battle-result` | `runPetDuel` / `runPetPartyDuel` |
| Pet Ladder — duel challenges | Ranked journal, replay `kind: "coliseum"` | `runPetDuelCinematic`, byte-identical client replay |
| Hollow Gate pet duels | `pet/battle-result` + run-bound receipt | `runPetDuelCinematic` / `createLiveDuel` |
| Clan War pet1v1 / pet2v2 | `clan/war/pet.ts` → `_pet-duel.ts` | Deterministic auto-resolve from `(pets, seed)` |
| Live pet PvP | Lockstep | `pet-duel-lockstep.ts` |

That is the whole job: five entries onto one engine, then delete the sim
(~19,200 lines across the client originals, the server mirror, and the view).

**Note on the Ladder:** it stores two replay kinds — `"coliseum"` duels *and*
Warfront matches. Only the duel kind is in scope; the Warfront rows keep their
reader untouched. The Ladder spans both modes because it ranks both, which is
correct and stays that way.

---

## 2. What stays, and why that is not a compromise

`api/_pet-sim/` and `scripts/gen-pet-sim.mjs` **survive this work**, because
Warfront and Tactical Arena are a different mode and still need their mirror
and their parity tests. Nothing about that is unfinished business — the
generator simply ends up mirroring one engine instead of two.

Concretely, after Phase 5 the mirror still carries `pet-warfront-sim`,
`pet-board-sim`, `gauntlet-sim`, the walkmask/map/strategy files, and the shared
`pet-types` / `pet-config` substrate that both modes read.

---

## 3. What makes the port cheap, and what makes it expensive

**Cheap — the engine already has the pieces:**

- `resolveShowdownRound()` already returns a `ShowdownEvent[]` — a persistable
  event log. The replay format the Ladder needs mostly exists.
- `session.pvp` + `turnDeadlineAt` already exist, so live PvP has a successor.
- The new engine is server-authoritative with **no client mirror**, so each
  ported entry *removes* a parity surface instead of adding one.
- The reward spine is already shared: `totalPetWins`, `dailyPetWins` (the
  100/day faucet), the public `pets` leaderboard, the questbook counter, and
  `rewardEligible` sealed at start.

**Expensive, and this is the real cost:**

- **Every ported entry changes its balance.** The two engines produce different
  outcomes from the same pets. Ladder standings, Hollow Gate difficulty, and
  clan-war pet win rates all shift the day they port. Unavoidable — so it gets
  planned, not discovered.
- **Stored replays.** Ladder journals hold `kind: "coliseum"` rows produced by
  the old sim. Dual-read is the safe answer; never migrate rows in place.
- **Auto-resolve does not exist yet.** `chooseShowdownAiCommands(session)` picks
  for the enemy side only. Clan war needs both sides driven headlessly and
  deterministically.

---

## 4. Phase plan

**NO FLAGS. NO GATING.** (Owner ruling, 2026-08-14, overriding this document's
first draft.) The old sim is being *removed*, not made optional — a flag would
mean shipping both engines and calling that done, which is the split-brain state
this work exists to end. Every phase rewires its entry directly, and Phase 5
deletes the sim. The revert unit is the commit, not a runtime switch.

The numbering is a real dependency order: Phase 0 blocks everything, and Phase 5
cannot start until 1–4 are in. Phases 1–4 land together rather than trickling
out (owner ruling: build 1–4, ship as one), so the mode changes once.

### Phase 0 — Foundations (blocking; no player-visible change)

1. **Headless deterministic resolve.** Generalize `chooseShowdownAiCommands` to
   pick for either side, and add a loop-to-verdict resolver. Must be pure over
   `(pets, seed)` so clan war stays re-derivable.
2. **Replay envelope.** Define the stored shape (`kind: "showdown"`, seed,
   sealed teams, `ShowdownEvent[]`) and a reader that plays a stored log with no
   live session. The existing coliseum reader stays untouched beside it.
3. **Regression harness.** Run N seeded matchups on both engines and report
   win-rate deltas per element and role — the instrument that turns every later
   balance shift into a measured number.

*Sizing: one focused session. Nothing is wired yet, so nothing changes for players.*

### Phase 1 — Arena exhibition

Point `battle-start` / `battle-result` at a session on the new engine; delete the
`runPetDuel` path from those two handlers only. Lowest risk: it already shares
the reward spine, receipts and the daily cap, and Phase 0's harness quantifies
the balance move before it ships.

*Sizing: one session. The `runPetDuel` call is replaced, not bypassed.*

### Phase 2 — Pet Ladder (duel challenges only)

New challenges resolve on the new engine and store `kind: "showdown"`; existing
rows keep playing through the coliseum reader. Warfront rows untouched.

*Sizing: one to two sessions — the dual-read and the journal shape are the work.*
*The legacy `kind: "coliseum"` reader stays for existing rows — that is history, not a fallback engine.*

### Phase 3 — Hollow Gate duels

Port the duel, preserve the run-bound receipt handshake exactly
(`hollowGatePetResultKey`, one-use, consumed by the Hollow Gate settlement
endpoint). That receipt is the anti-cheat boundary and must not be re-derived —
only its producer changes.

*Sizing: one session.*

### Phase 4 — Clan War pet duels

Uses Phase 0's headless resolve. The invariant to hold: the client passes no
commands and the server re-derives the same verdict from `(pets, seed)`.

*Sizing: one session.*

### Phase 5 — Deletion and collapse

Only after 1–4 are in:

- Remove the "Enter the Coliseum" card from `PetArena.tsx`. One mode, one entry,
  and it should probably stop being called two different things in the UI.
- Delete the legacy duel sim: `pet-duel-sim`, `pet-duel-cinematic`,
  `pet-duel-doctrine`, `pet-duel-live`, `pet-duel-lockstep`, and the duel path in
  `PetColiseum.tsx` (~19,200 lines).
- Drop `pet-duel-*` from the `gen-pet-sim.mjs` file list; **keep the generator**
  for Warfront.
- Retire `pet-cinematic-parity.test.ts` and the duel half of
  `pet-sim-parity.test.ts`. Every Warfront parity test stays.
- `PetColiseum.tsx` is 9,724 lines and also serves board modes — audit imports
  first. Likely a carve, not a file removal.

*Sizing: one to two sessions, mostly verification.*

---

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Balance shifts in four live entries | **High** | Phase 0 harness measures the delta per entry BEFORE the change ships; the revert unit is the commit |
| Hollow Gate receipt regression | **High** (anti-cheat) | Change the producer only; receipt shape, TTL and single-use semantics frozen |
| Clan war determinism break | **High** | Headless resolve pure over `(pets, seed)`; regression test re-derives a known verdict |
| Stored ladder replays unplayable | Medium | Dual-read; never migrate rows in place |
| Daily faucet pressure (`dailyPetWins` 100/day shared) | Medium | Ported entries must not become newly reward-eligible; audit `rewardEligible` per entry |
| Pet busy/lease flags diverge | Medium | The new engine must take the same `_pet-busy` / `_active-battle-lease` locks the duel path takes |
| `PetColiseum.tsx` carve breaks board modes | Medium | Phase 5 audits imports before deleting anything |

---

## 6. Out of scope, stated once

Warfront, Tactical Arena, Gauntlet board runs, and the Ladder's Warfront
replays. Separate mode, separate engine, separate balance. Untouched.

A pet's kit in the Coliseum is still *derived at seal* and will still differ from
that pet's kit in Warfront. Unifying that means editing the shared catalog, which
is a different decision with blast radius across every mode.

---

## 7. Decisions needed before Phase 0

1. **Balance:** is a win-rate shift in Ladder / Hollow Gate / clan war acceptable
   as the cost of one engine, or should each port be tuned back toward its
   current curve? (Tuning back roughly doubles each phase.)
2. **Ladder history:** dual-read old replays (recommended), or accept that
   pre-port replays stop playing?
3. ~~**Order**~~ — SETTLED: build 1–4 and ship them together, no flags.

---

## STATUS — 2026-08-14 (live on main through `cd878fbb8`)

Five of the six entries resolve on Showdown. What that bought, and what is
honestly left.

### Done

| Entry | How it resolves now |
|---|---|
| Clan War pet duels | `resolveWarDuel` headless; watch action re-derives the log |
| Sector War pet duels | same, plus terrain → standing arena **weather** |
| Ranked | headless; engine version `showdown-ranked-v2` refuses pre-cutover tokens |
| Pet Ladder (coliseum) | scored + `coliseumScript` from the same inputs |
| Arena exhibition | new **paid** `arena` entry: arena-matched, cap checked up front |
| Hollow Gate | arena bout bound to the run, minting the identical `hg-pet-result` receipt |
| Dungeon seal + authored VN pet battles | `encounter` entry: the server rebuilds the opponent from a selector (§9) |

**§8 records what tracing the client actually found**, and it is worth reading
before trusting any row here: this table was true of the SERVER, and three rows
had no client wiring at all when it was written. Hollow Gate and Ranked are now
wired end to end (§8, §10). Casual AI and PvP/clan-party duels in `PetArena.tsx`
are the remainder.

Format ruling applied: every war duel is **2v2 with a 2-pet bench**
(`WAR_DUEL_FORMAT`), teams filled from the owner's roster behind the champion
they send (`war-team.ts`). The daily faucet cap has ONE definition
(`SHOWDOWN_DAILY_WIN_CAP`) read by both handlers and printed in the lobby.

The Arena screen shows one Coliseum with two doors: **Enter the Coliseum**
(paid, arena-matched, capped) and **Training Grounds** (free, you pick, no
counters). Same engine behind both.

### NOT done — and why each is non-trivial

1. ~~**`DungeonPetBattle`**~~ — **DONE 2026-08-14.** See §9 below.

2. **`PetArena`'s legacy machinery.** `startBattle`, `mintCasualPetBattleToken`
   and `reportPetBattle` still serve the PvP and party paths woven through a
   2,570-line screen. **This item is bigger than this line made it sound — see
   §8, which is what the screen actually still runs.**

3. **Deleting the sim.** Only safe once 1 and 2 land.
   ~~`api/pet-ladder/_duel-sim.ts` is ALREADY orphaned~~ — **deleted 2026-08-14**
   (`256e64232`), along with `_walkmask.ts`, its only reader. The rest of the
   deletion still waits on item 2.

---

## 8. What `PetArena.tsx` still runs — read this before planning item 2

Written 2026-08-14 after tracing every branch of `startBattle`. The "Done" table
in §7 above is accurate about the **server**, and that is the trap: three of its
rows have **no client wiring**, so what a player actually plays is still the
legacy engine. `PetArena.tsx` imports nothing from `pet-showdown-api` — only the
daily-cap constant.

| Path | Server | Client |
|---|---|---|
| Casual AI 1v1 / 2v2 party | Coliseum entry exists (`arena`) | PetArena still runs `runPetDuelCinematic` / `runPetPartyDuelCinematic` |
| Hollow Gate pet duel | `pet/showdown` `arena` accepts a `hollowGate` binding and mints the identical `hg-pet-result` receipt | **NOTHING CALLS IT.** `startArenaBout` has no `hollowGate` parameter, and `hollow-gate-app-flow.ts` `launchPetFight` still sends the player to `petArena`, which mints a `battle-start` token and fights the legacy sim |
| Ranked 1v1 | genuinely server-authoritative — `ranked-start` decides the winner at mint (`_ranked-engine.ts` `resolveWarDuel`, `showdown-ranked-v2`) and settlement pays from the sealed resolution | PetArena still runs `runPetDuelCinematic` locally and shows ITS result. The two engines can disagree, so a player can watch a victory and be rated a loss |
| PvP / clan-war 1v1 and 2v2 | not ported | client-resolved, both clients deriving the same fight from the seed |

So item 2 is four ports, not one, and they are not equally hard:

- ~~**Hollow Gate**~~ — **DONE.** `lib/hollow-gate-app-flow.ts` `launchPetFight`
  now opens a run-bound Showdown bout on the shrine itself instead of routing to
  the arena, `components/HollowGatePetFight.tsx` hosts it, and the Gate settles
  with the session id as the receipt. The handshake is untouched; only the
  producer moved. Every trace of the Gate is gone from `PetArena.tsx`, and
  `PetArenaOpponent` no longer carries a run binding.
- ~~**Ranked**~~ — **DONE, and it was worse than "presentation".** See §10.
- **Casual AI** duplicates what the Coliseum entry already does; retiring
  PetArena's own AI exhibition is mostly deletion.
- **PvP / clan party** is the real remainder, and needs either live PvP on the
  engine (`session.pvp` + `turnDeadlineAt` exist and are dormant) or headless
  resolution both clients read back.

### A forfeit is now a concession

Found while wiring the Gate: `pet/showdown` `action:'forfeit'` deleted the
session and answered ok. Harmless while every bout was practice — a loss pays
nothing either way — but the moment a bout could be BOUND to a Hollow Gate
encounter it became a way to walk out of a fight the run was waiting on: the
receipt is minted by the FINISHING TURN, so a deleted session left the Gate
sealed with no outcome to settle and no path back to one.

A forfeit now decides the session as a loss and runs the same bound-encounter
handshake the finishing turn runs. Conceding still cannot pay (the payout path
is only reachable from a winning finishing turn, and the reward-boundary test
now asserts that), but it can no longer strand what was waiting on the answer.

---

## 10. Ranked was not a presentation bug — it was two fights

§8 called ranked a presentation-only port. Tracing it properly turned up worse.

The ranked pet queue resolved the SAME match twice, with two engines and two
seeds:

| | engine | seed |
|---|---|---|
| Server (rated it) | `runPetDuel`, the legacy plain duel sim, in `battle-result.ts` | `token.seed`, minted by `ranked-start` |
| Client (showed it) | `runPetDuelCinematic`, a **different** engine | `petBattleSeed`, a `Date.now()`-derived number the CHALLENGER generated and shipped inside the challenge |

Nothing tied those together. The fight a player watched had no reliable
relationship to the Elo it moved — a convincing victory could be recorded as a
loss, and nothing distinguished that from an honest defeat.

The fix makes the watched fight *be* the rated fight:

- `api/pet/_ranked-duel.ts` resolves a match once, on Showdown, as a PURE
  function of the sealed token (1v1, because the token seals one pet per side).
- `battle-result.ts` rates through it — both at intent time and at the
  determinism cross-check — and no longer imports the legacy sim at all.
- `api/pet/ranked-watch.ts` re-derives the same call and hands the log to the
  two participants (`store inputs, not fights`, same doctrine as war duels).
- `PetArena.tsx` plays that log through `PetShowdownReplay`. There is
  deliberately **no local fallback**: a locally simulated ranked fight is
  precisely the bug, so a failed fetch shows a retry rather than a lie.

The winner comes back as an account NAME, never a side, because both
participants call the same endpoint and must never be told different things.

Consequences worth stating: Showdown's judge always decides, so **ranked pet
matches no longer draw**. The draw settlement branch in `battle-result.ts` is
kept (the receipt shape still allows it) but is unreachable for any token the
current engine resolves, and the test that used to prove a stalemate drew now
proves a stalemate is decided.

---

## 9. The authored-encounter port (item 1) — how the trust problem was solved

The blocker was never effort: `DungeonPetBattle` fights an opponent the caller
supplies (a random rare beast for the relic dungeon's third seal, an
admin-authored boss for a VN choice), and Showdown had no entry that would take
one. Posting the opponent's stats would have been a new surface of exactly the
kind this repo forbids.

The answer is that the request carries a **selector, never an opponent**:

- **Dungeon Rare Beast Seal** — the client sends its own server-minted dungeon
  RUN TOKEN. The server checks the run is the caller's, checks its Warden is
  already down (seal 3 behind seal 1 — an ordering only the dungeon screen's
  stage machine used to enforce), and derives the beast from
  `hash(player:runToken)` over the server pet catalog. A reload cannot reroll it.
- **Authored VN pet battle** — the client sends the event id plus the authored
  `(petId, difficulty)` pair naming which choice it is standing in. The server
  reads that event out of `save:admin1` / `save:admin2` / published content
  (`api/_admin-event-catalog.ts`, the same dual-read shape as the AI catalog),
  finds the authored row, and builds the boss from it.

Both scale with ports of the client formulas (`scaleEventPetOpponent` +
`capPetStats`, and the dungeon boost block) so the ENGINE is the only thing that
changed. Both seal `rewardEligible` false: these bouts decide an OUTCOME, and the
rewards stay where they were — the dungeon run's own settle endpoint and the
event's completion. Format is 1v1 with **no bench**, because handing the player
three pets against a single authored boss would move the difficulty far more
than the engine swap does.

The reward-boundary test now pins three seal forms rather than two, and asserts
the authored entry reads no stat, level or tier off the body.

### Guardrails added along the way, worth keeping

- `_showdown-rewards.test.ts` pins the exact set of `rewardEligible` seal forms
  (`['false', '!hollowGate']`), each to its entry block, and proves the Hollow
  Gate binding is server-constructed only after the run claim validates.
- `_settlement-contract.test.ts` enforces that the finishing turn persists the
  session ADJACENT to settlement — it caught a real ordering fault where the
  receipt was minted before the session it points at was durable.
- `_battle-receipt-idempotency.test.ts` now follows a shared-constant alias
  rather than demanding a duplicated literal.

---

## 11. The player challenge was two fights too — and Phase 5 is not unblocked

§10 found ranked resolving twice. The plain player challenge (`mode:
'clanWarPet'`, 1v1 and 2v2) was doing something worse, and this section records
both the fix and the reason the deletion phase still cannot run.

### What was actually happening

Both participants called `/api/pet/battle-start` for their own reward token. That
endpoint minted **its own `randomInt` seed per caller** and sealed its own
`authoritativeOutcome` from it. So one challenge produced **two unrelated
fights**, and each player was rated on the one their own client asked for. Both
could honestly be told they had won, and the clan-war report each filed came from
its own view. On top of that, each client then rendered `runPetDuelCinematic` —
a different engine from the `runPetDuel` the server sealed with — so the fight on
screen could disagree with the payout even within one client.

### The fix: seal the duel against the challenge, at accept

`api/pet/_pvp-duel.ts` seals ONE duel per challenge: both rosters by value, one
server-minted seed, one format. It is sealed in `api/player/challenge.ts` at the
moment the responder accepts, because that is the only point where the server has
already validated **both** id lists against **both** owners' saves. Sealing later,
in `battle-start`, would have let whichever participant called first choose which
of their opponent's pets had to fight.

`battle-start` now reads that seal instead of inventing a fight: same teams, same
seed, same verdict for either caller, and it returns the `ShowdownReplayScript`
so both clients watch the fight that was rated. `PetArena.tsx` plays it through
`PetShowdownReplay` with **no local fallback**, for the same reason ranked has
none. `battle-result` needed no change — it already took the outcome from the
token rather than the body.

Two deliberate consequences:

- **Format follows the challenge**, 1v1 or 2v2 with no bench. `WAR_DUEL_FORMAT`'s
  forced 2v2-plus-bench is a ruling about *war* duels, where the roster that
  arrived was an accident of the submission flow. Two players who each sent one
  champion agreed to a 1v1.
- **Consumables no longer fire** in a challenge duel, and the settlement no longer
  spends them (`pvpParticipatingPets` seals empty consumable slots). Same split
  war duels make, for the same reason: the fight is decided at accept, before
  either side settles, so a burned item could never be honestly charged.

### What the client tracing turned up, which changes the Phase 5 plan

§8's table listed "PvP / clan-war 1v1 and 2v2" as one client-resolved entry.
Tracing every producer of `pendingPetBattleOpponent` found three, and they do not
share a fate:

| Entry | Producer | State after this change |
|---|---|---|
| Clan-war / casual pet challenge | `Arena.tsx` incoming-challenge list → "Open Pet Coliseum" | **Ported.** Server-sealed, watched. |
| Live PvP pet duel | `PetArena.tsx` Challenge button → realtime socket → `PetDuelLiveHost` | **Untouched.** Still lockstep on the legacy engine. |
| Sector wanderer duel | `WorldMap.tsx` → a scaled `genericPetArenaOpponents` beast | **Untouched.** Still the legacy engine locally. |

Two things follow that the earlier plan did not account for.

**Live PvP is not an alternative to the async path — it is the current one.**
`lib/pet-duel-legacy-challenge.ts` retires any non-arena pet challenge that
arrives through App's global accept banner, with the note that "PvP pet duels are
live-only". §8 offered live-PvP-on-Showdown *or* headless resolution as two ways
to do the same job; they are actually two different features, and only the
headless one is now done. (Note also a pre-existing inconsistency this change did
not touch: the global banner retires these challenges while `Arena.tsx`'s own
list still accepts and starts them.)

**The casual-AI retirement is not "mostly deletion".** Removing the screen's own
AI opponent picker is — that duplicated the Coliseum entry and is gone. But the
World Map sends players into this screen to duel a *specific* roaming beast, and
Showdown has no entry that accepts a caller-named opponent of that shape: the
authored-encounter entry (§9) takes a dungeon run token or an admin-authored
event id, and the arena entry picks the opponent itself. Porting it means a new
server-side selector — a wanderer id the server resolves into a beast, the same
trust shape §9 used — which is its own piece of work. Until then that one fight
stays on the legacy engine rather than a live world feature being deleted.

### So Phase 5 remains blocked, and by more than PetArena

Every legacy duel module still has live importers outside this screen:

- `pet-duel-lockstep` ← `pet-duel-transport`, `PetDuelLiveHost` (PetArena **and**
  `PetLadder`), and server-side `api/_realtime/pet-duel-socket.ts` +
  `pet-duel-session.ts`. This is live PvP.
- `pet-duel-cinematic` / `pet-duel-live` ← the wanderer duel above, plus
  `PetColiseum.tsx`, `PetDuelCommandDeck`, `petvfx.tsx`.
- `pet-duel-doctrine` ← `PetDoctrineEditor` (mounted by `PetYard`),
  `pet-duel-transport`, and server-side `api/pet/_duel-replay.ts` +
  `api/_realtime/pet-duel-socket.ts`.
- `pet-duel-sim` ← `PetColiseum.tsx`, `pet-duel-broadcast`, `pet-bond-meter`,
  `PetDuelLiveHost`.

The remaining order, then, is: port the sector wanderer (server-side selector),
port live lockstep PvP, then delete. Nothing above is a reason to keep the legacy
engine forever; it is the list of what actually has to move first.

### The wanderer is DONE (2026-08-15) — and `PetArena.tsx` is off the legacy engine

`api/pet/_wanderer-duel.ts` builds the beast; `battle-start` resolves the bout on
Showdown and hands back the script. The selector shrank to nothing worth
trusting: the request says only "this is a wanderer duel", and the tier and
scaling come from the CALLER'S OWN SAVED LEVEL. That closed a real hole rather
than just swapping engines — the payout scales with the opponent fought
(`petArenaRyoRewardForTeam`), and the tier used to be the client's pick, so a
level-5 client asking for the apex template was asking for a bigger purse.

**`PetArena.tsx` now imports no `pet-duel-*` module at all.** Every fight it
starts is server-decided: ranked at its match token, a challenge at accept, a
wanderer at mint. One renderer, no input logs, no "fight again" — the screen has
nothing left to simulate. The settlement guard test now asserts that directly.

Known balance consequence, stated rather than discovered: Showdown has no PvE
mastery multipliers anywhere, so the Pet Tamer damage bonus, the mastery HP bonus
and Alpha Bond's revive no longer apply to a wanderer duel. That is the wanderer
becoming consistent with every other fight already on the engine, not a nerf
aimed at it.

Server-side, this also orphans the whole casual-PvE replay spine —
`api/pet/_duel-replay.ts`, `_casual-pve-seal.ts`, and the `runPetDuel` /
`runPetPartyDuel` imports in `battle-start` — since nothing produces a
`casualPveSeal` any more. **Live lockstep PvP is now the only thing standing
between here and deleting the sim.**

### OWNER RULING, 2026-08-15: two modes, and live PvP is PORTED not retired

The long-run target is **the new Pet Arena and the Tactical Arena, and nothing
else**. That decides the open question above: real-time pet PvP is a feature OF
the pet arena, not a third mode, so it moves onto Showdown (`session.pvp` +
`turnDeadlineAt`) rather than being deleted. Retiring it would have been the
cheap route to deleting the sim and would have cost the game real-time play.

Two consequences worth stating now:

- The remaining work on it is smaller than its line count suggests. The engine,
  the session, the deadline field and the battle component all exist. What is
  missing is pairing over the existing socket, both sides submitting to
  `pet/showdown` `turn`, and the lapsed-round rule the endpoint already
  describes: resolve with defaults for the absent side, which the engine already
  does (a missing command defaults to guard).
- The OLD tactical arena goes with it. `PetArenaMatch` + `lib/pet-arena-sim.ts`
  are the pre-Warfront arena; the mode that survives is `PetWarfrontMatch` +
  `pet-warfront-sim`. Two modes means one renderer each, not one each plus their
  ancestors.

**A finding that changes the size of the final step.** §4 assumed
`PetColiseum.tsx` (9,786 lines) is "likely a carve, not a file removal" because
it also serves board modes. It does not, any more. Of its three exports:
`<PetColiseum>` has ZERO JSX consumers anywhere (it rendered from `battleFrames`,
which nothing has populated in some time); `PetArenaMatch`'s only consumer is
`petvfx.tsx`, the `/petvfx.html` dev harness; and `PetColiseumDuel`'s only
consumer is the sector wanderer duel. Once the wanderer moves, the whole file's
only remaining reader is a dev preview page — a delete plus a decision about the
harness, not a carve. Confirm no dynamic import hides a consumer before acting.
