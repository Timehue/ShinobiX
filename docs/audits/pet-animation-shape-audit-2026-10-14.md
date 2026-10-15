# Pet animation visual audit — completed October 15, 2026

All 160 pets requested after Oni Hound have been visually inspected, repaired where needed, and checked again. Oni was included in the final verification: **161 of 161 identities have current completed reviews**, covering 160 distinct source assets and their battle models. Stone Turtle and the earth starter share an asset.

The final whole-roster review gate passes with zero failures. No confirmed distortion remains open in the inspected coverage. Changes are local; they have not been deployed.

## Inspect the results

- [Browsable evidence gallery: all 161 pets](../screenshots/pet-shape-2026-10-15/index.html). Search by name or ID, open a pet, and click any sheet for full resolution.
- [Final review receipts](pet-animation-shape-reviews.json): source, battle model, animated atlas, renderer and evidence fingerprints, plus individual findings.
- [Review and repair history](pet-animation-visual-review-progress.json): first inspection, candidate checks, second source/battle inspection, production runtime inspection and final evidence for every pet.

Final evidence is durable under `docs/screenshots/pet-shape-2026-10-15/`: 1,455 referenced images and numeric reports. Temporary capture manifests and original/candidate investigations remain in `shinobij.client/.tmp/`; they are not required to validate the final receipts.

## What changed

| Repair | Completed coverage |
| --- | --- |
| Anatomically reviewed skull bindings beyond Oni | 132 pets: 42 standard, 38 rare, 25 legendary, 14 mythic, 13 starter |
| Starter rig scale normalization | 13 starter models |
| Detached geometry removal | Mountain Behemoth (`legendary-17`), Chimera (`legendary-15`), evolved earth starter (`starter-earth-r`) |
| Skinning seams exposed by repair or simplification | Corrected on affected source and battle models; regenerated and re-inspected |
| Generated assets | Matching battle LODs, animated impostors, manifests and runtime cache revisions updated |

The Oni repair was retained and independently rechecked. Remaining pets were inspected and kept when their existing anatomy and motion were coherent; numeric triage flags alone did not justify modifying them.

Skull repairs make the reviewed facial region follow its chosen skull/neck anchor, with a transition into the surrounding body. Geometry, UVs, textures, bone nodes and animation tracks were conserved for binding-only repairs. The crane and phoenix required separately reviewed beak/neck regions; Chimera required both heads to be inspected independently. Additional close cameras covered small or obscured faces.

The 13 starter rigs had nonuniform scale above animated rotations. A locally rigid skull could still stretch in world space. Normalization preserves the bind geometry, removes that scale and retargets the animation transforms. LINEAR, STEP and CUBICSPLINE handling have focused regression tests. These repairs intentionally change rig transforms and animation values; their conservation checks cover bind shape and retargeting rather than claiming unchanged tracks.

Detached-fragment repairs removed isolated components while conserving retained vertices, attributes and triangles. They removed 1,162 vertices / 1,814 triangles from Mountain Behemoth, 337 vertices / 280 triangles from Chimera, and 20 vertices / 12 triangles from the evolved earth starter. Newly exposed seams were repaired and checked before regeneration. The final earth starter sliver was found during the last runtime inspection, so its source, battle model, atlas and all final evidence were refreshed afterward.

## Visual coverage and double check

Every identity received a first inspection of all 13 raw clips, using head close-ups and full-body views. Confirmed faults were repaired as separate candidates, inspected again, measured and promoted only after their conservation and deformation checks passed.

The second complete inspection used the final source **and** battle assets, front and side head/body views, at six alternate phases: 0, 12.5, 37.5, 62.5, 87.5 and 100%. Special framing covered both Chimera heads and other faces that were too small in the general camera. The 13 clips are:

`idle`, `idle_2`, `walk`, `gallop`, `gallop_jump`, `attack`, `idle_hitreact1`, `death`, `entrance`, `cast`, `guard`, `rest`, `victory`.

Each final model was also exercised through the actual production `PetModel3D` renderer, including its procedural layers and continuous state changes. Both asset versions were inspected in front and side head/body views at six phases through 16 rows:

`idle`, `run`, `dash`, `windup`, `strike`, `recover`, `stagger`, `dodge`, `guard`, `rest`, `cast`, `entrance`, `victory`, `dead`, `revive`, `attack-sequence`.

Dark materials were additionally viewed with brighter inspection sheets when needed. Those images change inspection exposure only; shipping colors are unchanged. Final runtime capture manifests reported no browser errors.

## Final verification

| Check | Result |
| --- | --- |
| Completed first and second visual reviews | 161 / 161 identities |
| Current source and battle numeric evidence | 322 / 322 identity/version pairs |
| Dense skull clip samples | 173,088 poses, zero failed reviewed skulls |
| Cross-clip skull blends | 150,696 states: 468 per identity/version pair, zero failures |
| Full geometry / edge / connected seam checks | 65,422 poses, zero severe geometry edges |
| Hash-bound visual review gate | 161 models; zero missing, stale or changed evidence failures |
| Structure, materials, skin bindings and animation inventory | 161 / 161 pass; no unexpected duplicate anatomy or missing tail bindings |
| Battle LOD manifest / geometry certification | Pass, all 160 distinct assets |
| Animated impostor certification | Pass, all 160 distinct assets |
| Focused deformation, normalization and receipt regressions | 13 tests pass |
| Client production build after final earth cleanup | Pass |
| Full client lint and changed QA tooling lint | Pass |

Numeric checks supplement the visual review. They do not substitute for anatomy checks. The original broad tear/seam audit passed Oni because its thresholds missed facial compression and smaller shears. The original heuristic head scan in `pet-animation-shape-scan-2026-10-14.json` is retained as historical triage, **not current certification**.

## Keeping reviews current

From `shinobij.client`:

```powershell
npm run check:pet-shape-review
npm run check:warfront-pet-lods
npm run check:warfront-pet-impostors
node --test scripts/oni-hound-skull.test.mjs scripts/pet-deformation-probe.test.mjs scripts/normalize-reviewed-pet-rig-scale.test.mjs scripts/check-pet-shape-review.test.mjs
```

CI now requires current receipts for the **entire roster** and runs the focused regressions above. Changing a source model, battle model, animated atlas, tracked production animation renderer or retained evidence invalidates its approval. Missing pets, clips, camera views, transition review or evidence also fail. A changed asset must be recaptured and actually inspected before new approval is recorded.

For new work, `capture-pet-shape-audit.mjs` captures raw clips and `capture-pet-runtime-transitions.mjs` captures the production renderer. Both require a local Vite server; Windows may need `VITE_SKIP_HTTPS=1` and `PLAYWRIGHT_BROWSERS_PATH` pointing at the installed browser. `record-pet-second-visual-pass.mjs` and `record-pet-runtime-visual-pass.mjs` record completed manual inspections; they do not perform inspection. `finalize-pet-shape-reviews.mjs` packages evidence only after both visual passes and current numeric evidence exist. `build-pet-shape-review-gallery.mjs` rebuilds the gallery from completed receipts.

Coverage is bounded: all shipped clips were visually sampled twice, and the final production renderer was sampled through the listed states and transitions. Dense geometric checks include authored keys, midpoints, 24 Hz clip sweeps, terminal poses and selected blends. This does not claim every possible gameplay combination, camera, graphics setting or future asset is flawless. The completed reviews apply to the exact assets and renderer recorded in the receipts.
