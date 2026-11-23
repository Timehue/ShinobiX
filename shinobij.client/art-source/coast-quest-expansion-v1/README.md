# Coast quest expansion masters

The `paintings` folder contains 37 lossless PNG masters from image generation. The building exteriors establish a consistent foundation and doorway across tiers. Their map standees were painted against those exteriors. The unbuilt plot, regional landmark scenes, badge style and existing item art supplied the visual references. Each regional badge master contains four square cells in reading order.

With the game’s Sharp dependency installed, run `node export.cjs "<new output directory>"` from this folder. It produces 52 WebPs. The exporter splits the badge sheets, clears the alpha matte on the transparent cutouts, and fits each painting to its dimensions and byte ceiling. Compare names with [the review catalogue](../../../output/coast/quest-expansion/assets.json). The preview HTML, walk masks and rooms are in [the handoff](../../../output/coast/quest-expansion/README.md).

[Final painting prompts](../../../output/coast/quest-expansion/prompts.md)

