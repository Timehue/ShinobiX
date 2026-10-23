The user rejected the coiled Dune Viper and requested a leaner torso. This package retains the pre-remake source, editable world-space sculpture/UV data, the authored texture, and the Blender authoring scripts. The old concept and repair fixtures remain historical evidence.

Reproduce the shipping GLB from the pinned inputs with:

```
node scripts/build-dune-viper-no-coil.mjs --check
```

Omit `--check` to write the source GLB. The builder rejects changed inputs, fits the limb and tail controls with continuous weights, preserves the thirteen performances, adds 0.003 units of constant root clearance, and removes unreachable GLB payloads without recompression. The regression checks independently verify a single closed tapered tail, distal limb ownership, fitted tail controls, original head pixels, and unchanged motion apart from that exact Float32 vertical offset.

For further sculpt work, run `prepare-authoring-inputs.mjs` from this directory, then `sculpt.py` and `bake-texture.py` using Blender 4.5.14 LTS (`62c1db4208e8`). These create local working files; they do not update release approval. `authored-geometry.json.gz` stores the reviewed Blender geometry and UV layout before the deterministic skin fit. `lean-texture.webp` contains the original 2048×2048 decoded texture pixels in its left half and the new body bake in its right half.

Any new sculpture, texture, skin, or animation output requires fresh source/battle/atlas and runtime visual reviews, complete geometry/face/floor checks, and new evidence hashes. The fixture manifest records authoring inputs; production approval and live verification are separate audit receipts.
