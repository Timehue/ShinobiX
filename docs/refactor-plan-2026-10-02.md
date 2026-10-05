# Refactor plan — 2026-10-02

**Verdict: a refactor is worth doing, but a targeted one.** The
[2026-09-08 pass](refactor-pass-plan-2026-09-08.md) finished the ownership work
it set out to do. It is verified in the
[completion audit](refactor-roadmap-completion-audit.md). Three things remain:

- duplicated code that keeps drifting;
- a dormant storage path;
- the four files that both are the largest and change the most.

None of this calls for a rewrite. Every item below is either a verbatim move or
an extraction behind a compatibility re-export. Each one is a single PR. Items
that change behavior are kept separate and need an owner decision first.

Survey baseline: `main` at `3abfe2422`. Line numbers below are from that
commit, so re-locate them before editing.

## Why these targets

Churn from 2026-08-15 to 2026-10-02 (commits touching the file) set against
size:

| File | Lines | Commits | Budget |
|---|---:|---:|---|
| `shinobij.client/src/App.tsx` | 6,472 | 155 | 6,475 (**3 lines of headroom**) |
| `shinobij.client/src/screens/WorldMap.tsx` | 5,303 | 86 | 5,318 (it was 5,251 on 09-08 and has grown since) |
| `shinobij.client/src/screens/PvpBattleScreen.tsx` | 2,962 | 47 | none |
| `shinobij.client/src/screens/MissionArenaFight.tsx` | 1,992 | 38 | none |
| `shinobij.client/src/screens/BattleTowerFight.tsx` | 2,688 | 35 | none |
| `api/save/[name].ts` | 1,623 | 41 | none |
| `api/pvp/session.ts` / `api/pvp/move.ts` | 3,337 / 2,817 | 32 / 28 | none |
| `shinobij.client/src/screens/AdminPanel.tsx` | 6,590 | 27 | 6,594 |
| `shinobij.client/src/screens/FirstPact.tsx` | 6,272 | low | none |

The three combat screens pick up the same features one after another. Recent
commits, for example item tooltips across PvP and PvE, edited all three, and
the code they edit is copied between them.

## Ground rules (from CLAUDE.md, restated for this plan)

- Move code verbatim and leave the old export in place as a re-export.
- Put one responsibility in each commit. Lower the line ratchet in the same
  commit as the move that pays for it.
- Make no changes to formulas, AP costs, cooldowns, rewards, RNG order or save
  shape. Pet replays and Tower settlement re-simulate from a seed, so one
  changed byte silently changes outcomes.
- Keep behavior changes in their own PRs, after the move that exposed them.
- **About 71 tests read `App.tsx` by regex, and about 18 server tests read
  source files by path.** Every move has to update the tests that read the old
  location. That is expected work, not a sign the move is wrong.

---

## Phase 1 — Server moves (pure, unit-test gated, no browser suites)

These come first because `npm test` gates them in minutes, and phases 4 and 5
depend on them.

### 1a. Break the two `_auth` import cycles

[`api/_auth.ts:13-15`](../api/_auth.ts) imports `verifyPlayerPassword` from the
`player-auth.ts` **route**, and `getActiveBan` from the `admin/moderation.ts`
**route**. Both routes import `_auth` back. As a result, every authenticated
handler loads two route modules.

- Move `player-auth.ts:54-465` (credential verification and storage) to
  `api/_player-credentials.ts`.
- Move `admin/moderation.ts:95-245` (the ban store) to
  `api/_moderation-store.ts`.
- Keep a re-export at each old location. Point `_auth.ts` at the new modules.

**Risk (auth):** the function bodies do not change. The real risk is the order
of module-load side effects, so diff the bodies and run `player-auth.test.ts`
and `_auth-password-budget`. The fail-closed `hash`/`salt` guard in
`verifyAgainst` moves unchanged and must not become optional chaining.

### 1b. Single source for basic-action constants and grid helpers

- The basic-action costs (Move 30 AP, Attack 40, Heal 60 AP / 10 chakra /
  cooldown 5, Clear and Cleanse 60 AP / cooldown 10) are written in four
  places:
  - inline literals in `api/pvp/move.ts:2100-2175`;
  - constants in `api/solo-pve/_engine.ts:91-98`;
  - constants in `api/towers/_engine.ts:86-105`;
  - a client copy in `MissionArenaFight.tsx`.
- `STUN_AP_PENALTY` is defined twice: in `towers/_engine.ts:92` and in
  `combat-core/formulas.ts:50`. The comment at `towers/_engine.ts:87-89`
  records an earlier drift incident of exactly this kind.
- The `xy`, `posFromXY` and `towerNeighbors` helpers in
  `towers/_engine.ts:170-182` are identical to `combat-core/grid.ts:3-30`.

Export the values from `shared/combat-basic-actions.ts`, which today holds only
`BASIC_CLEAR_RANGE`. Replace the literals with those exports, and add a test
that fails if a literal comes back. All values stay identical.

### 1c. Move PvP rules out of a route file

`api/pvp/move.ts` holds both the combat rules (82-1454) and the HTTP handler
(1456-2817). Solo (`solo-pve/_engine.ts:51-59`), Towers
(`towers/_engine.ts:23-24`) and the balance sim all import that **route** to
get the rules.

Move the rules to `api/pvp/_rules.ts` and re-export them from `move.ts`.
`move.ts:669-674` already follows this pattern. Update
`_combat-formula-parity.test.ts:110`, which matches the old import line as
text.

### 1d. Move library code out of `pvp/session.ts` and `world-state.ts`

`pvp/session.ts` has 26 production importers. Move its types and authority
checks (116-735) to `api/pvp/_session-types.ts`. Move sanitize, loadout and
`hydrateCharacterFromSave` (733-1862) to `api/pvp/_fighter-hydration.ts`. Move
the village-war domain in `world-state.ts:93-1530` to `api/_village-war.ts`.

**Phase 1 gate:** root `npm test` plus `npm run build:server`.

---

## Phase 2 — Combat-screen kit (client; highest churn)

`BattleTowerFight`, `MissionArenaFight` and `PvpBattleScreen` are the only
real combat UIs, since every other fight screen wraps one of them. They already
share `ShinobiCombatShell` and `CombatSideHud`. These blocks are still copied:

| Block | BTF | MAF | PvP |
|---|---|---|---|
| `renderCombatVfx` | 695-736 | 555-593 | 2099-2139 |
| `loadout` builder | 1190-1215 | 896-921 | — |
| Story boss barks effect | 556-606 | 841-891 | — |
| `isMoveJutsu` / `isSelfCastJutsu` | 336, 1557 | 170, 173 | 1635-1639 |
| `armJutsu` / `armWeapon` | 1563-1577 | 1183-1202 | — |
| Barrier / impassable / move / range tile sets | 1238-1292 | 1011-1061 | — |
| Hex helpers | `lib/tower-grid.ts` | — | 170-210, a hard-coded 12×10 copy |

That is roughly 450 removable lines. The copies are **near**-identical, not
byte-identical. For example, `renderCombatVfx` falls back differently when no
target is anchored. The shared version must take that difference as a
parameter rather than pick one behavior.

**Steps:**

1. Make the pure extractions:
   - `components/combat/CombatVfxPlate.tsx`;
   - `lib/combat-loadout.ts`;
   - `lib/use-story-boss-barks.ts`;
   - `lib/use-presentation-timers.ts`;
   - one jutsu classifier module.

   Point PvP's grid helpers at `tower-grid` with width 12.
2. Extract the targeting-set helper, with an explicit ground-occupancy option.
   `MissionArenaFight.tsx:1027-1029` documents that Tower behaves differently
   here on purpose.
3. **Do not** unify settlement. Tower retry, solo `runSettle` and the PvP
   reward claim are different server contracts.
4. Add line budgets for the three screens once they are smaller.

**Gate:**
- `combat-vfx.test.ts`, retargeted to assert the shared plate;
- the shell, layout and lifecycle contracts;
- `COMBAT_LAYOUT_CAPTURE_PHASE=after COMBAT_LAYOUT_STRICT=1 npm run test:e2e:combat-layout`,
  **including `webkit-layout`**;
- `e2e/shinobi-combat-mobile.spec.ts`.

Keep the lite-FX caps (7 and 14 tiles), the 44px touch floor, and VFX keyed on
the sequence number.

---

## Phase 3 — Pet sim: `shared/` instead of a generated mirror

`scripts/gen-pet-sim.mjs` copies 11 client files into `api/_pet-sim/` and
rewrites their imports with regexes. `_parity.test.ts` checks the copies. That
is about 13k mirrored lines, and the generator has broken before.
`shared/chronicle-duel.ts` shows that one file can serve both sides: shared
files use `.js` imports, the server compiles them to `dist/shared/`, and the
test runner already scans `shared/`.

**Correction to the 08-14 unification scope.** `pet-duel-cinematic.ts` is not
legacy. It runs the live Beastbound Warfront modes
(`pet-warfront-rite.ts` → `runPetSquadDuelCinematic`), live PvP and the
dungeon seal. It moves; it is not deleted.

**Blockers.** All four are small, and all four were verified.

1. `lib/pet-coliseum-flag.ts` uses `localStorage` and `window`, and it runs a
   side effect when it loads (`scrubRetiredPetFlagKeys()`, line 222). The sims
   need only `PET_ACCURACY_DEFAULT` and `petAccuracyEnabled`. Move those two to
   `shared/` and have the flag file re-export them.
2. `types/pet.ts` and `lib/pet-roles.ts` import each other. Fix this with a
   `shared/pet-types.ts` holding `JutsuElement`, `PetRole` and `PetSubRole`,
   which also ends the six hand-written copies of the role union.
3. `data/pet-config.ts` imports `constants/game` for five item IDs. Move those
   IDs to `shared/` first.
4. `pet-warfront-sim.ts` imports types from the retired `pet-arena-sim`.

**Steps:**

0. **Golden digests first.** Fingerprint the output of `runPetDuelCinematic`,
   `runPetSquadDuelCinematic`, `runWarfrontRite` and the
   `replayCasualPetDuel` command-log replay across a set of seeds. After the
   move, the client/server parity tests compare a file with itself, so these
   digests become the real guard.
1. Move the files with no dependencies (`pet-arena-walkmask` and
   `pet-warfront-mask-baked`) to `shared/pet-sim/`. Leave `export *` stubs at
   the old paths, and drop the files from the generator.
2. Fix blockers 1–3. Then move `pet-roles`, `pet-config` and `pet-bond-meter`.
3. Move the engines: `pet-duel-sim` (contract part), `pet-duel-cinematic`,
   `pet-duel-doctrine`, `pet-warfront-map` and `pet-warfront-rite`. Then delete
   the generator, `_parity.test.ts` and the five `scripts/*parity*` tests that
   become tautologies.

**Risk:** cinematic and Rite seals carry no engine version. Ladder replays
re-simulate on the client, and Warfront settlement re-runs the Rite on the
server. Moves must therefore be byte-pure, and the digests from step 0 must
match after every step. The Bond meter recompute and command validation stay
on the server.

---

## Phase 4 — Keep draining the monoliths (the existing ratchets)

Each item below is its own commit, and each lowers its file's budget.

| Target | What moves | Approx. lines | Gate |
|---|---|---:|---|
| `App.tsx` PvP host | The IIFE at 6211-6430 becomes `components/PvpBattleHost.tsx`, with the settlement projection in a `lib/` module. **Do this first: App has 3 lines of headroom.** | 200 | pvp reward-claim, bounty and win-report tests; the 6 PvP combat-layout variants |
| `App.tsx` hooks (drain rule: "via hooks, not moves") | `use-duel-challenge-inbox` (2117-2597, 1475-1676), `use-presence-heartbeat` (1905-2116), `use-hollow-gate-controller` (4812-5326) | 1,200 | the heartbeat and hollow-gate wiring tests; Academy persistence live e2e |
| `AdminPanel.tsx` leaf panels | relicDungeons (6208-6515), then hollowGate (5646-6208), then playerManagement (5156-5646). Follow the `AdminProfessionImagesPanel` pattern and keep the role gates in the parent. | 850-1,350 | the admin upload e2e for both roles, desktop and mobile |
| `FirstPact.tsx` renderer | The module-level canvas functions (338-4322) go to `screens/first-pact/world-render/`. Keep the adjacent pairs that `first-pact-wiring.test.ts` slices between, in order. Then add a budget. | 3,985 | first-pact wiring; the visual verify script |
| `WorldMap.tsx` hooks | `useWorldEpicQuests` (2280-2585), then `useWorldRewardRecovery` (3020-3505) | 800 | world-position recovery e2e; travel-lease invariants |
| `PvpBattleScreen.tsx` hooks | `usePvpSessionStream` (574-831), then `usePvpBattleChat` | 350 | PvP combat-layout |
| `vite.config.ts` dev mock backend | Lines 62-1250 go to `dev-server/*.ts`, following the `dev-session-auth.ts` precedent. Use explicit `.ts` import extensions and add the new files to `tsconfig.node.json`. | 1,150 | the production build stays byte-identical |

The App hook extractions carry the most save-race risk in this plan. Keep the
continuation abort fences and the order of `acceptVersionedSnapshot` and
`commitVersionedCharacter` exactly as they are.

---

## Phase 5 — Handler shape (adopt as files are touched; no mass migration)

- **A handler wrapper.** 289 of the 318 route files call `cors()` by hand, 288
  have an OPTIONS early return, and 225 parse the body by hand. On Railway,
  `server.ts:336-366` already sets CORS headers and answers OPTIONS before any
  route runs, and `express.json` already parses the body. Add
  `api/_handler.ts` (`defineHandler({ methods, auth, rateLimit }, fn)`) and a
  shared mock-`res` test harness, since 111 test files each build their own.
  Use the wrapper in new and touched handlers, and update the CLAUDE.md
  convention to match.
- **Phase functions for the longest handlers**, after 1a and 1d:
  - `pvp/session.ts` POST (2056-3335): resume, presence, hydration, guard,
    ranked snapshot, reward stamp and publication.
  - `player-auth.ts`: its 12 inline `action` branches become a `doX` dispatch
    table, as in `village/sector-war.ts`.
  - Then `pet/battle-result.ts`, `missions/claim-mission.ts` and
    `weekly-boss.ts`.
- **`towers/_engine.ts` (3,638 lines).** Split it along its existing section
  comments (boss mechanics, Spire features, AI, companion). Keep it
  deterministic, with `_engine.test.ts` as the pin.

---

## Owner decisions

These are refactors that change behavior or can't be undone. Each one needs a
yes before it starts.

**Answered 2026-10-02:**
1. cPanel is fully shut down, so the overlay can go.
2. Migrate the raw save writers "with no shortcuts".
3. For the Tower weather rule, "do what makes the most sense", which means
   parity with PvP and Solo.
4. Delete the dead pet engines.

The Tower weather divergence is confirmed by
`api/towers/_weather-element.test.ts`. It is latent: only hunts seal weather
onto a Tower battle, and world fights carry no weather today.

**Update 2026-10-04:** no longer latent. World encounters (hunts included),
exploration and raid fights now seal their wild sector's sky at start
(`api/missions/ai-fight-start.ts`, pinned by
`api/missions/_ai-fight-sector-weather.test.ts`), so a hunt's Tower battle
carries real weather. The Tower term already reads `weatherElement ?? element`
like PvP and Solo, which is what `_weather-element.test.ts` drives through that
same hunt path.

1. **Delete the dormant cPanel KV overlay.** That is about 730 lines of
   `api/_storage.ts` (the disk, remote and routed KV factories, migrate/copy,
   and the overlay wiring), plus:
   - `api/kv-proxy.ts`, which is still mounted at `/kv/:op`;
   - the `admin/migrate-kv` and `migrate-to-base` handlers;
   - the `--legacy-overlay` path in `scripts/kv-backup.mjs`;
   - about 350 test lines.

   Keep `saveStoreKind` (`memory-qa` and `base-store`) and the `x-kv-token`
   header that `/restart` uses. **This removes the rollback path to cPanel.**
   Do it only once cPanel is confirmed decommissioned.
2. **Route the remaining raw `kv.set('save:…')` writers through
   `mutatePlayerSave`.** There are about 40 call sites in 20 files, mostly the
   wanderer, rift-quest and admin-legacy writers. The writes then gain
   idle-regen settlement, pet migration and elder-win credit. That is a
   behavior change, so do it one domain per PR, with a test that fails if the
   number of raw writers goes up.
3. **Suspected Tower weather divergence.** `towers/_engine.ts:1513-1516`
   reads only `jutsu.element`. PvP (`move.ts:2279`) and Solo
   (`solo-pve/_engine.ts:882`) read `weatherElement ?? element`, and
   `api/towers/` never mentions `weatherElement`. A bloodline jutsu can
   therefore get a different weather multiplier in a weather-sealed Tower
   mission. Confirm this with a test. Fixing it changes damage, so it is a
   balance ruling.
4. **Delete the dead pet engines.**
   - The `pet-warfront-sim` lane engine: about 1.7k lines on each side.
     Production uses only `WfBuyPolicy`, `WARFRONT_TPS` and some types.
   - The `pet-duel-sim` engine body. This needs the
     `api/pet/battle-start.ts:451-453` named-opponent fallback to fail closed.
     It is unreachable from the current client but still accepted by the
     server.
   - `api/pet-ladder/_arena-sim.ts` (1,155 lines), which has only a type
     import and one test.
   - The dead `runPetDuelCinematic` branch in `Dungeon.tsx:341`.
     `petPlayerControlEnabled()` always returns `true`.

   Doing this before Phase 3 shrinks the move.

## Checked and deliberately not refactored

- **`battle-skin.css`** (7,604 lines; 2,316 `!important`; blocks that must
  stay last) **and `chronicle-duel.css`.** They depend on rule order, the
  layout tests read them directly, and the risk is high for moderate value. If
  they are split one day, use an ordered `@import` manifest with a guard test,
  as `index.css` does. After any CSS edit, run
  `npm run export:tooling-handoffs` last.
- **`api/pet/_catalog.ts`** (9,997 lines): generated data, checked by
  `pet-catalog.test.mjs`.
- **The `pet-warfront-impostor-manifest.ts` generated file** (11.7k lines):
  committing it is reasonable. Optionally, change the generator to emit the
  repeated 16-frame array once, which would cut the file to about 200 lines.
- **`shared/chronicle-duel.ts`:** a separate Card Clash runtime with no overlap
  with shinobi combat.
- **`village/sector-war.ts` / `_sector-war.ts`:** already split into a
  dispatch table and pure rules.
- **Damage math:** already shared through `directDamageBaseFormula` and
  `applyJutsu`. Turn, AP and win ownership per runtime is intentional
  ([combat-runtime-boundaries](architecture/combat-runtime-boundaries.md)).
- **Settlement flows across the combat screens:** different server contracts,
  so the divergence is correct.
- **`app.js`, `cpanel-dns.cjs`, `tsconfig.cpanel.json`:** still used by
  `npm start` and `build:server`.
- **`authFetch`:** it patches `window.fetch` globally, so credentials are
  already consistent. A `lib/api-request.ts` for the repeated
  `res.ok`/`.json().catch`/429 boilerplate (468 raw `fetch(` calls) is a
  reasonable later cleanup. It is not a priority.

## Suggested order and sizing

| # | PR | Risk | Gate time |
|---|---|---|---|
| 1 | 1b, shared combat constants and grid helpers | Low | minutes |
| 2 | 1a, `_auth` cycles | Low–medium (auth) | minutes |
| 3 | 4, App PvP host (pays for App headroom) | Medium | combat-layout PvP |
| 4 | 1c + 1d, server library moves | Low | minutes |
| 5 | 2, combat-screen kit, steps 1–2 | Medium | full combat-layout + webkit |
| 6 | 3, steps 0–1 (digests, then the dependency-free files) | Low | minutes |
| 7 | 3, steps 2–3 | Medium (replays) | digests + Warfront e2e |
| 8+ | The rest of phase 4, one target per PR; phase 5 as handlers are touched | Varies | per row |
