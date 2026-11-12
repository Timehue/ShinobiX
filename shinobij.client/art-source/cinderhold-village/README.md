# Cinderhold village (Cinderhold Gates floor)

`compound.webp` is the walled village baked into the centre of sector 67's floor
(`public/sector-map/s67.webp`), the same 4x4-tile block the four player villages
occupy in their gate sectors. It is a compose input, not a shipped asset.

- **Made:** 2026-11-09, Figma MCP `generate_image` (`gpt-image-2.5-flare`), owner
  approved. Render kept in Figma file `FHz1za66qbhAnzx3ygfTHa` (node `12:2`).
- **Prompt:** strictly top-down orthographic painted RPG map tile; a square walled
  shinobi village compound filling the frame; thick obsidian-black stone wall
  with charcoal coping, antique-gold corner finials and one roofed gatehouse in
  the middle of the south wall; eight buildings with dark charcoal-slate tiled
  roofs, gold ridge caps and ember-red timber trim around a large central hall;
  ash-grey cobbled courtyard with a well, ember braziers, small orange-red
  banners, cinder-black pines and lava-rock planters; muted volcanic palette;
  outside the wall a plain flat magenta (#FF00FF) chroma key, no text.
- **Processing:** `python -I key_village.py <render.png> compound.webp <preview.png>`
  keys the magenta, shrinks and softens the matte, despills the edge and crops to
  the wall. Reviewed at 3x on dark ash: no pink rim at the finials, wall or gate.
- **Baking:** `scripts/compose-cinderhold-floors.py` (step 5) pastes it into the
  4x4 block with a drop shadow; the gate faces the approach tile 102.
  `scripts/author-cinderhold-sectors.mts` holds 67's hand-authored layout and
  `scripts/admit-cinderhold-sectors.mts` admitted the floor.
