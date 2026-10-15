# Pet animation visual audit — completed October 15, 2026

All 160 pets requested after Oni Hound have been visually inspected, repaired where needed, and checked again. Oni was included in the final verification: **161 of 161 identities have current completed reviews**, covering 160 distinct source assets and their battle models. Stone Turtle and the earth starter share an asset.

The whole-roster receipt gate passes with zero stale or missing evidence failures. The first release reached production at `74163467`, but the owner then demonstrated remaining Oni muzzle and jaw collapse. The earlier visual approval and upper-skull checks missed that defect. Oni was reopened and its evidence replaced after the complete-face correction below; that correction has not yet been confirmed deployed.

## Oni complete-face correction after the production report

The defect reproduced in the exact `PetYardModelStage` companion preview with the released battle LOD. The original repair and its test stopped above most of the muzzle, lips, teeth, tongue and lower jaw. Their old weights still followed the neck, chest and forelegs while the brow followed the head. This rig has no articulated jaw joint: the apparent mouth opening/closing was unwanted skin deformation.

`20261015-oni-full-face-v2` includes the complete face and smooths the measured connected scarf/neck transition. It preserves the sculpt, topology, embedded texture, bone nodes, every animation curve, and all paw/ankle bindings below the protected boundary. Source, battle model, animated atlas and cache revisions are regenerated. Independent fixed muzzle and jaw landmarks now test the anatomy outside the repair's mask. A pinned copy of the actual released v1 asset proves that the former upper-skull check passes while those landmarks deform during idle. A separate pre-repair fixture replays the final repair byte for byte.

The final source and battle assets were inspected across all 13 clips at six alternate phases in enlarged front/side whole-face and body views, then through all 16 continuous production state/transition rows at six phases. An additional 24-frame capture uses the exact companion preview and its final LOD. Independent production-renderer probes pass in both assets at desktop and mobile quality, with no browser errors. Dense skull/blend checks and full-geometry checks pass with zero severe-edge warnings. These measurements support the inspected coverage; a hash-bound receipt alone cannot establish that every anatomical part was reviewed correctly.

[Companion preview before/after](../screenshots/pet-shape-2026-10-15/mythic-4-companion-before-after.png) retains two idle poses from each version with their actual capture times. [Independent production-renderer results](../screenshots/pet-shape-2026-10-15/mythic-4-independent-runtime.json) cover both assets and quality settings. The follow-up passes all 16 focused regressions, 22 asset contracts, full client lint (zero errors; 22 existing warnings), the local production build, exact distribution verification and startup budgets. Production deployment is tracked separately from these local results.

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
| Grounded contact restoration after normalization | Seven starters; all grounded starter support clips covered by the unchanged contact-error limit |
| Detached geometry removal | Mountain Behemoth (`legendary-17`), Chimera (`legendary-15`), evolved earth starter (`starter-earth-r`) |
| Skinning seams exposed by repair or simplification | Corrected on affected source and battle models; regenerated and re-inspected |
| Generated assets | Matching battle LODs, animated impostors, manifests and runtime cache revisions updated |

The Oni repair was retained and independently rechecked. Remaining pets were inspected and kept when their existing anatomy and motion were coherent; numeric triage flags alone did not justify modifying them.

Skull repairs make the reviewed facial region follow its chosen skull/neck anchor, with a transition into the surrounding body. Geometry, UVs, textures, bone nodes and animation tracks were conserved for binding-only repairs. The crane and phoenix required separately reviewed beak/neck regions; Chimera required both heads to be inspected independently. Additional close cameras covered small or obscured faces.

The 13 starter rigs had nonuniform scale above animated rotations. A locally rigid skull could still stretch in world space. Normalization preserves the bind geometry, removes that scale and retargets the animation transforms. LINEAR, STEP and CUBICSPLINE handling have focused regression tests. These repairs intentionally change rig transforms and animation values; their conservation checks cover bind shape and retargeting rather than claiming unchanged tracks.

Release regression checks found small support-height errors on seven normalized starters: fire-r, fire-l, wind, wind-l, lightning, earth-r and earth-l. Their five support clips restore the authored vertical foot trajectories while preserving horizontal gait, foot orientation, mesh attributes, bindings, rig rest shape and 907 other animation tracks. Source, battle LOD, atlas, dense geometry probes and both final visual passes were regenerated and inspected again. The unchanged contact regression now covers every grounded starter.

Independent pre-repair bind fixtures preserve meaningful bird and crystal-bear anatomy comparisons after accessor compaction. Geometry comparisons decode the actual mesh data rather than comparing accessor numbers. The unchanged canonical rare hare manifest was restored independently of its runtime showcase variant.

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
| Dense skull clip samples | 181,058 poses, zero failed reviewed skulls |
| Cross-clip skull blends | 150,696 states: 468 per identity/version pair, zero failures |
| Full geometry / edge / connected seam checks | 73,414 poses, zero severe geometry edges |
| Hash-bound visual review gate | 161 models; zero missing, stale or changed evidence failures |
| Structure, materials, skin bindings and animation inventory | 161 / 161 pass; no unexpected duplicate anatomy or missing tail bindings |
| Battle LOD manifest / geometry certification | Pass, all 160 distinct assets |
| Animated impostor certification | Pass, all 160 distinct assets |
| Focused deformation, normalization and receipt regressions | Passed; Oni coverage now also retains the released defect, independent muzzle/jaw checks, conservation and deterministic replay |
| Complete repository regression suite | 15,526 pass; zero failures or cancellations; 27 skipped |
| Integrated production build, exact 480-asset delivery and startup budgets after main's Chronicle integration | Complete-face follow-up passes locally; 597.4 MiB client within the separate Chronicle and other-runtime partitions. Production release checks pending. |
| Full client lint and changed QA tooling lint | Pass (zero errors) |
| Production WebKit evolution controls | Two pass; one inapplicable CDP safe-area check skipped |

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
