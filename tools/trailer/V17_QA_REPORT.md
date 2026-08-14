# Shinobi Journey Trailer V17 — QA Report

## Master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v17-1080p.mp4`
- Runtime: `00:02:12.07`
- Video: H.264 High, `1920x1080`, `30 fps`, yuv420p
- Audio: AAC LC, `48 kHz`, stereo
- File size: `168,346,340` bytes
- SHA-256: `874488F72DE723DE8F7530293E8A06820E8AF9E689B96B488DD8B39C25619AD8`

## Requested fixes

- Tactical 1v1 now consumes a purpose-built 63-frame smooth source at normal speed instead of stretching about three raw frames across 2.1 seconds.
- The former symmetrical rain duel was replaced with new asymmetric low-parry artwork and a clean 60-frame motion source.
- The former backlit companion attack was replaced with a synchronized hero-and-fox battle where blue/cyan lightning visibly originates from the fox and strikes the Hollow enemy.
- No rejected white-bloom, orange-fire, orb, or transformation frames are referenced by the V17 render.

## Verification

- Full decode errors: `0`
- Detected black intervals of at least `0.10s`: `0`
- Audio tail remains unchanged: approximately `0.491s` of silence at the end.
- Tactical final-frame sheet: stable fighters, water arc, lightning path, planted kunai, and caption.
- Replacement duel final-frame sheet: exactly two opponents, one sword each, grounded asymmetric parry, compact spark, no large flash.
- Lightning companion final-frame sheet: exactly one hero, one bare-forehead golden fox, and one Hollow enemy; blue lightning remains directional and connected; no orange fire or silhouette loss.
- V16 companion-count caption and all earlier logo, combat-copy, Village War, and beta CTA improvements remain intact.
- FramePack server was stopped and port `7861` verified free after generation.
