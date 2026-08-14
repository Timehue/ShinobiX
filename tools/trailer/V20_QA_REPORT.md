# Shinobi Journey trailer V20 QA report

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v20-1080p.mp4`
- SHA-256: `CCF126D9D976D6BF595B3801818699F7BC6FDC8D93BA467AAD4B5995E7B56FC1`
- Runtime: 00:02:12.07
- Video: H.264 High, 1920×1080, 30 fps, approximately 11.4 Mbps
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kbps

## Requested revisions

- Removed the redundant early water-versus-lightning duel at approximately 1:05.
- Replaced it with a distinct earth shinobi demonstrating two connected jutsu beats: a jagged earth-wall eruption followed by a boulder ripped out of the causeway for a throw.
- Preserved the later water-versus-lightning duel as the trailer's unique featured 1v1.
- Smoothed that fight with bidirectional optical interpolation, mild 12% temporal blending, deflicker, restrained denoising, and detail restoration. Its hard impact-smear cuts remain intentionally visible.
- Added a steady 1.8% tracking move to the boulder shot after QA detected a brief low-motion pause. The final boulder clip has no freeze event.

## Automated checks

- Full master video and audio decode: exit code 0.
- Black-frame scan: 0 intervals at `blackdetect=d=0.15:pix_th=0.10`.
- Timeline: 60 clips and 60 unique active source paths.
- Python render scripts compile without syntax errors.
- End silence: 0.484896 seconds.

| Clip | Frames | Unique frame hashes | Freeze events over 0.20 s |
|---|---:|---:|---:|
| `107-earth-wall-eruption-v20-final.mp4` | 60 | 60 | 0 |
| `108-earth-boulder-lift-v20-final.mp4` | 66 | 66 | 0 |
| `109-tactical-1v1-smooth-v20.mp4` | 63 | 63 | 0 |
| `110-jutsu-fight-smooth-v20.mp4` | 177 | 177 | 0 |

## Visual review evidence

- `tmp/trailer/cinematic-v20/qa-master-earth-final.jpg`: verifies the early sequence changes from the empty causeway into the earth wall and then the boulder lift, with consistent character identity and no duplicate duel.
- `tmp/trailer/cinematic-v20/qa-master-duel-smooth.jpg`: verifies the later 1v1 retains its sequence of distinct water/lightning combat poses after temporal smoothing.
- The final earth shots maintain readable hands, planted feet, rock silhouettes, amber fissures, and rain-darkened exposure.

“AAA” remains the polish target rather than a claim of equivalence to a fully staffed studio production pipeline.
