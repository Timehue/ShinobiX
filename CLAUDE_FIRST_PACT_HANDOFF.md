# Claude handoff — First Pact connected-city rebuild

## Mission

Continue the in-progress **Celestial Tower: The First Pact** single-player Pet Colosseum mode. The player is transported into the living Sunken Court before its fall. This is a level-100 premier RPG mode, not a refuge or sector screen. It uses one connected top-down tile world, wandering/static NPC AI, and Pet Colosseum battles with two active pets plus two reserves. The side quest helps Sena Vale by winning a three-battle pet tournament.

The current assignment is the visual/world pass: make the ancient dark ninja/shinobi city as spatially seamless and readable as the user's supplied reference while preserving the First Pact story, AI, collision, minimap, and gameplay wiring.

## User's actual visual bar

Inspect this image directly before editing; do not work from a prose description:

`C:\Users\TYLERR~1\AppData\Local\Temp\codex-clipboard-97811abe-4674-4202-ab99-a0695857be32.png`

Reusable 1440×900 crop used for neutral blind reviews:

`C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\output\first-pact-gardens-north\reference-city-crop-1440x900.png`

The bar is about world composition, not copying its bright palette. Its useful qualities are continuous cobble circulation, complete building silhouettes, clear doors and landings, consistent avatar/building scale, ordinary architecture around landmarks, vegetation at edges rather than across routes, and no visible district rectangles.

## Non-negotiable user direction

- Dark ancient ninja/shinobi city, not a generic European town.
- Fully connected 2D top-down tile world; do not fall back to sector transitions.
- Paths and collision must agree. The player/NPCs cannot walk on roofs, walls, water, props, or foundations.
- Every visible public door needs a real walkable route.
- Avatar and NPC markers use the bottom pin/feet convention already established in sectors/combat.
- Generate purpose-built artwork when existing art is not an exact fit.
- Do not solve emptiness with random clutter.
- No floating/cropped buildings, pasted rectangular ground plates, fake coordinate bridges, UI-like route overlays, hard material seams, naked water strips, or giant repetitive tile fields.
- Preserve accepted pieces exactly unless a later whole-city seam proof demonstrates that a seam-only adjustment is required.

## Required builder/critic protocol

For every remaining piece:

1. Inspect the real current capture and the real supplied bar.
2. Use a fresh builder context for the smallest independently judgeable piece.
3. Capture the actual production world at 1440×900 with HUD hidden but real actors retained; also inspect a 360×225 25% version.
4. Run collision, minimap, route, AI, layer, console, TypeScript, lint, focused tests, and isolated build gates.
5. Freeze the exact candidate and hash it.
6. Copy the frozen candidate and reference into neutral `A.png` / `B.png` paths. Alternate which side ours occupies each round. Do not reveal provenance to the critic.
7. Use a separate fresh, harsh critic. No tie. It must choose A or B, state one deciding fact, and identify the single biggest exact-location gap in the loser.
8. If ours loses, send only that gap back to the builder and loop. Do not advance until ours wins blind.
9. Save the critic verdict in `output/first-pact-redesign/`.

Do not accept a piece because a later district might hide it.

## Current progress — 10 of 15 acceptance gates passed

Count completion as **66.7% by gates**, but only roughly **55–65% by remaining effort** because both Colosseum passes and the final multi-district seam gate are large.

Accepted:

1. Kennel Ward — blind winner after iteration 42.
2. High Court render reliability — 20/20 deterministic painted captures.
3. Market & Scriptorium — blind winner after four rounds.
4. Bell Quarter — blind winner.
5. High Court archive campus — blind winner.
6. Guardian Gardens north frontage — accepted as part of Gardens R7.
7. Guardian Gardens south public court — accepted as part of Gardens R7.
8. Aqueduct north secondary crossing — accepted as part of Gardens R7.
9. Aqueduct south valve/Kennel crossing — blind winner.
10. Aqueduct central civic-boulevard crossing — blind winner.

Remaining, in order:

11. Gateworks complete district.
12. Arrival Court threshold plaza.
13. Grand Colosseum arena bowl / north half.
14. Grand Colosseum south gate / civic approach.
15. Whole-city seam closure across multiple districts.

The detailed acceptance queue is:

`C:\Users\Tyler R\source\repos\NinjaK\output\first-pact-redesign\remaining-district-queue.md`

## Next exact task — Gateworks

Use the existing production QA state:

`firstpactpreview.html?state=gateworks&capture=critic`

Expected player/camera area: approximately `(68,46)`.

First capture the current baseline. The known risk is two oversized cyan-heavy buildings plus a loose valve on a repeated service-stone carpet, a cropped right structure, and no credible maintenance circulation.

Acceptance target:

- Engine hall and pump house are complete and share one masonry/roof scale.
- Each has a real stone maintenance aisle reaching its south entrance.
- Cyan is confined to mechanisms/outlet, never a ground field.
- The outlet meets authored water.
- The valve has a foundation.
- No dead service-stone block exceeds 4×4 tiles.
- No visible crop, floating foundation, blocking collision, or hard district plate.

Do not change the accepted central/south Aqueduct bridges while fixing Gateworks.

## Most important source files

- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\screens\FirstPact.tsx`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\screens\FirstPact.css`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\lib\first-pact-world.ts`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\lib\first-pact-world.test.ts`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\lib\first-pact-wiring.test.ts`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\src\firstpactpreview.tsx`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\scripts\capture-first-pact-critic.mjs`
- `C:\Users\Tyler R\source\repos\NinjaK\shinobij.client\scripts\vite.first-pact-qa.config.mjs`

The feature and much of its output are currently untracked. Preserve everything. Do not run `git reset`, `git clean`, or `git add -A`.

## Accepted frozen evidence

### Kennel Ward

- Frozen visual: `shinobij.client/output/first-pact-qa/iteration-42-lodge-backplate-root-1440x900.png`
- Verdict: `output/first-pact-redesign/critic-iteration-42-fresh.md`

### Market

- Frozen: `shinobij.client/output/first-pact-qa/market-gate-43-round4-frozen-1440x900.png`
- SHA-256: `3626669FE7C6A8787EC624F51017852BEF354F44CECFE84727785506EC25B8A2`
- Verdict: `output/first-pact-redesign/critic-market-43-r4.md`

### Bell Quarter

- Frozen: `shinobij.client/output/first-pact-qa/bell-gate-44-final-1440x900.png`
- SHA-256: `3454CF874104AD9BF978E19E8D0B235AF896F225C4FCEDC819DE9AA14EACC3E1`
- Verdict: `output/first-pact-redesign/critic-bell-44-r1.md`

### High Court

- Reliability example: `shinobij.client/output/first-pact-qa/high-court-render-reliability/high-court-reliability-full-campus-01-1440x900.png`
- Reliability SHA-256: `8BDEC92BE97ED7492E57E952F656A08EA8639B9100A46453A3796EA34B502EE1`
- Reliability contact sheet: `shinobij.client/output/first-pact-qa/high-court-render-reliability/high-court-reliability-contact-sheet-1440x720.png`
- Verdicts: `output/first-pact-redesign/critic-high-court-45-r1.md`, `critic-high-court-reliability-fresh.md`

### Guardian Gardens + north Aqueduct seam

- Frozen: `shinobij.client/output/first-pact-qa/gardens-r7-frozen-01-1440x900.png`
- SHA-256: `FB5686C60F241A65D77C60595F7A4C85849C8EED4E69C1EED9D71BDAAF8C37B2`
- Verdict: `output/first-pact-redesign/critic-gardens-aqueduct-46-r7.md`
- Approved Kaio tree source: `shinobij.client/output/first-pact-kaio-court/asset-alternatives/kaio-guardian-tree-root-pocket-r4.png`
- Approved bench source: `shinobij.client/output/first-pact-kaio-court/asset-alternatives/kaio-low-listening-bench-r1.png`
- Production paths: `src/assets/first-pact/gardens-north-v2/garden-court-kaio-tree.png`, `garden-court-listening-bench.png`
- Critical collision truth: listener `(18,17)` is alpha-free/walkable; tree root `(18,18)` blocks; bench feet `(19,17)` and `(21,17)` block; Old Kaio stands `(18,16)`.

### Aqueduct south valve/crossing

- Frozen: `shinobij.client/output/first-pact-qa/aqueduct-g9-frozen-01-1440x900.png`
- SHA-256: `E779751057B04B74D930C3FEA1279094259CDA480296822D102A14A8EB8749EF`
- Verdict: `output/first-pact-redesign/critic-aqueduct-south-47-r1.md`
- Truth: lower channel `x28..30,y27..52`; real deck `x28..30,y43..45`; split collision banks; valve on bank-to-bank cradle.

### Aqueduct central civic crossing

- Exact technical proof: `shinobij.client/output/first-pact-qa/aqueduct-central-frozen-01-1440x900.png`
- Exact SHA-256: `BC767451C82E32D1032855792EB48EE3CD70B095DD696A7E4005789B21ACEEF5`
- Honest west-biased review: `shinobij.client/output/first-pact-qa/aqueduct-central-west-frozen-01-1440x900.png`
- Review SHA-256: `0FF9D5790FDBADD667DC0580FD33164E6ECFF545D3F7F934E5BEE0B70A3D6B81`
- Verdict: `output/first-pact-redesign/critic-aqueduct-civic-48-r1.md`
- Truth: 12 real Bridge cells at `x28..30,y27..30`, Road landings, four Wall-backed abutments, continuous water mouths, 0 px paving-phase drift.

## Current QA states

Useful `state=` values include:

- `full-campus`
- `gardens-north`
- `gardens`
- `bell`
- `market`
- `gateworks`
- `aqueduct`
- `aqueduct-central`
- `aqueduct-central-west`
- `stable`
- `tournament`
- `final`
- epilogue variants

The capture script hides HUD/minimap/actions but retains actual actors:

```powershell
node scripts/capture-first-pact-critic.mjs http://127.0.0.1:5186 gateworks gateworks-baseline
```

Run from:

`C:\Users\Tyler R\source\repos\NinjaK\shinobij.client`

## Validation commands

```powershell
node --import tsx --test src/lib/first-pact-world.test.ts src/lib/first-pact-wiring.test.ts
npx eslint src/screens/FirstPact.tsx src/firstpactpreview.tsx src/lib/first-pact-world.ts src/lib/first-pact-world.test.ts src/lib/first-pact-wiring.test.ts scripts/capture-first-pact-critic.mjs
npx tsc --noEmit --pretty false -p tsconfig.app.json
npm run check:first-pact-exteriors
npm run check:first-pact-bell
npm run check:first-pact-high-court
npm run check:first-pact-gardens-north
npx vite build --config scripts/vite.first-pact-qa.config.mjs
```

Focused First Pact suite currently passes **30/30**. Accepted Gardens and south Aqueduct recaptures were byte-identical after the central bridge work. Keep those regression hashes frozen.

## Live progress view

Editable fragment:

`C:\Users\Tyler R\.codex\visualizations\2026\09\02\01a060eb-285b-70a3-89b7-e8cfb890d89f\first-pact-progress.html`

It currently reports 10/15. If this Codex-only visualization is not useful in Claude, preserve the file and update the equivalent progress in this handoff or a normal repo report.

## Known unrelated blockers / hazards

- `shinobij.client/src/screens/PetArena.tsx` already contains merge markers. Do not treat them as First Pact regressions and do not resolve them unless explicitly asked.
- The repository-root typecheck has unrelated missing Warfront exports. The scoped client/app TypeScript check is green.
- `output/` and the First Pact feature files are largely untracked. Do not delete or bulk-stage generated evidence.
- The QA output folder is large. Use targeted paths and unique capture names.
- Port `5186` has been used by the current local QA server. Check whether it is already listening before starting another strict-port process.
- The capture script may require unsandboxed browser execution in constrained environments.
- A prior `verify-first-pact-visual.mjs` expectation for `highCourtAnnex` was stale versus `highCourtV3`; use the focused current gates or repair the verifier deliberately.

## Definition of done

Do not call this complete until Gateworks, Arrival Court, both Colosseum views, and the whole-city seam closure each beat the supplied reference in fresh blind criticism, all gameplay/world tests stay green, and the accepted frozen districts remain unchanged except for explicitly justified seam-only corrections.
