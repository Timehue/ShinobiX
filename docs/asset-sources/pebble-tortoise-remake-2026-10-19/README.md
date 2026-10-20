# Pebble Tortoise full reconstruction

New project-authored Blender geometry, continuous skull/neck/body skin, fitted cloth and separate pebble scutes. No paid generator or third-party mesh was used. The v9 candidate completed two visual passes. Main/live verification remains pending in `docs/audits/pet-pebble-full-remake-final-review-2026-10-19.json`.

The `.blend` contains the authored geometry and packed baked texture. The Python source creates the sculpt and UV atlas. The JavaScript assembly source preserves the existing 13-clip rig and binds the new surface; calibration adjusts vertical root motion for measured floor contact. Saved script copies document the workspace authoring process and use its `.tmp` paths.

Regression fixtures preserve two failed private bindings and the corrected anatomical binding before ground calibration. The visually observed thigh spikes stretched selected edges by over six times; the old lower-chin binding also failed. These fixtures must continue to detect those failures. Passing these regressions does not certify visual quality.

The original `candidate-battle-unreleased.glb` is the superseded v6 draft. Use `candidate-full-v9-reviewed-unreleased.glb` and `candidate-battle-v9-reviewed-unreleased.glb` for the actual reviewed geometry. Their private provenance is preserved exactly. `scripts/lib/pet-pebble-full-remake-release.mjs` finalizes root metadata and asserts identical rendering JSON and binary payload before canonical admission.

The v9 review includes 2,496 raw pose views, source and battle production transitions at low/medium quality, 864 technique frames at two time sets, 24 advancing idle frames and all 16 atlas cells. Thirteen independently marked face patches include the complete chin and rear jaw without exclusions. Both stages passed the 9,989-pose full geometry sweep. The reduced model's failed underarm fixture reproduces the defect fixed in v9. The rejected c99 detached scalp remains rejected.
