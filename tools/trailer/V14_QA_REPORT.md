# Shinobi Journey Trailer V14 — Final QA

## Master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v14-1080p.mp4`
- Duration: 2:12.07
- Video: H.264 High, 1920×1080, 30 fps, approximately 9.79 Mb/s
- Audio: AAC LC, 48 kHz stereo, approximately 323 kb/s
- File size: 167,033,409 bytes
- SHA-256: `02A5FED56212EE6BA3021FB3E83B5DDAE91F1759B21A79D9C58BCFC2AC9ED76C`

## V14 Changes

- Added `COMPANION BATTLES` to the fox-versus-Hollow companion fight at 1:19.816.
- Changed the clan feature copy to `CLAN VS CLAN BATTLE`.
- Replaced the weak crouched hero/fox launch at 1:44.211 with a grounded two-player tactical jutsu exchange.
- Added `TACTICAL 1V1 JUTSU BATTLES` to that new PvP scene.
- Replaced the airborne separation shot at 1:50.211 with a grounded rain-bridge katana parry.
- Replaced the old Village War animation at 2:00.111 with two armies contesting a central capture monument.
- Retained `VILLAGE VS VILLAGE WAR` on the new representative battle.
- Ended the music 0.5 seconds earlier while preserving the full visual runtime and end card.

## Animation Polish

- Inspected four temporal samples from each generated motion source.
- Restricted the tactical jutsu shot to source time 0.000–0.336 seconds, preventing its late oversized energy-ring morph.
- Restricted the rain duel to source time 0.000–0.240 seconds, preventing its late blade/energy bloom.
- Restricted Village War to source time 0.000–0.360 seconds, keeping the armies, monument, bridges, and modest converging jutsu readable.
- Verified the final encoded scenes rather than relying only on source art or proof clips.
- Full-trailer 24-frame overview reviewed after assembly.

## Technical Validation

- 62 shots and 60 unique moving sources.
- Maximum moving-source reuse: 1.
- Decode errors: 0.
- Unintended black intervals: 0.
- Freeze scan: intentional logo freeze from 0.0–1.2 seconds and intentional end-card freeze beginning at 2:07.5 only.
- Integrated loudness: −13.6 LUFS.
- Loudness range: 2.8 LU.
- True peak: −3.8 dBFS.
- Ending silence begins at 2:11.568 and lasts approximately 0.485 seconds.
