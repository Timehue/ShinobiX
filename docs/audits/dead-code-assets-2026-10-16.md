# Dead code and unused assets audit (2026-10-16)

## Status

**Tier 1 (1a–1e) was removed on branch `claude/dead-code-assets-audit-3beed0` (PR #419).** A second pass removed the PR #419 leftovers, Tier 2 and the high-confidence part of Tier 4 (see below). The rest of Tier 4 and the owner calls are still open.

**Tier 3, high-confidence part: also removed on the same branch (PR #419).** That is 225 files:
- `docs/screenshots/combat-layout/`, which nothing reads; the combat-layout spec writes to `test-results/`.
- The 77 force-added `docs/**/*.log` files.
- The 37 `docs/audits/legacies-2026-10-02/*.txt` transcripts.

Eleven docs that linked to those files now carry the link text without the link, plus a note on retrieving the files from git history. `docs/screenshots/pet-shape-2026-10-15` stays: a CI gate reads it (see the Tier 3 table).

How the removal differed from the plan below:

- **Pose manifest trap: fixed first.** `PetEvolutionStage3D` now uses `hasPetPose`, the idle-only check. `pet-poses-manifest.ts` has no consumers left and was deleted. `pet-pose-availability.test.ts` now checks against the real idle files on disk. One small difference: breeding mythics `mythic-10..15` now also get the idle fallback in the evolution cinematic. Their idle files exist, and `petPoseImage` already serves them.
- **Kept on purpose:**
  - `pet-duel-lockstep`, `pet-duel-live` and `pet-duel-stage-director`, with their tests. The registry-pinned `pet-duel-transport` (Tier 2) still imports them. This also keeps the replay-parity coverage that `_duel-replay.test.ts` points at.
  - `src/assets/coliseum/tactics-diorama.webp`. It is the source image for the live, generated `pet-arena-walkmask`.
  - `src/assets/Maps/world_map.webp`. The floor-restyle prompts name it as their style reference.
- **Also removed:**
  - Five orphaned `.txt` prompt sidecars.
  - The now-unused `sectorDepthImage` / `sector-depth` chain.
  - The `pet-warfront-mask-baked` step in `scripts/gen-pet-sim.mjs`.
- **Totals:** 1,656 files changed (about 19.7k lines removed), with 1,417 non-idle pet poses (44 MB) and about 90 other images removed.

### Second pass (branch `claude/serene-merkle-1a6315`): PR #419 leftovers, Tier 2, Tier 4 high-confidence

**Leftovers that PR #419 orphaned:**
- `useDocumentVisible` (`lib/use-battle-frameloop.ts`) and its source-pin assertions in `combat-cover-wiring.test.ts`. The test now asserts that the battle frameloop reads no tab visibility at all.
- The `sunscar-queen-body-v1` facing regex in `lib/battlefield-sprite.ts` and its test. The art was deleted in 1e.
- **CSS.** Every class in `21-pet-arena-fx.css` was checked against the client source, `shared/` and the HTML pages, including template-built prefixes. 138 classes had no owner. Their rules are gone from four stylesheets:
  - `21-pet-arena-fx.css` went from 1,779 to 455 lines. Removed: the arena battlefield, HP bars, momentum bar, status badges, prefight card internals, K.O. overlay, cut-ins, obstacles, tiles, VFX tiles, combo/commentary/ticker and `.rec-*`.
  - `22-pet-battle-sprites.css`: `.pet-arena-current-action`, `.pet-victory-screen`, the `.pet-park-*` mobile rules, the `vfx-*`, `pet-pvfx-*` and `damage-number`-family pops, `.move-callout`, `.battle-camera-focus` and `.pet-slot-*`.
  - `24-combat-mobile-restore.css`: the `.pet-vfx-tile-*` overlays, the obstacle blocks and `.tag-grid`.
  - `lite-fx-compositing.css`: `.pet-park-tile`.
  - 81 `@keyframes` that only those rules used were removed with them, about 1,960 CSS lines in all. Design tokens were regenerated.
- **Pose scripts.** `pet-poses-manifest.ts` was deleted in #419, but three writers still regenerated it. Changes:
  - `pet-pose-manifest.mjs`, `slice-all-move-frames.mjs` and `slice-move-frames.mjs` (non-idle move frames) are deleted. So are `gen-all-pet-moveframes.mjs`, `gen-all-pet-runs.mjs` (batch drivers with no prompts) and `gen-warden-frames.mjs` (warden frames, deleted in 1a).
  - `finalize-evo-poses.mjs` was identical to `finalize-pet-poses.mjs` once the manifest was gone, so it is deleted.
  - `finalize-pet-poses.mjs` now publishes **idle poses only**, without a manifest. `pet-pose-writer.test.mjs` certifies that.
  - **Kept:** `slice-pet-poses.mjs` and `gen-all-pet-poses.mjs`, which produce the idle pose. Also kept as prompt records: `gen-pet-moveframes.mjs` and `gen-pet-run.mjs`.

**Tier 2: removed.** The registry rows describe retired modes. Their client paths had no importer since `c14cf951a` and #419.
- `lib/pet-duel-transport.ts`, plus what only it kept alive: `pet-duel-lockstep`, `pet-duel-live` and `pet-duel-stage-director`, with their tests.
  - The engine tests in `pet-duel-live.test.ts` covered the still-live `pet-duel-cinematic` command path, so they moved to `pet-duel-cinematic-commands.test.ts`. That includes the replay-parity check that `api/pet/_duel-replay.test.ts` points at. The parity log is now recorded straight from the sim instead of through the deleted rewind controller.
  - `pet-arena-pvp-1v1/2v2` keep their registry rows, with no client entry and no transport, and say so. The fixture drops `LIVE_PET_DUEL`.
  - The client parity test against `INPUT_DELAY_TICKS` in `api/_realtime/pet-duel-session.test.ts` is gone; the constant was 12 and is recorded in the server comment.
  - `presence-socket.onRealtime` lost its last caller and was removed.
- `lib/dungeon-pet-authority.ts` and its test. In `dungeon-pet-cinematic`, the `/pet/battle-result` route is now `clientCallerRequired: false`. The generated docs label that "no shipped client caller" (the old label was "server-internal").
- `lib/pet-warfront-impostor.ts`, its test and `generated/pet-warfront-impostor-manifest.ts` (11.7k lines). `generate-warfront-pet-impostors.mjs` no longer writes or checks that manifest. The live `pet-warfront-impostor-url` manifest is unchanged.

**Tier 4: high-confidence part removed (71 files).**
- `vn-art-*` / `vn-live-*`, `audit-kage-*` / `capture-kage-*`, and the `sunscar-*-qa` browser scripts.
- The Sunscar Exchange QA harness: `sunscar-exchange-qa.html`, its `.tsx`, server and Vite config.
- `pet-gpu-probe`, `pet-hitch-profile` and `analyze-pet-heap`.
- `migrate-world-geo`, `backfill-battle-history`, `raise-timeout` and `gameplay-loop-audit-2026-09-29.mts`.
- The Vite configs `first-pact-qa`, `vn-art-qa`, `warfront-qa` and `story-presentation-baseline-build`.
- `cardpreview.html`, `vfx-audit.html` and `kage-progress.html` + `.json`.

**Tier 4 files the audit listed that are NOT dead, kept:**
- `backfill-asset-meta.mjs`: `AdminDiagnosticsPanel` tells admins to run it for legacy assets.
- `capture-kage-attack-causality.mjs`: `pet-warfront-rite-presentation.test.ts` reads it.
- `vn-art-fixtures.mjs`: three `vn-*-qa` scripts import it.
- `vite.pet-tactics-qa.config.mjs`: `scripts/pet-tactics-qa-server.mts` uses it.
- The Sunscar **modes** QA harness (`sunscar-modes-qa.html`/`.tsx`, `sunscar-modes-qa-server.mts` and its Vite config). The pet performance QA scripts and `RallyCanvas`'s QA mode use it.
- `src/cardpreview.tsx`: the `art:chronicle:review` npm script bundles it.

**Retired server socket (same PR, second commit).** Removed:
- `api/_realtime/pet-duel-socket.ts` and `pet-duel-session.ts`, with their four test files.
- The socket's wiring in `socket.ts` and `game-loop.ts` (the duel sweep and its drop/expire callbacks).
- The `pet-duel` evidence source in the heartbeat's `battle-authority.ts`.
- `replayLockstepPetDuel` in `api/pet/_duel-replay.ts`, with `_duel-replay-lockstep.test.ts`.

Socket challenge admission was already closed, and the sessions lived only in memory, so no player record or stored state is affected. The inventory test now asserts that the socket stays deleted. The stale `pet-duel-live`/`pet-duel-lockstep` comments in `pet-duel-cinematic.ts` were fixed, and the `api/_pet-sim` mirror was regenerated (comment-only diff).

**Still open:**
- **Unused exports.** `pet-duel-doctrine` (client and mirror) now has no runtime caller; `gen-pet-sim` describes it as also meant for sector-war garrisons, so it needs an owner call. The engine exports `setCinematicClashEnabled`, `readClashPrompt` and `CLASH_WINDOW_TICKS` lost their last callers with the lockstep client and the old renderer.
- The rest of Tier 4: the unrun Playwright configs and the M-rated QA pages.
- The owner calls below.

The audit as written before the removal follows.

---

This audit was read-only when written.

## How it was done

- **Code.** An import graph was built over all 5,223 tracked source files. It resolves `import`/`export from`, `import()`, `require`, `new URL(..., import.meta.url)`, `import.meta.glob`, `<script src>` and CSS `@import`/`url()`. Entries were the production entry points (`server.ts`, `server-api-routes.ts`, `index.html` → `src/main.tsx`, every client `*.html`, vite configs and `public/sw.js`), plus tests and tooling as a second tier.
- **Assets.** Every tracked image, model, audio and font file was checked for its basename, stem or public path appearing in the code, tooling or docs text.
- **Verification.** Each flagged group was then checked by hand against the dynamic loaders, because most game art is addressed by id (`/pet-poses/${id}-idle.webp`, `/items/step-${id}-v1.webp` and so on). The raw scan over-reports a lot: for example, the 404 "docs-only" chronicle cards are all live `-512` srcset siblings.

Confidence levels: **H** = verified by hand, no runtime path. **M** = no runtime path found, but tooling or an owner decision is involved.

Deleting a file from HEAD does **not** shrink clones. The object store is about 15 GB, so that needs a history rewrite or a move to LFS. It *does* shrink the deploy artifact for anything under `public/`.

---

## Tier 1: safe removals that also ship in `dist` today

### 1a. Retired pet-coliseum battle renderer (H)
`scripts/pet-battle-retirement.test.mjs` already guards that no HTML entry can reach these files. It only asserts that they are unreachable, so deleting them keeps it green.

**Components:**
- `src/petvfx-legacy.tsx`, `PetColiseum.tsx`, `PetDuelLiveHost.tsx`, `PetModelQa.tsx`, `PetArenaBattlefield.tsx`, `JutsuSpriteFx.tsx`
- `PetArena3DStage`, `PetDuelClashPrompt`, `PetDuelCommandDeck`, `PetOrbitControls`, `PetRenderStatsProbe`
- All 15 files under `components/pet-coliseum/*`

**Libs** (`src/lib/`):
- `jutsu-vfx` (the client copy only; `api/combat-core/jutsu-vfx.ts` is live), `owned-timeouts`, `use-owned-timeouts`, `pet-arena-3d`, `pet-battle-camera`, `pet-coliseum-weather`
- `pet-duel-broadcast`, `pet-duel-camera`, `pet-duel-live`, `pet-duel-live-roster`, `pet-duel-lockstep`, `pet-duel-stage-director`, `pet-duel-visual-layers`, `pet-vfx-particles`, `use-pet-battle-sfx`

**Assets:**
- **1,417 non-idle pet poses, 44 MB.** These are `public/pet-poses/*-{attack,hurt,cast,windup,lunge,impact,recover,run-a,run-b}.webp`, **except** the five reviewed card images: `standard-3-windup`, `standard-30-recover`, `standard-40-recover`, `rare-2-recover` and `rare-40-run-a` (`pet-battle-anim.ts:79-85`). The only loader for the rest is `pet-coliseum/sprite-resources.ts:170`. The live game loads only `*-idle.webp` (`pet-battle-anim.ts:132`, `PetEvolutionStage3D.tsx:74`).
- `src/assets/coliseum/{warden-*,shrine-*,tactics-diorama,demo-stormcrow,battlemap,boss-warden,prop-*,arena-mode-warfront,tactical-arena-hero}.webp`.

**CSS rules:** `.jutsu-sprite*` in `21-pet-arena-fx.css:876-898`.

**What has to change with the deletion:**
- **Trap: the pose manifest.** `POSED_PET_IDS` in `src/assets/coliseum/pet-poses-manifest.ts` is regenerated from disk by `scripts/pet-pose-manifest.mjs`, which requires that idle, attack, hurt and cast all exist. After the poses are deleted, a regeneration empties the set. `PetEvolutionStage3D.posedId` (`:77-80`) then silently loses its idle fallback, and `pet-pose-availability.test.ts` still passes because it loops over an empty set. Before deleting the poses, switch `PetEvolutionStage3D` to `hasPetPose` (or require only idle in the writer).
- **Tests to delete:**
  - `PetDuelClashPrompt.test.ts`, `pet-coliseum/duel-resources.test.ts`, `PetDuelLiveHost.{liveness,roster}-contract.test.ts`
  - `lib/{jutsu-vfx,owned-timeouts,pet-arena-3d,pet-battle-camera,pet-coliseum-weather,pet-duel-broadcast,pet-duel-camera,pet-duel-live,pet-duel-live-roster,pet-duel-lockstep,pet-duel-stage-director,pet-duel-visual-layers,pet-vfx-particles}.test.ts`
  - `PetColiseum.accessibility.test.ts`
- **Tests that pin paths and need editing:**
  - `RendererRetirement.wiring.test.ts:21,44`
  - `lib/combat-cover-wiring.test.ts:44,59-64`
  - `adaptive-layout-contract.test.ts:182-185`
  - `api/_realtime/pet-duel-session.test.ts:24-28`, which reads `INPUT_DELAY_TICKS` from `pet-duel-lockstep.ts` via `readFileSync`
- **Coverage to port:** `api/pet/_duel-replay.test.ts:4-5` says its client replay-parity check lives in `pet-duel-live.test.ts`. Port that check before deleting the test, because `_duel-replay.ts` is live.
- **Generator:** `scripts/gen-pet-sim.mjs:107-113,167` still emits `pet-warfront-mask-baked.ts`, which is dead in both `src/lib` and `api/_pet-sim`.

### 1b. Old sector scene layers (H)
- **3D scenes:** `SectorScene3D(+Scene).tsx` and `SceneAmbience3D(+Scene).tsx`. Every remaining mention is a comment or a test.
- **Foreground:** `SectorForeground.tsx`, `data/sector-foreground-manifest.ts`, `shinobij.client/scripts/gen-sector-foreground.mjs` and `public/sector-foreground/*`.
- **Scatter props:** `SectorScatter.tsx`, `data/sector-props-manifest.ts`, `shinobij.client/scripts/gen-sector-props.mjs` and `public/sector-props/**`.
- **Gate glimpses:** `SectorGateGlimpses.tsx` with `lib/sector-gate-glimpse.ts` and its test.
- **Floor pan:** `SectorFloorPan.tsx`. Keep the `floor-pan` CSS, which `SectorMap` still uses.
- **CSS:**
  - `.scene-ambience-3d`, `.sector-foreground` and `.sector-scatter` in `28-desktop-scaling.css`
  - `.sector-scene-3d` in `11-sector-explore-village-themes.css:798-813`
  - gate-glimpse rules in `02-world-map.css:629-643`
- **Live but dead:** `WorldMap.tsx:4467` passes `sceneDepthImage`, which `WorldSectorCanvas.tsx:49` never reads. That strands `sectorDepthImage`, `data/sector-depth-manifest.ts`, `public/sector-depth/*` and `gen-sector-depth.mjs`.

### 1c. Small dead modules that exist only for their own test (H)
**Delete with the test:**
- `api/_pet-showdown/replay.ts`, `api/bank/_wallet-transfer.ts`, `shared/tower-encounter-log.ts`
- `features/hollowGate/encounter.ts`, `lib/admin-dojo-circuit.ts`, `lib/pve-ground-zones.ts`

**Needs a small edit too:**
- `lib/daily-briefing-core.ts`: drop its pin at `scripts/narrative-voice-coverage.test.mjs:45`.
- `features/arena/components/ArenaTournamentPanel.tsx`: superseded by `ArenaDistrictLobby`. Edit `Arena.size.test.ts:8,14`.
- `api/combat-adapters/pvpAdapter.ts`: drop the case at `_move-handler.test.ts:1146-1154`.
- Re-export shims `lib/hollow-gate-combat-director.ts` and `lib/underground-room-furnishings.ts`: retarget their tests to `shared/`.

### 1d. Unreachable public art that ships today, 21 files / 1.5 MB (H)
- `public/underground/cavern-{bones,roots,sarcophagus}-v1.webp`, plus 12 `fortress-*-v1.webp`. Caves only emit `broken-pillar`, `lantern` and `stalagmites`, and fortresses use `fortress-room-*-v3`. Keep `fortress-supplies` and `cavern-{arch,crystals,offering}`.
- `public/sector-map/world-terrain/snow-cliffs.webp`.
- `public/world-boss/hollow-gate-bull-map-sprite-v1.webp`, superseded by `-walk-v1`.
- `public/items/item-warforged-relic-v1.webp`, a byte-identical copy of `-v2`.
- `public/chronicle/packs/{elite,legendary,standard}.webp`. `packArtUrl` maps to the `*-cardgame` and `random` files instead.

### 1e. Never-imported `src/assets`, ~11.4 MB of repo weight, not bundled (H)
- `card-clash/loc/*` (17 files), except `hollow-gate` and `hidden-dojo`.
- `towers/{spire,hazards/geyser,objects/*,obstacles/*,pylons/*}`.
- Warfront art from before the rebuild: `warfront/foliage-atlas.png` (3.8 MB), `ground-painted.jpg`, `floor-stone.jpg` and `warfront-rite/warfront-rite-floor.webp`.
- `festival/{fest-broker,sunscar-journey-atlas-v1,sunscar-queen-v1,sunscar-queen-body-v1}`.
- `fx/projectiles/*.webp`, superseded by `projectiles-v2`.
- `shinobi-banner.webp`, `Maps/world_map.webp` (`world_map-v2` is the one used), `clan-exchange/territoryControlScroll.webp`, `ladder/tactical-hero.webp` and `village-icons/jutsu-training.webp`.
- `first-pact/{high-court-annex,kennel-house}-standalone-v2.png` (3.3 MB).

---

## Tier 2: dead, but pinned by the runtime-mode registry (M)

- **`lib/pet-duel-transport.ts`:** named in `shared/runtime-mode-registry.ts:799-809` and `combat-runtime-inventory.fixture.mjs:44`.
- **`lib/dungeon-pet-authority.ts`:** at `runtime-mode-registry.ts:873`. It is the listed client caller of `/api/pet/battle-result`.
- **`lib/pet-warfront-impostor.ts` + `generated/pet-warfront-impostor-manifest.ts` (11.7k lines):** the runtime uses `pet-warfront-impostor-url.ts`.

Removing any of these means a registry edit, a fixture edit and a docs regeneration (`check:runtime-mode-docs`).

## Tier 3: repo weight in `docs/` and `art-source/` (none of it ships; `.dockerignore`)

| MB | Path | Notes |
|---|---|---|
| 626 | `docs/screenshots/pet-shape-2026-10-15` (1,458 files) | **KEEP.** The CI gate `check:pet-shape-review` (`ci.yml:331`) hashes every evidence file named in `docs/audits/pet-animation-shape-reviews.json`. The earlier "nothing reads it" was wrong. Shrinking it means LFS, not deletion. |
| 381 | `art-source/pet-portrait-refresh/masters` | Source PNGs for `pet-portrait-production.mjs`. Better moved to LFS/external than deleted. |
| 98 | `art-source/raijin-hound` | Candidate GLB plus `.blend` files. **M** |
| 61 | `docs/audits/ux-journey-2026-09-13` | Spec output. **M** |
| 58 | `docs/screenshots/combat-layout` | Nothing references it. **H** |
| 37 | `docs/story-presentation-evidence/after` | Regenerated by a spec. **M** |
| 22 | `docs/visual-concepts` (+ `render-world-boss-roster-preview.cjs`) | **M** |
| 16 | 77 force-added `*.log` files (`docs/stronghold/underground-review`, `docs/mission-encounter-evidence`) | `*.log` is already gitignored. **H** |
| 8 | `docs/audits/legacies-2026-10-02` transcripts | **H** |
| 36 | `src/assets/first-pact/**/*-source.png` and the sunken-court atlases | Authoring masters for `process-first-pact-*`. Owner call. |

Visual baselines in `e2e-visual/__snapshots__` are used. Keep them.

## Tier 4: stale tooling (M)

- **About 227 scripts with no npm script, workflow or doc mention.** Groups that can go:
  - `vn-art-*` / `vn-live-*` (09-17/18)
  - `audit-kage-*` / `capture-kage-*` (09-04)
  - about 30 `sunscar-*-qa`
  - pet perf probes (`pet-gpu-probe`, `pet-hitch-profile`, `analyze-pet-heap`)
  - applied one-off KV migrations (`migrate-world-geo`, `backfill-battle-history`, `backfill-asset-meta`, `raise-timeout`)
  - `gameplay-loop-audit-2026-09-29.mts`
- **Scripts to keep:** the balance sims and benchmarks, and the active pet-mesh and sector-world pipelines. About 70 one-off art generators are the only record of their prompts; archive them rather than delete.
- **Vite QA configs with no consumer:** `vite.{first-pact-qa,pet-tactics-qa,sunscar-exchange-qa,sunscar-modes-qa,vn-art-qa,warfront-qa,story-presentation-baseline-build}`.
- **Unused QA pages:** `cardpreview.html` + `src/cardpreview.tsx`, `vfx-audit.html`, `kage-progress.html` + `kage-progress.json`. These are **H**. `hgpreview`, `towerfx`, `towerlobby` and `iconsheet` are **M**.
- **Unrun Playwright configs.** No npm script or CI job runs these 18 configs: adaptive-dpr, bloodline-ritual, clan-integrity, gamepad, landing-audit, map-ui-local, navigation, new-player, pet-mentor, player-friction, portrait-bounds, professions, refined-pages, resource-recovery, tournaments-live, warfront-focused, wild-binding.capture, world-map. Check spec by spec before removing.

## Owner calls (not dead code; don't remove without a decision)

- **`api/_utils.ts:205-207` CORS allows `theravensark.com`** "for the cPanel backend tier". That host now only redirects. Removing it changes CORS (security), and `server.ts` must stay in sync.
- ~~**`api/pet/_active-battle-lease.ts`:** used only by a test, but its header describes a race guard that no production write calls. This may be **missing wiring**, not dead code.~~ **Resolved (branch `claude/hungry-curran-eb8a85`):** the module was removed. The remaining consumable race is closed by a narrow guard in `sanctuary-transfer`.
- **`lib/save-conflict-restore.ts`:** deliberately retained, per `save-conflict.test.ts:454-459`.
- **Stale cPanel/Passenger comments** in `server.ts`, `app.js`, `scripts/verify-dist.mjs`, `api/_storage.ts:340`, `api/_force-ipv4.ts` and `.env.example`. `tsconfig.cpanel.json`, `cpanel-dns.cjs` and `_vercel.d.ts` are load-bearing; rename them at most.
- **218 `.txt`/`.md` prompt sidecars under `public/`** ship to `dist` (about 101 KB). They could be added to the runtime-assets filter.

## Checked and clean

- **npm dependencies:** none unused in either `package.json`. Client `cors` and `openai` are used only by the local `shinobij.client/server.ts` dev tool.
- **Other pet asset folders:** `pet-portraits`, `pet-evos`, `pet-rally` and the tracked `pet-models` have no dead files.
- **Duplicates:** 34 groups, 0.54 MB redundant. Most are pinned by hash or release checks.
