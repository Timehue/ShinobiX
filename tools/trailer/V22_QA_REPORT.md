# Shinobi Journey Trailer V22 QA Report

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v22-1080p.mp4`
- Duration: 00:02:12.07
- Video: H.264 High, 1920x1080, 30 fps, yuv420p, approximately 14.0 Mb/s
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kb/s
- Size: 236,677,225 bytes
- SHA-256: `628C9A0936776B8383B9D2DFF5ECAB657FA624FA619D88BBAC816BC661B051D2`

## Jutsu showcase correction

- `LEARN OVER 100 JUTSU` is composited once across the complete 252-frame / 8.4-second showcase.
- The text remains continuously visible through all four examples: Earth wall, boulder control, Ice, and Fire.
- The caption fades only at the beginning and end of the complete sequence; it does not disappear or restart at internal cuts.
- Snow and embers were added behind the Ice and Fire examples while preserving the title-safe caption area.

## Village versus Village elemental war

- Replaced the previous village-war shot with a new built-in ImageGen keyframe and a local Stable Video Diffusion motion pass.
- Fire/Earth village forces attack from screen-left while Water/Lightning forces attack from screen-right.
- Both armies face and attack one another across a clear central collision line; the distant villages are context rather than targets.
- Animated elements include rain, fire and water dragons, lightning, earth debris, ranks of fighters, steam, and the central impact.
- Caption: `VILLAGE VS VILLAGE WAR`.
- Motion score improved from V21's lower-quartile 0.081 to V22's 2.279. V22 mean motion is 3.160.
- Added restrained transition and impact SFX at the shot's actual 120.267 and 121.267 second action points.

## Technical QA

- Full decode: pass, exit code 0.
- Black-frame intervals: 0.
- Unintended freeze intervals: 0.
- Freeze detection reports only the intentionally stable opening logo and closing beta card.
- Total active video frames: 3,962.
- Music tail silence: 0.484896 seconds.
- Active timeline: 60 clips with indices 000-059.

## Visual review assets

- Continuous jutsu sequence: `tmp/trailer/cinematic-v22/qa-jutsu-continuous-v22.jpg`
- Elemental-war keyframe: `tmp/trailer/cinematic-v22/114-village-elemental-war-v22.png`
- Elemental-war motion: `tmp/trailer/cinematic-v22/qa-war-motion-v22.jpg`
- Final captioned war shot: `tmp/trailer/cinematic-v22/qa-war-master-v22.jpg`

## Rebuild entry points

- Motion generation: `python tools/trailer/animate_svd_v22.py --root . --model <local-svd-model>`
- Motion finishing: `python tools/trailer/build_v22_war.py --root .`
- Final master: `python tools/trailer/render_trailer_v22.py --root .`
