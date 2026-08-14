# Shinobi Journey trailer V19 QA report

## Final master

- File: `output/trailer/shinobi-journey-epic-anime-promo-v19-1080p.mp4`
- SHA-256: `925EFBCF6286517443E34C3D5C708DDF836149B2AF00C3DD266B59EB37591F0B`
- Runtime: 00:02:12.07
- Video: H.264 High, 1920×1080, 30 fps, approximately 10.9 Mbps
- Audio: AAC-LC, 48 kHz stereo, approximately 323 kbps

## Requested shot replacements

- The stationary water/lightning tableau at the start of the tactical 1v1 section was removed. The title now overlays a moving lightning-dive / water-dodge shot.
- The main 1v1 sequence progresses through five distinct beats: dive and dodge, water counter, close wrist parry, guarded palm strike, and spinning water kick.
- The bright, overexposed crossed-sword rooftop image was removed from the V19 source list and replaced by a low kick / water evade followed by a rising-knee / lightning-guard exchange.
- The late crossed-sword finale was replaced by a water vault over a low lightning sweep.
- The new shots use the same dark rain-soaked hand-painted style, fighter identities, water palette, and restrained violet lightning language.

## Automated checks

- Full master video and audio decode: exit code 0.
- Black-frame scan: 0 intervals at `blackdetect=d=0.15:pix_th=0.10`.
- Trailer plan: 60 shots, 58 unique moving sources, maximum source use 1.
- Python render scripts compile without syntax errors.
- End silence: 0.484896 seconds, matching the requested approximately half-second earlier music cutoff.

### New motion clips

| Clip | Frames | Unique frame hashes | Freeze events over 0.20 s |
|---|---:|---:|---:|
| `106-lightning-dive-water-dodge-v19-final.mp4` | 63 | 63 | 0 |
| `102-jutsu-fight-sequence-v19-final.mp4` | 177 | 177 | 0 |
| `103-low-kick-water-evade-v19-final.mp4` | 60 | 60 | 0 |
| `104-rising-knee-lightning-guard-v19-final.mp4` | 66 | 66 | 0 |
| `101-vault-over-lightning-sweep-v19-final.mp4` | 51 | 51 | 0 |

## Visual review evidence

- `tmp/trailer/cinematic-v19/qa-early-fight-64.8-69.4.png`: verifies the prior overexposed rooftop sword clash is absent from the first replacement block.
- `tmp/trailer/cinematic-v19/qa-main-jutsu-final.jpg`: verifies the tactical title appears on moving action and the full 1v1 section changes through multiple combat poses.
- `tmp/trailer/cinematic-v19/qa-finale-123.7-125.8.png`: verifies the late finale is the water-vault / lightning-sweep action rather than crossed swords.
- Full-resolution spot checks used animation frames without a blended still layer; this avoided the double-limb ghosting found in an earlier rejected test.

## Rejected material

- The higher-motion FramePack tests for the lightning dive were rejected because they produced white-flash, silhouette, and body-merging artifacts.
- A 34% high-resolution still blend was rejected because it created doubled limbs over the moving frames.
- V19 uses the conservative anatomy-stable motion pass plus optical interpolation and sharpening instead.

This report verifies the defined V19 technical and visual QA targets. “AAA” is treated as the polish target, not as a claim of equivalence to a fully staffed studio production pipeline.
