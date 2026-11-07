# Gathering emblems (mining, fishing, harvesting)

Generated 2026-11-07 with Figma's image generator (`gpt-image-2.5-flare`) so the
profile card's daily-limit row reads as one painted set. Hunts already used the
crossed-kunai clan-mission emblem (`/ui/clan-missions/clan-mission-battle.webp`),
while Mining and Fishing were flat vector glyphs and Harvesting borrowed the
forest arena-floor tile. The source renders are in the Figma file
"Shinobi Journey — Harvest Kama art" (file key `FHz1za66qbhAnzx3ygfTHa`).

| File | Figma node | Subject |
| --- | --- | --- |
| `public/ui/game-icons/mining.webp` | 5:2 | Two crossed pickaxes with glowing ore chips at the crossing |
| `public/ui/game-icons/fishing.webp` | 5:3 | A leaping river fish struck by a tethered kunai |
| `public/ui/game-icons/harvesting.webp` | 5:4 | Two crossed kama with a bound sheaf of rice and herbs |

Each prompt asked for the hunt emblem's materials: forged steel, handles wrapped
in deep navy cloth, gold collars and ring pommels, navy tassels, top-left light,
and a "plain solid flat pure magenta (#FF00FF) chroma-key background".

## Cutting out

1. Alpha comes from how magenta a pixel is (`min(r, b) - g`, ramped 40 → 190).
2. Pinholes are closed, the edge is pulled in a pixel and feathered.
3. Edge pixels are un-mixed from the magenta key, residual magenta spill is
   removed, and green is capped on the soft rim (un-mixing leaves a green cast).
4. The object is cropped and centred on a square canvas so it fills the same
   98% of the frame as the hunt emblem, then resized (Lanczos) to 96 × 96.
5. Alpha of 245 or more is snapped to 255. Lanczos ripple otherwise leaves a
   near-opaque haze (alpha 250–254) over the inside of the art.
6. Saved as WebP q90 / alpha 100.

## Why 96 px

The sources are 96 px, not the 256 px of the clan-mission emblems. These
icons are drawn at 13 px (39 device px on a 3× phone), so GameArtIcon always
serves the `icon-96` copy. A 256 px source would ship for nothing. The first
cut at 256 px added ~92 KB and pushed the Production Image's `verify:dist`
runtime-assets total 33,035 B over its ceiling; at 96 px the six files are
~34 KB. The Linux image measures about 83 KB more runtime assets than a
Windows build, so read the headroom from CI, not from a local build. Drawn
above 48 px, these emblems upscale and soften; re-cut them from the Figma
renders at the size that use needs.

## Checks

The shipped files were checked on dark (4× on the cord loops, rings and rice
sheaf), and at 2× on light and on magenta. No magenta-tinted pixel survives.
Inside the outline every pixel is fully opaque except 19, 30 and 48, which
are real gaps between stalks, leaves, cords and droplets. The water droplets
around the fish are meant to be translucent. The `public/ui/icon-96/` copies
come from `node scripts/gen-game-art-icon-variants.mjs`.
