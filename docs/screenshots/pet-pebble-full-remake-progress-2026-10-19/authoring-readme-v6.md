# Unreleased Pebble Tortoise reconstruction

New project-authored Blender geometry, continuous skull/neck/body skin, fitted cloth and separate pebble scutes. No paid generator or third-party mesh was used. This is an unfinished private candidate, not a production acceptance receipt.

The `.blend` contains the authored geometry and packed baked texture. The Python source creates the sculpt and UV atlas. The JavaScript assembly source preserves the existing 13-clip rig and binds the new surface; calibration adjusts vertical root motion for measured floor contact. Saved script copies document the workspace authoring process and use its `.tmp` paths.

Regression fixtures preserve two failed private bindings and the corrected anatomical binding before ground calibration. The visually observed thigh spikes stretched selected edges by over six times; the old lower-chin binding also failed. These fixtures must continue to detect those failures. Passing these regressions does not certify visual quality.

Required before release: final source and battle-model face/geometry checks, every animation from multiple views, production transitions and all techniques, advancing idle, independent second visual pass, complete receipt and live delivery verification. The rejected c99 model is not accepted by this reconstruction work.
