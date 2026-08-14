# Shinobi Journey V9 QA report

Final master: `output/trailer/shinobi-journey-epic-anime-promo-v9-1080p.mp4`

## Timeline integrity

- 62 total shots: 60 moving shots, logo opener, and beta end card.
- 60 unique moving sources; maximum source usage is 1.
- No callback/repeat entries remain.
- Removed sources include the old symbol-bearing fox close-up, old rooftop duel, old lantern safe-motion clip, and old generic disclosure title.
- Music is one continuous 2:12.075 excerpt from `SHINOBI ROASTED RICE 2.wav`, with only the final 0.9-second fade and no internal splices.

## Replacement animation audit

All 20 new V9 clips were reviewed at 30 sampled frames per second. Every clip passed decode and freeze detection with zero errors and zero freeze events.

- Bare-forehead fox lantern scene: pass.
- Fox battle charge: pass.
- Fox golden shield rescue: pass.
- Rooftop duel impact: pass.
- Frost titan squad: pass.
- Fox versus Hollow pet battle: pass.
- Sky serpent raid: pass.
- Five-shinobi elemental combo: pass.
- Squad loadout armory: pass.
- Bloodline awakening: pass.
- Fox-led squad charge: pass.
- Companion roster: pass.
- Magma ogre dungeon boss: pass.
- Rooftop duel separation: pass.
- Giant oni squad raid: pass.
- Four-clan siege: pass.
- Hollow stag encounter: pass.
- Raid treasure portal: pass.
- Leviathan world event: pass.
- Rill and fox victory: pass.

## Master visual review

- Reviewed the complete 2:12 master at eight sampled frames per second across 22 dense contact sheets.
- Opening contains only the real Shinobi Journey logo; the generic `CINEMATIC TRAILER` image is gone.
- No Naruto-style symbol, metal forehead plate, headband, or glyph appears on the fox in any new close shot.
- Both duel scenes preserve one sword per fighter, opposing eyelines, stable hands, and correct directional movement.
- Feature coverage includes companion combat, companion roster, squad loadout, bloodline awakening, four distinct squad bosses, four-clan siege, raid victory, and a world-event leviathan.
- End card reads `JOIN THE BETA` and `SHINOBIJOURNEY.COM`.

## Master technical checks

- Duration: 00:02:12.07.
- Video: H.264 High, 1920x1080, 30 fps, yuv420p, approximately 10.15 Mb/s.
- Audio: AAC-LC, 48 kHz stereo, approximately 324 kb/s.
- Decode errors: 0.
- Unintended black-frame intervals: 0.
- Freeze detection: intentional logo opener from 0.0-1.2 seconds and intentional static end card from 127.5 seconds to end only.
- Integrated loudness: -13.7 LUFS.
- True peak: -3.8 dBTP.
- Loudness range: 2.7 LU.
- Final size: 173,162,728 bytes.

Artwork was produced with built-in OpenAI image generation. Final artwork prompts are recorded in `V9_IMAGEGEN_PROMPTS.md`; final image-to-video prompts and seeds are recorded in `framepack_batch_v9.py`.
