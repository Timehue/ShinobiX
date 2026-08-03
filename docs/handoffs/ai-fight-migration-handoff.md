# Handoff — Generic AI-Fight Migration + PvE difficulty authority

Rewritten 2026-08-02 after pushing steps 2, 3a and 3b to `main`. Read this first.

## Where main is

`main` is **52dc1a221**, pushed 2026-08-03. Steps A, B, C, 3c and the 3d server
half are all ON it. Gates run immediately before the push, all exit 0:
`npm test` **4640/4640**, `tsc -p tsconfig.cpanel.json`, `npm run build`
(verify:dist OK, sizecheck PASS 6.80 MB), `npm run certify:release` **28/28**,
client `npm run lint` 0 errors.

⚠ **This push CHANGED LIVE PvE BALANCE.** Everything before it was inert behind
`ENABLE_SERVER_AI_COMBAT`; steps B and C are not. Combat missions, story bosses,
tower/Spire floors and the clan boss now run the standard-PvE hit guard, and
their AI enemies now cast at real jutsu mastery instead of 30%. Both ship ON,
with rollback switches (below). B and C were deliberately pushed TOGETHER — B
alone softens PvE, C alone spikes it; they are the equilibrium only as a pair.

**Rollback, in order of bluntness:**

| Switch | Effect |
|---|---|
| `DISABLE_PVE_AI_MASTERY=1` | enemies return to 30% jutsu damage (undo C) |
| `DISABLE_PVE_DIFFICULTY_GUARD=1` | removes the band + hit guard (undo B) |
| `DISABLE_PVE_AI_MASTERY_<MODE>` | one mode only: `MISSION` `STORY` `TOWER` `SPIRE` `CLAN_BOSS` |
| `DISABLE_PVE_DIFFICULTY_GUARD_<MODE>` | one mode only: `MISSION` `STORY` `AI_FIGHT` `TOWER` `CLAN_BOSS` |

`SPIRE` is the dial most likely to be wanted: its level-100 bosses sit in the
PEER band where the hit guard is an intentional no-op, so the ~3.3x mastery
uplift is **unbounded** there — the largest single difficulty swing in the push.

**3d is now COMPLETE (client + server) and the AI-fight path ships ON.** The flag
inverted: `serverAiCombatEnabled()` reads `DISABLE_SERVER_AI_COMBAT !== '1'`, so
an empty env arms it and only the explicit kill switch takes it out (pinned by a
test, so "ships on" cannot silently regress). Turning it off makes the endpoint
seal nothing, and every routed launch site degrades to the local Arena through
its own `playLocally` fallback.

| Switch | Effect |
|---|---|
| `DISABLE_SERVER_AI_COMBAT=1` | no encounter is sealed; every AI fight plays on the local Arena |

## Done

| Step | What | Where |
|---|---|---|
| 1 | `aiOpponentEnemyTemplate` — defeatable enemy from an AI profile | `api/_authoritative-pve.ts` |
| 2 | `ai-fight-start` seals a real encounter, returns `runId` | `api/missions/ai-fight-start.ts`, `_ai-fight-encounter.ts` |
| 2 | Generated mirror of the 71 built-in AI profiles | `api/_ai-profile-catalog.ts` |
| 2 | AI loadout resolution (catalog ∪ admin, sanitized) | `api/_ai-opponent-loadout.ts` |
| 3a | Server port of the AI level curves + `relevelBuiltinAi` | `api/_ai-level-curves.ts` |
| 3b | Server port of the PvE difficulty layer | `api/_pve-difficulty.ts` |
| 3b | `damageCap` threaded through the damage resolver; guard wired | `api/combat-core/resolveJutsu.ts`, `api/pvp/move.ts`, `api/towers/_engine.ts` |
| A | The four band-behaviour helpers wired into the engine's action picker | `api/towers/_engine.ts`, `api/_pve-ai-tactics.ts` |
| B | The band + hit guard armed on every other server PvE mode | `api/_pve-band-seal.ts` |
| C | Server AI enemies given their real jutsu mastery | `api/_pve-ai-mastery.ts` |
| 3c | Encounter scaling derived from SERVER state | `api/missions/_ai-fight-scaling.ts` |
| 3d | `ai-fight-start` returns the sealed session (server half only) | `api/missions/ai-fight-start.ts` |

Parity/behaviour tests: `scripts/ai-profile-catalog.test.mjs`,
`scripts/ai-level-curve-parity.test.ts` (~38.6k comparisons),
`scripts/pve-difficulty-parity.test.ts` (>5k-case guard grid),
`api/towers/_pve-guard.test.ts`, `api/missions/_ai-fight-encounter.test.ts`.
The three parity suites were **mutation-verified** (a deliberate wrong constant
fails them) rather than trusted for being green.

## ⚠ The finding that matters most: server AI casts at 30% damage

`api/pvp/move.ts` `applyJutsu` reads jutsu mastery off the **caster's**
`character.jutsuMastery`. **No server enemy template has ever carried one**, so
every server-sealed AI casts at `masteryDamageFrac(0) = 0.3` — 30% of the jutsu
damage the client's PvE AI deals (the client passes `pveAiMasteryForLevel`
explicitly). Corroboration that this is an oversight, not a balance choice:
`api/towers/_merc-fighters.ts:66` gives squad-side AI **allies** `level: 50`.

Empirically confirmed at ~3.3× in `api/towers/_pve-guard.test.ts`.

**Fixed for AI fights only.** Still open for **combat missions, story bosses,
Hollow Gate, the towers, clan boss, Anbu vault and the weekly boss** — their
templates were hand-tuned with mastery 0 in place, so correcting them is a real
balance change. Very likely why some server PvE reads as limp.

## Owner rulings (2026-08-02)

1. **Guard first, then mastery everywhere.** Do not enable enemy mastery in the
   other modes until the difficulty guard is extended to them — those modes have
   no mercy caps today, so tripling enemy jutsu damage first would wreck
   onboarding (the E-rank drill especially).
2. **Extend the guard + band layer to every server PvE mode, default ON with a
   kill switch.**
3. Arena practice spar keeps its player-chosen level slider; the server seals
   whatever level was chosen. Reward is flat and daily-capped, so the exposure
   is bounded throughput — no worse than today's fake-a-win.
4. Scope is: finish the AI-fight migration.

## Next, in order

### ~~A. Wire the four AI-behaviour helpers~~ — DONE

All four now drive `bestAffordableJutsu` / `pickAiAction`, gated on a sealed
`session.pveGuard` **and** `side === 'enemy'` (so squad-side AI — async allies,
AFK humans — and every mode that seals no guard stay byte-identical):

- **burst hold** — `pveEasyBandHoldsBurst` + `pveIsBurstJutsuAp` filter 60+ AP
  jutsu out of the pool for rounds 1-2 in the easy band. `session.round` is the
  right mirror of the client's `turn` (both advance once per full round).
- **lethal intent** — `pveEasyBandAllowsLethal` makes the AI *prefer* the
  strongest non-lethal option against a player above 25% HP. It only
  DEPRIORITIZES, like the client: with no weaker option it still casts, so the
  AI is never disarmed into passivity.
- **competence** — `pveAiCompetence` emits `clear` / `cleanse` actions at the
  band thresholds, ahead of the jutsu pick (the client's order).

Two of `PveAiCompetence`'s five fields have no server analogue and are
deliberately **not** wired — see the header of `api/_pve-ai-tactics.ts`:
`usesSmartScorer` (the engine has one policy, not two) and `readsBehavior`.
`readsBehavior` needs no port because it is **inert on the client too**: it is
applied as `readsBehavior && justPoweredUp ? 1 : clearBuffThreshold`, and it is
true only in the hard and peer bands, which already carry `clearBuffThreshold:
1`. That ternary can never change the threshold, so no server-side action memory
is needed to match client behaviour. It also means the server never needs the
profile's `masterAi` flag (the sole input `usesSmartScorer` depends on) — which
is just as well, since `aiOpponentEnemyTemplate` does not carry it through.

⚠ Two traps this turned up:

- **Folding the PvE hit cap into the lethal estimate makes the gate dead code.**
  The easy-band per-hit cap is 20% of max HP while the gate only engages above
  25%, so a capped estimate can never reach the KO threshold. The estimate is
  the RAW hit, mirroring the client (which scans raw and clamps separately at
  resolution).
- **The burst hold changes turn 1 of every easy-band AI fight** — the foe now
  approaches instead of opening with a nuke. This broke the *correctly written*
  non-vacuity assertion in `_pve-guard.test.ts` ("the enemy must land damage"),
  which was updated to advance until the enemy actually swings.

New tests: `api/towers/_pve-band-ai.test.ts` (14 cases, incl. the two no-op
guarantees) and `scripts/pve-ai-tactics-parity.test.ts`. Both mutation-verified —
disabling the hold, inverting the lethal gate, shifting the Clear threshold,
letting the band reach squad actors, and drifting the buff list each fail them.

### ~~B. Extend the guard + band to the other PvE modes~~ — DONE

`api/_pve-band-seal.ts` is the single place every entry point calls.
**Shipped ON**; `DISABLE_PVE_DIFFICULTY_GUARD=1` is a rollback, and each mode
also has `DISABLE_PVE_DIFFICULTY_GUARD_<MODE>`. A test asserts an empty env arms
every mode, so "ships on" cannot silently regress.

| Mode | Guard | Band | Why |
|---|---|---|---|
| missions, story | ✅ | ✅ | canonical standard PvE — solo, level-keyed, AI template |
| towers / Spire, clan boss | ✅ | ❌ | already floor- + party- + ascension-scaled; clan boss HP is the SHARED pool |
| AI fights | ✅ | ✅ | unchanged maths, now answers the kill switch |
| weekly boss, Anbu | ❌ | ❌ | see below |

⚠ **Towers and clan boss call `startRound`/`runAiUntilHuman` inline at start** —
the seal must precede them or the opening enemy turn resolves unguarded. Pinned
by a test.

⚠ **The seal is idempotent on two levels** (session `pveGuard`, per-actor
`pveBandScaled`). Compounding 0.6 × 0.6 would trivialize a tuned fight; the
per-actor stamp is what protects a scale-only call, which leaves no guard behind.

**Correction to the previous handoff.** It warned that arming the weekly boss
would "double-clamp" its own guard cycle. The real reason to leave it out is
sharper: `weeklyBossGuardedHit` is **8% per hit / 15% per turn, no band, no
mercy** — roughly **5× TIGHTER** than the hard band this layer would install
(45%/70%). Arming the standard guard there applies the *wrong* mechanic, not a
safer one. And it was never ported, so **the server weekly boss has NO
boss→player clamp today while the client has one** — a real gap, worth its own
commit. (The per-hit cap in `_weekly-boss-fight-token.ts` is the OPPOSITE
direction: anti-cheat validation of client-reported PLAYER→boss damage.)

**Anbu** is excluded because its opponent is `getOrSealAnbuSnapshot(...)` — a
sealed snapshot of a REAL player's ANBU defender, i.e. exactly the
`opponentCharacter` case the client's `isStandardPve` carves out.

⚠ **This is a live balance change, not a parity fix.** These modes are resolved
by the SERVER engine (`MissionArenaFight` posts to `/api/towers/action`), so the
client's `isStandardPve` band never applied to them. They get **easier until C
lands**.

### ~~C. Then enemy jutsu mastery everywhere~~ — DONE

`api/_pve-ai-mastery.ts`, shipped ON with `DISABLE_PVE_AI_MASTERY=1` plus a
per-mode `DISABLE_PVE_AI_MASTERY_<MODE>`.

Armed: missions, story, tower story floors, **Spire**, clan boss — all of which
got the guard in B, which is the ordering the ruling requires. A test asserts
guard-before-mastery-before-`startRound`, so the order cannot silently invert.

Not armed: **weekly boss** (no server boss→player clamp at all — this is the
"mastery before the guard" failure; land it WITH the `weeklyBossGuardedHit`
port), **Anbu** (`sealTowerFighter` already carries the real player's own
mastery), AI fights (self-sealed at 3b), Hollow Gate (not migrated).

⚠ **Spire has its own dial.** Its level-100 bosses are PEER band, where the B
guard is an intentional no-op — so the Spire is the one armed mode where the
~3.3× uplift is **unbounded**, and the biggest single swing in the change.

⚠ The seal **never overwrites an existing `jutsuMastery` array.** That is what
makes it safe for actors sealed from a real save and idempotent on re-seal.

**Also fixed during the A/B tie-in audit:** `pveBandLevelForSession` was matching
the literal actor id `'boss'`, which only the SOLO builders use — every tower
floor was silently falling through to the max-level scan. It now reads
`phaseState.bossId` first. And a round-trip test now proves `pveGuard` survives
`writeSession`/`readSession`; every other test works in memory and would not
have caught the store dropping it.

### D. Finish the migration

- ~~**3c**~~ — **DONE** (`5286e35c5`), `api/missions/_ai-fight-scaling.ts`.

  ⚠ **Much smaller than this plan assumed, and that is a finding.**
  `relevelBuiltinAi` has exactly **ONE** call site in the entire client
  (`Arena.tsx`'s `pendingAiProfile` memo), gated on `missionBattleActive` + a
  combat-mission lookup. **Combat missions are the only entry point that
  re-levels its opponent.** Hunts, apex, rifts, endless, raid and defense all
  use the profile at its AUTHORED level — exactly what the server already
  produces when `scaling` is omitted. So `undefined` for those is the
  verified-correct answer, not a gap; it is what keeps the two sides identical.
  Do not "finish" 3c by inventing curves for them.

  `scripts/ai-fight-scaling-parity.test.ts` pins that premise: it asserts
  Arena.tsx still has exactly one `relevelBuiltinAi` call site and that it is
  still the combat-mission one. A second one → that mode silently diverges → the
  test fails instead.
- ~~**3d**~~ — **DONE, both halves.** Server: `06055d252`. Client: this commit.

  `lib/ai-fight-request.ts` (the launch bus) → `components/AiFightHost.tsx`
  (mounted once in App) → `lib/ai-fight-api.ts` (start + report) →
  `lib/ai-fight-settle.ts` (redeem + the client-owned side effects) →
  `MissionArenaFight`. `lib/ai-fight-loadout.ts` builds the host loadout.

  ⚠ **The previous plan's premise was WRONG and cost real time — read this.**
  It said "all ~8 launch sites are inside `App.tsx`". They are, but **every one
  of them builds a client-authored temporary AI** (`temp-dungeon-ai-*`,
  `temp-academy-spar-*`, `temp-vn-ai-*`, the Hollow Gate encounter, the endless
  `endless-<base>-w<wave>` clone) and stashes it in `temporaryStoryAi`. The
  server resolves `opponentId` against the catalog ∪ admin AIs, so **not one of
  those ids can ever seal** — routing them buys a start round-trip and a
  guaranteed fallback. The sealable launch sites are in **`WorldMap.tsx`,
  `Missions.tsx`, `Logbook.tsx` and `HunterBoard.tsx`**, none of which are under
  the App.tsx ratchet. App.tsx grew by only the 2-line host mount, and a drain
  (`scaleEndlessAiClone` + the pure half of `pickRandomEndlessAi` →
  `lib/endless-tower`) took the ratchet **7,754 → 7,734**.

  **Routed:** hunt beasts, explore ambushes, village-guard raids (×4), sector
  raids (WorldMap + Logbook), the Academy exam bout, creator field missions.

  **Deliberately NOT routed — each for a reason, do not "finish" these:**
  - *Every App.tsx site* + wanderers / quest bosses / story reckonings — their
    ids are built at runtime, so they can only ever fall back.
  - *E/D-rank combat missions* (`Missions.startMissionBattle`, `mission.min <= 5`)
    — their win **queues a claim** and pays nothing; routing them would pay the
    AI-fight reward AND skip the claim. Rank C+ already has its own server path
    via `combat-start`.
  - *`HunterBoard.faceApex`* — see the bug below.

  ⚠ **Reward authority was already server-side, which is why 3d before 4 is
  safe.** The token carries `baseXp`/`baseRyo` (`rewardSource: 'server-save'`),
  so `validateAiFightRewardClaim` **ignores** whatever XP/ryo a client sends;
  `report-ai-fight` pays, applies the secondary rewards, and writes the hunt +
  apex receipts from the SEALED `battleKind`/`opponentId` in one atomic save
  mutation. The only client-claimed thing left is "I won" — which is exactly
  what step 4 closes. The new settle sends **no amount at all** (pinned).

  ⚠ **Practice grants NOTHING on either route.** `settleAiFightWin` returns
  early for `battleKind: 'practice'` without reporting, mirroring Arena's
  `isPlainPractice` early return. Without that guard the server path would have
  started paying ryo for bouts that are meant to pay nothing.

  ⚠ **`lib/combat-math` and `lib/world-state` import back from `../App`**, which
  drags a component (and its `.css`) into the module graph and makes anything
  above them unloadable under node's test runner. That is why the host loadout
  lives in its own `lib/ai-fight-loadout.ts` and why the sector-territory hit is
  passed into the settle as an `onSectorRaidDamage` hook instead of imported.
  Keep `lib/ai-fight-{api,request,settle}.ts` free of that back-edge.

  New tests: `lib/ai-fight-request.test.ts` (bus + host source guards),
  `lib/ai-fight-settle.test.ts` (the authority split). All mutation-verified —
  removing the practice guard, firing side effects on a refused report, dropping
  the bus fallback, dropping the hunt credit, and weakening the runId+session
  guard each fail them.

### ⚠ Found in passing: the Apex kill receipt is never produced

`HunterBoard.faceApex` sets `pendingAiProfileId` and nothing else — no
`raidBattleKind`, no `missionBattleActive` — so Arena's win path takes the
`isPlainPractice` branch, which returns **before** `report-ai-fight` is called.
That endpoint is the only writer of `apexKillReceiptKey`, so an Apex kill leaves
no receipt and the purse can never be claimed. Left alone here on purpose:
routing it as `raidAi` would fix it but also start paying hunt-shaped rewards,
which is a balance change and belongs in its own commit, not a plumbing one.

- **4 — NEXT.** Derive the reward from the settled session: `report-ai-fight`
  should read the sealed `token.runId`'s session and require a completed, WON
  one instead of accepting the client's say-so. Keep `redeemedAiFightRewards`
  for idempotency; the token already carries `runId`, so no second binding key
  is needed. Everything else about the reward is already server-owned (above).

  ⚠ **The local Arena path cannot produce a settled session**, so gating on one
  would break every fight that still falls back — which is all of App.tsx's
  temp-AI launches. Step 4 needs a two-track rule (session present → require the
  win; token with no runId → today's behaviour) until step 5 removes the second
  track.
- **5** — retire the local Arena AI-fight path and the flag. Blocked on the
  launches that cannot seal today: the client-authored `temp-*` opponents would
  each need a real catalog profile (or a server builder that accepts an authored
  template) before the local engine can go.

  `Arena.tsx:861`'s `battleStarted` token-mint effect is the other half of this:
  it is now the FALLBACK path's minting only. Note the host also mints a token
  it then abandons whenever a fight degrades to local — harmless (the token just
  expires unspent, and the daily counter increments on report, not on start) but
  it does halve the effective `ai-fight-start` rate-limit budget. It disappears
  with step 5.

## Traps found the hard way — do not re-learn these

- **`EnemyTemplate['jutsu']` must declare `target` and `tags`.** The engine reads
  both; the encounter builder spreads jutsu through at runtime, so a narrow type
  silently disarms an AI's entire kit at the type boundary.
- **The PvE clamp must go PRE-shield.** The client caps `enemyDamage` before
  `blocked`, and before Wound/Siphon/Recoil/Lifesteal derive from it. Neither
  `res.opponent.hp` nor `fx.amount` exposes that number — both are post-shield.
  Hence the optional `damageCap` in `combat-core/resolveJutsu.ts`. `undefined`
  takes an explicit identity branch so PvP stays byte-identical.
- **`applyAoeSplash` bypasses `runJutsu`** and needs its own cap, or a
  multi-target enemy blast walks past the per-turn ceiling and the mercy floor.
- **`relevelBuiltinAi` DROPS `hpFloorExempt`** (it omits `makeBuiltinAi`'s 10th
  arg). Reproduced deliberately — see `lib/apex-contract.ts:18-24`.
- **`distributeStatBudget` is `STAT_KEYS`-order dependent** (the rounding-stall
  branch). The server list is asserted identical to the client's.
- **Order: re-level applies the HP floor, THEN the band multiplies.** Same as the
  client (`relevelBuiltinAi` → `Arena.tsx:692`).
- **The easy band does NOT make a player immortal.** The mercy floor prevents
  *sudden* death — a player who started the turn above half HP survives it — and
  lapses once they are worn below half. Do not assert immortality.
- **`api/_ai-profile-catalog.ts` is GENERATED.** After any change to `builtinAis`:
  `node --import tsx scripts/ai-profile-catalog-gen.mjs`. `rules` is not mirrored
  (random UUIDs each import would make the drift test flap).

## Combat-mode load audit (done, 2026-08-02)

Player-side loading is **consistent across every sealed mode** — authoritative
save + `augmentSaveWithForgedDefs` + `loadAdminCombatContent` →
`hydrateCharacterFromSave`, guarded by `api/_fighter-authority.test.ts`. Covers
PvP/MPvP (ranked, spar, bounty), solo PvE (missions, story, weekly, AI fight)
and MPvE (co-op towers, clan boss, Anbu). `towers/join.ts` is a pure read with
no re-seal — correct; a prior tampering hole there is closed.

**Hollow Gate PvE is the one mode not migrated at all** (still client-built).

## Working rules that held

- Gate on the **exit code**, never a quiet log. Pipes mask failures.
- **Check the shell's cwd before trusting a gate.** A `npm run build` left over
  in `shinobij.client/` runs the CLIENT build and never rebuilds
  `dist/server.js`. `certify:release` then boots the STALE `dist/server.js`
  (`release-certification.mjs:96` prefers it and only falls back to `server.ts`
  via tsx when absent), which is how a clean tree produced a phantom 27/28.
- `gh run watch --exit-status` returns 0 on FAILED runs — cross-check
  `gh pr checks` before relying on CI.
- Full local gates before a main push: `npm test`, `npm run build` (chains
  sizecheck — `npm test` misses it), `npm run certify:release`.
- **Re-run every gate after a rebase.**
- Verify, don't infer: a passing count is not proof a specific new test ran —
  grep the log by suite name.
- Mutation-check a new parity test (break the source, confirm it fails, revert).
  Two of my behavioural tests initially passed **vacuously** because the test
  driver skipped the enemy's turn entirely.
- Small, reversible commits; each leaves main releasable.

## Loose ends unrelated to this task

- The live-data scanner (`npm run scan:data`) and its cutovers are moot if the
  pre-launch WIPE happens.
- Capacity: ~500 concurrent comfortably per container, ~700-800 ceiling.
  `npm run soak -- --url=<staging>` before launch.
  `docs/runbooks/launch-capacity.md`.
