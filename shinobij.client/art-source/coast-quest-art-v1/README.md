# Coast quest artwork masters

These PNGs are the approved inventory paintings and the black-background masters for the coast’s six Hold and break pairs. The [source manifest](assets.json) lists the filenames and export settings. The local review handoff lives in `output/coast/quest-art/` at the worktree root.

Run `node build.cjs` in this folder to export the paintings and copy the manifest to the local handoff. An optional first argument writes the paintings to another directory, including an empty one. A custom directory can supply its own `assets.json`. Further arguments select individual master IDs.

Inventory cutouts retain native alpha and fit inside a 288-pixel square on a 320-pixel transparent canvas. Effect pairs retain their painted registration on a 384-pixel canvas. The keyer removes the black field and compensates the RGB channels for the exported alpha before screen blending.

The prompts and source status for each candidate are recorded in the [art pack](../../../output/coast/quest-art/README.md). Use a new versioned filename when revising admitted art.

