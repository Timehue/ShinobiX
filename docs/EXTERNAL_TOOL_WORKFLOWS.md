# External asset and prototype workflows

These tools are optional production inputs or design aids. None is a runtime dependency, deployment target, or authority in this repository.

## Rive

No approved `.riv` asset exists, so no package or placeholder pilot is justified. A future candidate should target a bounded, non-authoritative UI moment such as a rank-up/achievement flourish—not combat timing, controls, rewards, or navigation.

The asset brief must name state-machine inputs (for example `idle`, `activate`, `success`, `dismiss`), events, dimensions, transparent/background behavior, and a deterministic initial state. The React wrapper must lazy-load both runtime and asset only when the target surface opens. Record raw/gzip bundle delta and asset bytes against the existing size gate.

`prefers-reduced-motion` must select a static poster or the final state without autoplay. Loading failure, unsupported browser behavior, or disabled motion must render an owned SVG/WebP/CSS fallback with the same accessible label and controls. Test Chromium/Firefox/WebKit plus mobile viewports, keyboard/screen-reader semantics, resize, suspended tab, offline/cache failure, and stale deployment chunks. Before commit, record asset author, license, source project, export version, and redistribution rights. The owner must approve the real `.riv` and surface first.

## Meshy and GLB intake

Do not connect production or CI to Meshy and do not upload proprietary assets automatically. If an owner chooses Meshy manually, download the resulting GLB and preserve its provenance/license outside runtime code; the repository begins at local intake.

The existing `qa:pet-models` pipeline already parses GLB v2 structure and accessors; validates triangle/vertex/component budgets, finite positions, bounds/aspect, normals/UVs, one-material texture binding, embedded texture payload, skeleton/bones/weights, approved animation names/data/durations, roster/form counts, and file bytes; then writes `.tmp/pet-model-certification/structural-audit.json`. `qa:pet-models:contacts` produces angle/motion contact sheets, while pet 3D tests and browser surfaces cover mapping/render behavior. This is stronger and safer than a production Meshy API integration, so no code change is needed.

Local intake sequence:

```powershell
cd shinobij.client
npm run qa:pet-models
npm run qa:pet-models:contacts
```

Review the JSON and contact sheets, then run the existing pet-model tests and browser QA. A failed invariant blocks the asset; do not weaken budgets just to accept a generated model. Missing external textures must be embedded or rejected before shipping.

## v0

v0 is an external prototyping canvas only. Do not add a v0 package, generated application framework, Vercel deployment/configuration, alternate auth, database, API route, or styling system to ShinobiX.

Give v0 a narrow surface brief plus the exported ShinobiX tokens, viewport behavior, component states, and synthetic data. Keep the output in an isolated scratch repository or untracked directory. Review the interaction and visual ideas, then manually reimplement accepted pieces with existing React components, semantic CSS tokens, lazy screen boundaries, keyboard/focus/axe requirements, and Railway/Express APIs.

Generated clients never compute trusted rewards, purchases, progression, combat outcomes, or currency values. They must use the existing authenticated server endpoints and error/idempotency contracts. Do not paste player saves, names, tokens, chat, reports, prompts, proprietary narrative, or production data into the external tool. Any adapted result must pass lint, unit tests, Playwright viewports/accessibility, release certification, and bundle-size gates like hand-written code.
