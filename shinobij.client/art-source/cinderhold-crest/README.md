# Cinderhold crest (world map)

`src/assets/map-landmarks/cinderhold.webp` — the fifth village's crest on the
world map, made to match the four village crests (gold medallion ring, four
compass spikes, gem insets, a painted motif inside).

- **Made:** 2026-11-08, Figma MCP `generate_image` (`gpt-image-2.5-flare`), owner
  approved. Render kept in Figma file `FHz1za66qbhAnzx3ygfTHa` (node `11:2`).
- **Prompt:** a round medallion with an ornate antique-gold beveled ring; four
  sharp gold compass spikes; an ember-red faceted gem in the top and bottom
  spikes; a charcoal-and-ember field with sparks; centre: a jagged black obsidian
  volcano cone cracked with molten lava veins, erupting fire and embers, basalt
  shards at its base; no text; on a plain flat magenta (#FF00FF) chroma key.
- **Processing:** `python -I key_crest.py <render.png> <out.webp> <preview.png>`
  keys the magenta, fades and despills the fringe, crops to the medallion and
  writes a 256×256 RGBA WebP (quality 90), the size of the other crests.
  Reviewed at 3× on magenta and on dark grey: no trapped background, no pink edge.
- **Delivered:** 22,992 B, sha256
  `6ef625cc7f9ff982de8696de11154b00b845cd9cfc4c7b5cbf8d490a6a2ac238`.
