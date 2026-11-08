# Flower-Pickers' Shelter map sprite

The top-down shelter drawn on sector 3 (Upper Terraces) over tiles 101, 102,
113 and 114 (a 2×2 building, the size of the stronghold across the road), which
are solid (`B`) in that sector's walk mask. Shipped as
`public/sector-buildings/flower-pickers-shelter-map-v1.webp` (512 × 512, the
shelter centred on a transparent square), receipted with the other building art
in `docs/art/sector-building-art-v1.json`.

## Source

Generated 2026-11-07 with Figma's image generator (`gpt-image-2.5-flare`) on a
flat magenta key. The render lives in the Figma file
`FHz1za66qbhAnzx3ygfTHa`, node `8:18`; its exact prompt is the asset's `prompt`
in `docs/art/sector-building-road-place-inputs-v1.json`. Node `6:2` is an
earlier 1×2 render that was retired: on the map it read as a thin plank, smaller
than its own name.

The PNGs in this folder are not committed (about 4 MB). To rebuild the sprite:

1. Export node `8:18` from Figma as `shelter-map-source.png` into this folder.
2. `node shinobij.client/art-source/flower-pickers-shelter/cutout.mjs` keys the
   magenta (border-connected background, trapped near-pure pockets, and blended
   key pixels on the silhouette, pass after pass, such as the seam between the
   storm rail and the roof), removes the magenta spill on the edge, crops and
   centres the shelter on a square canvas → `shelter-map-cutout.png`.
3. `node scripts/package-sector-building-art.mjs flower-pickers-shelter-map`
   encodes the 512 × 512 WebP and updates the manifest. Repackaging changes its
   bytes, so update `maxSectorBuildingArtBytes` in `scripts/verify-dist.mjs`.

Review cutouts zoomed on magenta and on a dark ground. The gap under the front
eave between the baskets is real transparency: the grass shows through it.
