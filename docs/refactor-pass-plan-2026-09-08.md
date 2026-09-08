# Refactor pass plan — 2026-09-08

Goal: make the main application and pet presentation code easier to change and test while preserving gameplay, player saves, API behavior, and visual output. Use incremental extractions with compatible entry points.

This records the initial planning assessment. A bounded first pass was subsequently implemented from clean main in an isolated worktree. See [the implementation report](refactor-pass-report-2026-09-08.md) for its scope and measurements, and [the integration report](refactor-integration-report-2026-09-08.md) for the subsequent conflict resolution, Tower layout repair, and integrated validation. The phases below remain a roadmap, not a claim that every extraction was completed.

**Current evidence**

Inspected local `main` at `eda936ed1`. The checkout has **35 unmerged files**, plus staged and untracked work. Conflicts include App, WorldMap, FirstPact, save ownership, pet presentation, story generation, and build-size checks. Establish the intended combined baseline before starting extractions; selecting one conflict side wholesale could discard unrelated work.

Sizes below are physical lines in the current working files, including conflict content where present. Recount after resolution. Size identifies review candidates; mixed responsibilities determine the actual extraction boundaries.

| Candidate | Current lines | Observed reason to consider it |
|---|---:|---|
| `shinobij.client/src/components/PetColiseum.tsx` | 10,432 | Multiple presentation entry points, cameras, actors, playback directors, geometry caches, VFX, and controls in one module. |
| `shinobij.client/src/App.tsx` | 7,150 | Boot restoration, save coordination, shared-state polling, presence integration, and screen composition remain together. |
| `shinobij.client/src/screens/AdminPanel.tsx` | 6,706 | Large secondary candidate; inventory its editor responsibilities before choosing a split. |
| `shinobij.client/src/screens/FirstPact.tsx` | 6,614 | Large onboarding surface with active conflicts; stabilize narrative work before extracting it. |
| `shinobij.client/src/screens/WorldMap.tsx` | 5,408 | Large map surface with active conflicts and recent request-lifecycle improvements to preserve. |
| `shinobij.client/src/components/PetShowdownBattle.tsx` | 4,203 | Adjacent pet presentation candidate; keep its runtime-specific controls separate. |
| `api/save/[name].ts` | 3,643 | Public/combat projections, sanitization, version handling, identity checks, and HTTP dispatch share one endpoint module. |
| `server.ts` | 1,911 | Route wiring, middleware, health probes, lifecycle, and static serving share the entry point. Lower priority. |

The repository already has useful boundaries: `use-capability-guarded-autosave`, `save-persistence`, `save-flight`, `use-presence-socket`, `use-pvp-session-controller`, story-delivery helpers, save ownership manifests, and combat runtime contracts. Extend these instead of introducing competing implementations.

**1. Establish a trustworthy baseline — prerequisite**

- Resolve the existing integration separately, preserving the intended story, performance, ownership, and pet changes. Record the resulting commit and any known failures.
- Regenerate story artifacts from their source after resolving the generator and source conflicts. Verify them with `npm run check:story-content`; do not settle generated-output conflicts independently of their source.
- Run root tests, client lint, the production build with size checks, and the current browser gates. Record representative desktop/mobile screenshots for any presentation surface selected for extraction.
- Record module sizes, initial bundle size, existing lint warnings, and the relevant test inventory. Keep existing budgets intact.

Exit: no unmerged entries or conflict markers in tracked source, reproducible checks, and an explicit baseline for each planned extraction. Unrelated failures must be identified before they can obscure refactor regressions.

**2. Split PetColiseum presentation — first implementation priority, two PRs**

This is the clearest initial target: a very large presentation module with identifiable internal boundaries and no need to redesign combat authority.

- PR 1: extract scene resources and leaf renderers: materials/textures/geometry caches, actors and standees, camera helpers, and self-contained effects. Use a focused folder such as `src/components/pet-coliseum/`. Preserve cache ownership, disposal behavior, coordinate conventions, and CSS loading order.
- PR 2: separate the existing presentation variants and their playback/control code. Retain the current exported components, prop types, and callback contracts at `PetColiseum.tsx` as compatibility entry points. Build on existing scene and stage-director helpers.
- Keep playback clock updates, frame ordering, command acknowledgments, reconnect handling, and terminal callbacks equivalent. Inspect module-level mutable state before moving it; changing its lifetime or instancing is a separate behavior change.
- Keep Three.js and VFX imports behind their existing loading boundaries. A smaller source file alone does not demonstrate a smaller startup bundle.

Validation: existing scene/weather, cinematic, director, and settlement coverage; focused browser cases for entry, command input, replay/resume, KO, settlement retry, and exit/re-entry; before/after visual comparison for the affected variants and quality levels. Run the full frontend gates described below.

Exit: scene resources, playback, and presentation variants have clear owners; public imports remain compatible; no new duplicate effect implementations, visual regressions, or initial-bundle growth. Check repeated mount/unmount behavior for timers, listeners, and render resources.

**3. Continue draining App through bounded controllers — next priority, two PRs**

- PR 3: inventory the boot restore effect and extract snapshot application and restore decisions into testable functions, then extract orchestration only where its dependencies are explicit. Preserve account/session epoch checks, battle resume decisions, watchdog behavior, and retired-snapshot handling.
- PR 4: extract remaining save coordination around the existing persistence, flight, and autosave modules. Keep one authoritative save version, one active write coordination mechanism, and explicit dirty/flush ownership. Preserve stale-response rejection, immediate-save/debounce interaction, unload handling, and account switching.
- Keep screen composition in App during this pass. Give controllers bounded typed inputs and outputs; avoid a replacement hook that merely accepts every App state setter.
- New lower-level modules must obey `no-app-value-imports.test.ts`. Preserve compatibility exports where required, but do not create new value dependencies back into App.
- Lower `App.size.test.ts`'s budget after each verified reduction. Review import direction and state ownership as well as line count.

Validation: existing boot-watchdog, save-flight, save-persistence, save-version, save-unload, save-conflict/restore, and App architecture tests. Add focused behavioral coverage only where an extracted boundary lacks protection: delayed response after account switch, edit during an in-flight save, immediate flush followed by debounce, refresh during an unresolved battle, and failed-save retry. Use fresh and existing account browser fixtures.

Exit: App delegates boot and save lifecycles through explicit interfaces; refresh, switching accounts, and persistence remain equivalent; no additional polling or save requests are introduced.

**Recommended first-pass stopping point: phases 1–3.** These provide four bounded implementation PRs after baseline recovery. Reassess the remaining backlog once those boundaries and checks are stable; a full rewrite of every large file is not a completion criterion.

**4. Extract save projections and sanitization — separate follow-up**

Start with pure `buildPublicSaveDTO` and `combatProjection` extraction. Then split `sanitizeCharacterSave` into ordered domain stages only after its data dependencies are documented. Keep exports at `[name].ts` compatible with existing callers and tests.

The canonical ownership manifest remains `api/save/_state-ownership.ts`. Preserve stored-copy precedence, null/default behavior, forged-item preservation, derived fields, public projection ordering, and version semantics. Initially retain HTTP authorization, lock acquisition, deletion fences, and write sequencing in the endpoint.

Validation: ownership golden masters must pass **without regenerating expected snapshots**, plus ownership parity/ratchet, public DTO, forged-item, versioned-write, foreign-read, admin-owner, and settlement contracts. Explain the concrete risk before any later change touching auth/admin enforcement. Schema, storage layout, and ownership-policy changes are outside this refactor.

**5. Decompose one feature screen at a time — later backlog**

- WorldMap: inspect interaction state, map rendering, travel presentation, and overlays; reuse existing map/travel hooks. Preserve cancellable requests, server-owned position, battle entry, and the current size gate.
- FirstPact: extract discrete onboarding steps and presentation panels after narrative conflicts settle. Preserve story keys, choices, progression gates, and load authority; use fresh-account and refresh/resume fixtures.
- AdminPanel: extract one editor family at a time after inventorying its data and publish dependencies. Preserve draft state, stale-response handling, validation, and publication behavior.
- PetShowdownBattle and Warfront: apply lessons from PetColiseum only where presentation contracts actually match. Preserve each runtime's admission, commands, and settlement boundaries.

Choose the next screen by expected change frequency and regression coverage, not file size alone. Do not combine its extraction with new features, rewritten copy, styling changes, or combat tuning.

**6. Infrastructure and cleanup — only where supported by evidence**

Consider splitting server route registration and health/lifecycle code after inspecting `server-routes.test.ts`. Preserve explicit registration, middleware ordering, bare and `/api` paths, CORS, Railway startup, and shutdown behavior. Update source-inspecting tests to follow the extracted registration while retaining their route-coverage assertions.

The similar client/server cinematic simulation files are intentional: `scripts/gen-pet-sim.mjs` generates the server mirror. Edit canonical sources and regenerate when needed; preserve generated-file and deterministic parity tests. Consolidating their build systems is separate work.

Require usage and compatibility evidence before deleting legacy code. Keep global CSS reordering, storage migrations, scaling changes, dependency upgrades, and combat-engine unification outside this pass.

**Validation and delivery contract**

Each PR should contain one responsibility extraction, necessary compatibility wiring, and relevant tests. Keep bug fixes separate so behavioral differences are reviewable. Do not weaken assertions or increase line/bundle budgets to accommodate a refactor.

After dependencies are installed, the root verification commands are:

```powershell
npm run test:ci
npm run lint --prefix shinobij.client
npm run build
npm run check:runtime-mode-docs
```

`test:ci` invokes the same root runner as `npm test`, while avoiding `npm test`'s client reinstall prehook. The root build verifies story generation, server/client compilation, distribution integrity, and build-size limits.

For screen/component work, build first, then run the browser gates:

```powershell
npm run test:e2e --prefix shinobij.client
$env:COMBAT_LAYOUT_CAPTURE_PHASE = 'after'
$env:COMBAT_LAYOUT_STRICT = '1'
npm run test:e2e:combat-layout --prefix shinobij.client
npm run test:e2e:warfront --prefix shinobij.client
npm run test:e2e:live --prefix shinobij.client -- village-stores-express.spec.ts --project=chromium-desktop-live
```

Use `.github/workflows/ci.yml` as the current gate inventory. It includes Warfront and the Village Stores live spec; older prose saying Warfront is outside CI is stale. Check browser installation and preview-harness prerequisites before execution. Re-run focused failures based on their assertions, and report any remaining failure rather than treating it as a pass.

For touched routes/server wiring, also run `npm run check:deployment` and `npm run check:rollback-readiness`. Confirm `git diff --check` and inspect generated changes before delivery. Railway builds from source; do not commit `dist/`.

Report the responsibility moved, compatibility retained, exact checks and results, size changes, and any remaining limitations. Keep each extraction independently revertible and require no data migration. Completion means preserved observable behavior with clearer ownership and verified boundaries, rather than a predetermined line-count reduction.
