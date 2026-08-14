# Shinobi Journey Trailer V15 — QA Report

## Master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v15-1080p.mp4`
- Runtime: `00:02:12.07`
- Video: H.264 High, `1920x1080`, `30 fps`, yuv420p
- Audio: AAC LC, `48 kHz`, stereo, `323 kb/s`
- File size: `168,888,286` bytes
- SHA-256: `ABB0CB9FED7E268B04EA99E136194DD9C4626A0AAF045D61B22A235883FE1BC4`

## Technical checks

- Full decode errors: `0`
- Detected black intervals of at least `0.10s`: `0`
- Audio tail: silence begins at global time `131.562s` and lasts `0.491s`, matching the requested approximately half-second earlier music cutoff.
- Timeline: `62` shots, `60` unique moving sources, maximum moving-source reuse `1`.
- Local FramePack server was stopped after generation; port `7861` verified free.

## Visual checks

- Opener and end card both use the complete Shinobi Journey crest. No edge of the crest, side flourish, compass point, wordmark, or blade is cropped.
- Lightning fox: exactly one bare-forehead golden fox companion; lightning originates at its paw and branches through the terrain; no golden orb, ring, dome, halo, or franchise headband symbol; sampled motion remains anatomically stable.
- `LEARN JUTSU`: present on the fire champion shot, centered and within title-safe margins.
- `MASTER YOUR ELEMENT`: present on the wind champion shot, centered and within title-safe margins.
- Tactical 1v1: exactly two opposing shinobi; water visibly redirects violet lightning into the planted kunai; no symmetric beam struggle or energy ball. The trailer uses only the audited clean opening motion window.
- Village War: red army advances from the left and blue army from the right; soldiers and elemental effects oppose each other across the center; fortresses remain background context; there is no central building, monument, capture point, or shared target. Selected animation remains stable throughout its used range.
- Requested combat language is retained: `COMPANION BATTLES`, `CLAN VS CLAN BATTLE`, `TACTICAL 1V1 JUTSU BATTLES`, and `VILLAGE VS VILLAGE WAR`.
- End card retains `JOIN THE BETA` and `SHINOBIJOURNEY.COM` with the complete logo above it.

## Rejected motion variants

- The first tactical animation was rejected because later frames collapsed into a bright orb.
- The first Village War animation was rejected because later frames created a vertical red/blue energy wall.
- Neither rejected variant is referenced by the V15 render.
