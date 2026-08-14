# Shinobi Journey Trailer V21 QA Report

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v21-1080p.mp4`
- Duration: 00:02:12.07
- Video: H.264 High, 1920x1080, 30 fps, yuv420p, approximately 13.9 Mb/s
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kb/s
- Size: 234,877,948 bytes
- SHA-256: `2E6A39758FC9CB183F7799317A759774761E1E483494B1999C4E3DB1E5E42BD6`

## Copy verification

- The authoritative server catalog at `api/pvp/_jutsu-catalog.ts` contains 117 built-in jutsu.
- The durable, factual trailer claim is therefore `LEARN OVER 100 JUTSU`.
- That exact line appears on both the Earth-jutsu showcase and the Fire-jutsu showcase.
- The previous `LEARN JUTSU` wording is no longer active in V21.

## Motion continuity pass

- An objective frame-difference audit ranked all 60 active shots.
- Twenty low-motion narrative shots received restrained environmental motion without camera shake:
  - rain for lightning, night, and duel scenes;
  - embers for fire and Hollow scenes;
  - snow for memorial, companion, and summit scenes;
  - ash/dust for ruins, seals, and war staging.
- The lightning-companion shot also uses a restrained storm-light pulse. This removed the only unintended freeze detected in the narrative edit.
- Freeze detection at `-55 dB` and `0.40 s` now reports only the intentionally stable opening logo (0.0-1.2 s) and end card (127.5 s to end).

## Tactical 1v1 rebuild

- The featured duel is exactly 240 frames / 8.0 seconds.
- Seven distinct action beats are used: lightning dive/water dodge, water counter, low kick, rising knee, close parry, water palm strike, and wheel kick.
- The V20 temporal blend was removed. V21 uses optical retiming within each move, hard action cuts between moves, light deflicker, and detail restoration.
- Active master motion scores:
  - captioned opener: mean 3.503, lower quartile 2.716;
  - main fight: mean 2.566, lower quartile 1.632.
- Duel SFX were aligned to the actual move boundaries at 104-112 seconds. No added impacts remain in the closing beta card.

## Technical QA

- Full master decode: pass, exit code 0.
- Black-frame intervals: 0.
- Unintended freeze intervals: 0.
- Total active video frames: 3,962.
- Music tail silence: 0.484896 seconds, matching the approved half-second clean ending.
- Active timeline: 60 clips with complete indices 000-059.

## Visual review assets

- Jutsu copy: `tmp/trailer/cinematic-v21/qa-jutsu-copy-v21.jpg`
- Tactical master frames: `tmp/trailer/cinematic-v21/qa-tactical-master-v21.jpg`
- Tactical source sequence: `tmp/trailer/cinematic-v21/qa-tactical-seven-beat-v21.jpg`
- Lightning companion storm: `tmp/trailer/cinematic-v21/qa-lightning-companion-storm-v21.jpg`

## Generation provenance

- V21 did not generate new raster artwork. It retains the approved built-in ImageGen keyframes from V20.
- The exact prompts and built-in asset provenance remain recorded in `tools/trailer/V20_IMAGEGEN_PROMPTS.md`.

## Rebuild entry points

- Tactical sequence: `python tools/trailer/build_v21_tactical.py --root .`
- Final master: `python tools/trailer/render_trailer_v21.py --root .`
