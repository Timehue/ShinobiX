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
   98% of the frame as the hunt emblem, then saved at 256 × 256, WebP q90 /
   alpha 100.

The shipped files were checked on dark (4× on the cord loops, rings and rice
sheaf), and at 2× on light and on magenta. Interior alpha is solid: the few
non-opaque pixels inside the outline (10, 30 and 115) are real gaps between
stalks, leaves and cords, not the uniform ~253 that lossy alpha leaves. Two
edge pixels on the mining emblem's tassel keep a faint purple cast at 70%
opacity, invisible at any size the game draws. The water droplets around the
fish are meant to be translucent. The 96 px delivery copies in `public/ui/icon-96/` come from
`node scripts/gen-game-art-icon-variants.mjs`.
