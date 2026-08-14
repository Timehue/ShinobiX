# Shinobi Journey Trailer V23 QA Report

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v23-1080p.mp4`
- Duration: 00:02:12.07
- Video: H.264 High, 1920x1080, 30 fps, yuv420p, approximately 14.1 Mb/s
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kb/s
- Size: 237,914,317 bytes
- SHA-256: `59DCC6D6975C01A7E86E6F09A346800D36D6734D6400C1F573241DE7D5635545`

## Village versus Village war animation

- Strengthened the existing fire/earth versus water/lightning war without changing its readable two-army composition.
- Added deterministic animated rain, embers, blue sparks, airborne rock debris, three lightning strikes, a pulsing collision point, and two expanding split-color shockwaves.
- Effects use restrained screen compositing; the orange/blue elemental separation remains intact.
- No camera shake was added.
- Caption remains `VILLAGE VS VILLAGE WAR`.
- Motion audit: mean 3.667, lower quartile 2.851 across 60 frames.

## Post-dragon climax replacement

- Removed the disconnected 1v1 kick shot at 2:04.
- Built-in ImageGen created a new continuity-matched keyframe using the preceding leviathan and following hero/fox shots as references.
- The replacement shows four shinobi and the bare-forehead golden fox combining fire, ice/water, lightning, and earth jutsu against the same eclipse-lit leviathan.
- A local Stable Video Diffusion pass plus 60 fps motion interpolation, deflicker, denoise, and deterministic battle FX creates the 51-frame final shot.
- A new impact accent lands at 124.867 seconds.
- Motion audit: mean 5.106, lower quartile 3.858 across 51 frames.

## Sequence continuity

- 120.267-122.267: Village versus Village elemental war.
- 122.267-124.067: World-boss leviathan reveal.
- 124.067-125.767: Squad-versus-leviathan finishing attack.
- 125.767-127.500: `BEGIN YOUR SHINOBI JOURNEY` final vista.
- 127.500-132.067: beta call-to-action card.

## Technical QA

- Full video and audio decode: pass, exit code 0.
- Black-frame scan: 0 intervals at `blackdetect=d=0.15:pix_th=0.10`.
- Strict freeze scan at `freezedetect=n=-60dB:d=0.5`: only the intentionally stable opening logo and closing beta card.
- Revised war and squad-climax shots contain no detected freeze interval.
- Music tail silence: 0.484896 seconds.
- Active timeline: 60 clips with indices 000-059.

## Visual review assets

- Final war motion: `tmp/trailer/cinematic-v23/qa-war-master-v23.jpg`
- Final squad-climax motion: `tmp/trailer/cinematic-v23/qa-finisher-master-v23.jpg`
- War-to-final-vista sequence: `tmp/trailer/cinematic-v23/qa-war-to-summit-master-v23.jpg`
- ImageGen prompt and provenance: `tools/trailer/V23_IMAGEGEN_PROMPTS.md`

## Rebuild entry points

- Squad motion generation: `python tools/trailer/animate_svd_v23.py --root . --model <local-svd-model>`
- Elemental FX plate: `python tools/trailer/make_v23_elemental_fx.py`
- Cinematic finishing: `python tools/trailer/build_v23_cinematics.py --root .`
- Final master: `python tools/trailer/render_trailer_v23.py --root .`
