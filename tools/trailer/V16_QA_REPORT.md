# Shinobi Journey Trailer V16 — QA Report

## Master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v16-1080p.mp4`
- Runtime: `00:02:12.07`
- Video: H.264 High, `1920x1080`, `30 fps`, yuv420p
- Audio: AAC LC, `48 kHz`, stereo, `323 kb/s`
- File size: `169,350,877` bytes
- SHA-256: `66B764AB1D52ADAED5BFC3FA75563C9655B7B490E9E3B54DCF6D3389BC28B33F`

## Requested changes

- Replaced the stuttering rain duel edit with `91-rain-bridge-duel-smooth-v16-proof-reversed.mp4`.
- Selected the clean first `0.450s` of the source before its excessive beam effect.
- Generated motion-compensated intermediate frames at `180 fps`, retimed the result to two seconds, and delivered `60/60` unique final source frames at `30 fps`.
- Reversed the smoothed motion so both fighters advance into the crossed-blade spark instead of easing backward from it.
- Added `150+ COMPANIONS TO DISCOVER` to the companion roster shot.

## Verification

- Full decode errors: `0`
- Detected black intervals of at least `0.10s`: `0`
- Audio tail remains unchanged: approximately `0.491s` of silence at the end.
- Companion caption remains centered, fully legible, and within title-safe margins throughout the shot.
- Duel contact sheet shows forward progression into the clash with stable character silhouettes and no large beam effect.
- Runtime, logo treatment, combat captions, beta CTA, and all V15 scene replacements are retained.
