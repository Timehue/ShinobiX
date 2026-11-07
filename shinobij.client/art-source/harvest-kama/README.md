# Harvest Kama art

Generated 2026-11-06 with Figma's image generator (`gpt-image-2.5-flare`) for the
harvesting minigame planned in `docs/harvesting-minigame-plan.md`. The source
renders are kept in the Figma file "Shinobi Journey — Harvest Kama art"
(file key `FHz1za66qbhAnzx3ygfTHa`); the node of each one, and its exact prompt,
are recorded in `art-v1-provenance.json`.

## Runtime assets

| File | Size | Use |
| --- | --- | --- |
| `public/items/tool-basic-harvest-kama-v1.webp` | 320 × 320 | Basic Harvest Kama: shop card, inventory, equipment slot |
| `public/items/tool-golden-harvest-kama-v1.webp` | 320 × 320 | Golden Harvest Kama, the permanent gold pair |
| `public/assets/harvesting/kama-meadow.webp` | 1200 × 800 | Minigame backdrop. Plants stand on the open soil band (about 73–90% of the height) |
| `public/assets/harvesting/plant-field-herb-v1.webp` | 168 × 448 | Field Herb stalk sprite |
| `public/assets/harvesting/plant-binding-fiber-v1.webp` | 173 × 448 | Binding Fiber reed sprite |
| `public/assets/harvesting/plant-heartwood-bark-v1.webp` | 190 × 448 | Heartwood Bark sapling sprite (forest trace) |
| `public/assets/harvesting/plant-shadow-thread-v1.webp` | 130 × 448 | Shadow Thread vine sprite (shadow trace) |

All of this ships under the client size ceiling in `scripts/verify-dist.mjs`
(`maxHarvestingArtBytes`, 407,568 B with the two icons). The art was trimmed to
its display sizes before that credit: backdrop 1200 px at q80, sprites 448 px
tall at q82, patches q80. Re-encoding any of it larger means updating that
number.

### World-map meadow patches

| File | Size | Use |
| --- | --- | --- |
| `public/assets/harvesting/meadow-patch-herb-v1.webp` | 256 × 256 | Field Herb meadow, forest and central sectors |
| `public/assets/harvesting/meadow-patch-fiber-v1.webp` | 256 × 256 | Binding Fiber meadow, forest and central sectors |
| `public/assets/harvesting/meadow-patch-dusk-herb-v1.webp` | 256 × 256 | Field Herb meadow, shadow sectors |
| `public/assets/harvesting/meadow-patch-dusk-fiber-v1.webp` | 256 × 256 | Binding Fiber meadow, shadow sectors |

These are top-down painted decals laid on the sector painting under each meadow
marker, so the node reads as a plant growing there instead of a floating icon.
Draw one 1.6 tiles wide, centred on the node's target tile, below the marker
layer, turned by `(node index × 47) mod 360` degrees so neighbouring sectors never
look stamped. The marker floats above it (`markerOffset [.5, -.05]`), so the
medallion's pin points down into a patch that stays visible.

Each decal went through a second pass (`finish` in the provenance) to sit in the
paintings. It was toned toward the map's muted palette, given a ragged feathered
edge instead of a round silhouette, and given the soft dark rim the painted
bushes sit on.

Every plant sprite has its root base on the bottom edge, so the canvas can pivot
the sway from the bottom-centre. The cut band, slash trail, falling top half,
leaf burst and the kama in hand are drawn in canvas, the same way the fishing
kunai draws its fish, tether and splash rings.

## Cutting out

The generator does not return real transparency. Asked for a transparent
background, it bakes a light grey checkerboard into an RGB image. The cutouts were
made with a small PIL script that:

1. keys every connected run of light, near-neutral pixels that touches the
   border, plus any trapped run that reads as the flat two-tone checkerboard
   (shaded whites such as the herb's petals survive);
2. for magenta (`#FF00FF`) chroma-key renders, keys the magenta and removes the
   magenta spill from edge pixels;
3. closes pinholes, pulls the edge in by a pixel, feathers it, crops to the
   object and re-encodes as WebP (icons q90 / alpha 100 on a square canvas with
   a ~6% margin; sprites q88, base on the bottom edge).

The art audit (2026-11-06, every cutout at 3–5× on magenta and dark) found
three more checkerboard remnants the first review missed: white slivers between
the Binding Fiber stalks, white patches in the Heartwood Bark canopy, and a white
wedge inside the basic kama's satchel cord loop. The fiber and bark sprites were
re-made on flat magenta (Figma nodes 4:2 and 4:3); the wedge's 67 pixels were
cleared from the icon. Interior alpha of every icon and sprite is fully opaque.

Two renders were redone during the first pass. The first Shadow Thread vine painted
its "translucent silk" over the baked checkerboard, which cannot be keyed out.
The first Field Herb left checkerboard slivers between its stems. The final vine
was asked for on flat white with no pale colours, and the final herb on flat
magenta.
