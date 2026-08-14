# Shinobi Journey Trailer V24 AAA Polish QA

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v24-1080p.mp4`
- Duration: 00:02:12.07
- Frames: 3,962 at 30 fps
- Video: H.264 High, 1920x1080, yuv420p, approximately 16.2 Mb/s
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kb/s
- Size: 273,485,539 bytes
- SHA-256: `83EB554BB7444EE696DC8E5FC08F117D0CA7D25BE70C875D562FD7B54867D6CD`

## Complete artwork-consistency review

- Reviewed midpoint frames for all 60 shots in three labeled master sheets.
- Character language remains consistent: white-haired lead, black-and-white layered shinobi clothing, elemental color coding, and the golden fox with red scarf and bare forehead.
- No Naruto icon, branded headband symbol, unexpected costume swap, duplicated hero, backward-facing attacker, or disconnected post-boss duel appears in the final master.
- The four villages retain deliberate elemental palette differences while sharing the same detailed cel-painted anime rendering language.
- Companion, jutsu, clan battle, village war, raid, and world-boss images stay within the same premium anime concept-art family.
- Captions were checked for terminology and continuity, including `FOUR VILLAGES`, `CLAN VS CLAN BATTLE`, `VILLAGE VS VILLAGE WAR`, and the continuous `LEARN OVER 100 JUTSU` showcase.
- No new ImageGen artwork was required in V24: the clean high-resolution oni and Hollow Stag source paintings already matched the trailer. The damaged animation conversions were replaced instead of regenerating strong art.

## Animation corrections

### Tactical 1v1 jutsu fight: shots 049-050

- Preserved the real seven-beat combat progression and original caption timing.
- Lifted crushed shadows, improved character separation, reduced compression noise, and restored edge clarity without adding camera shake or synthetic frame blending.
- Opener motion: mean 6.068, lower quartile 4.429 across 63 frames.
- Main fight motion: mean 4.861, lower quartile 3.390 across 177 frames.

### Giant oni raid: shot 051

- Replaced the blown-out SVD conversion with a stable 57-frame animation built from the clean 1536px source painting.
- Preserved the oni's face, hands, club, four attackers, attack directions, and hero anatomy across every frame.
- Added controlled camera advance, embers, ice sparks, airborne debris, and restrained lightning accents.
- Removed the old white/orange exposure blowout and UI-like energy rings.
- Caption remains `CONQUER EPIC RAIDS`.
- Motion: mean 2.732, lower quartile 2.426.

### Hollow Stag encounter: shot 054

- Replaced the animation that created an opaque white fog blob over the Stag.
- The final 60-frame version preserves the Stag, antlers, four-person squad, fox, and forest anatomy.
- Animation uses natural crystal glints, drifting violet motes, low ground mist, and a restrained camera advance.
- No reticle-like rings, camera shake, or anatomy morphing remain.
- Motion: mean 2.055, lower quartile 0.472.

## Existing high-motion climax retained

- Village versus Village war: mean 3.667, lower quartile 2.851.
- Squad versus leviathan finisher: mean 5.106, lower quartile 3.858.
- These shots passed continuity review and required no additional alteration.

## Technical QA

- Full video/audio decode: pass, exit code 0.
- Black-frame scan: zero intervals at `blackdetect=d=0.15:pix_th=0.10`.
- Strict freeze scan at `freezedetect=n=-60dB:d=0.5`: only the intentionally stable opening logo and closing beta card.
- All intended 3,962 video frames are present; no remux truncation.
- Music and SFX are bit-for-bit inherited from V23, preserving the approved cut and 0.484896-second closing silence.

## Review assets

- Shots 000-019: `tmp/trailer/v24-audit/v24-shots-000-019.jpg`
- Shots 020-039: `tmp/trailer/v24-audit/v24-shots-020-039.jpg`
- Shots 040-059: `tmp/trailer/v24-audit/v24-shots-040-059.jpg`
- Oni full-resolution review: `tmp/trailer/cinematic-v24/qa-oni-mid-v24.png`
- Stag full-resolution review: `tmp/trailer/cinematic-v24/qa-stag-mid-v24.png`

## Rebuild entry points

- Stable action FX: `python tools/trailer/make_v24_fx.py`
- Action animation and tactical grade: `python tools/trailer/build_v24_polish.py --root .`
- Final master: `python tools/trailer/render_trailer_v24.py --root .`
