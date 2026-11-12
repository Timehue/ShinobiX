# Chronicle direct-attack strike art

Generated 2026-11-11 with Figma's image generator (`gpt-image-2.5-flare`) for the
card duel's direct attack. The source renders are kept in the Figma file that
holds the Harvest Kama art (file key `FHz1za66qbhAnzx3ygfTHa`); the node of each
one, and its exact prompt, are recorded in `art-v1-provenance.json`.

## Runtime assets

| File | Size | Use |
| --- | --- | --- |
| `public/chronicle/fx/direct-strike-v1.webp` | 448 × 112 | The strike in flight. The crescent head is on the right edge, on the horizontal midline |
| `public/chronicle/fx/direct-impact-v1.webp` | 320 × 320 | The burst where the strike lands on the defending duelist |

Together they are 79,536 B. `src/lib/chronicle-direct-strike.ts` plays them and
`src/styles/chronicle-duel.css` (`.chronicle-direct-strike`) animates them.
`scripts/verify-dist.mjs` counts `chronicle/fx/` in the Chronicle art
partition (`maxChronicleArtBytes`), so new plates there spend Chronicle's
headroom, not the general runtime-asset ceiling.

The strike plate is turned about its head to face along the line from the
attacking Monster to the defending duelist, so a re-made plate must keep the
head on the right edge and centred top to bottom. Its 4:1 shape is written into
the CSS (`height: calc(var(--strike-length) / 4)`).

## Cutting out

Both plates were asked for on pure flat black, the same way the PvP plates in
`public/combat-vfx/` were made, because they are additive energy art. A small
PIL script keyed them:

1. opacity is the brightest of the three colour channels, with everything at or
   below 10 of 255 cleared so generator noise in the black does not become haze,
   and a 0.8 gamma so the glow keeps its body;
2. colour is divided by that opacity (unpremultiplied), so the plate reads the
   same over the table as it did over black;
3. the strike is cropped to its content with the head's brightest rows centred
   on the midline and resized to 448 px wide (WebP q80, alpha 90); the impact is
   cropped square about its centre and resized to 320 px (WebP q60, alpha 70).

Each cutout was checked at full size on magenta and on the table's dark teal:
no haze, no hard edge, no trapped black.
