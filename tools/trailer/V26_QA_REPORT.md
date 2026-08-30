# Shinobi Journey — Rill Animated Teaser V26 QA

## Deliverables

- Master: `output/trailer/shinobi-journey-rill-animated-teaser-v26-1080p.mp4`
- Landing-page encode: `output/trailer/shinobi-journey-rill-animated-teaser-v26-web.mp4`
- Visual contact sheet: `tmp/trailer/render-v26/qa-v26-contact.jpg`

## Technical checks

| Check | Result |
| --- | --- |
| Resolution | 1920 × 1080 |
| Duration | 14.400 seconds |
| Frame count | Exactly 432 |
| Frame rate | 30 fps |
| Video | H.264 High, yuv420p |
| Audio | AAC, 48 kHz stereo |
| Integrated loudness | -15.3 LUFS |
| True peak | -4.8 dBFS |
| Decode test | Passed on master and web encodes |
| Sustained black-frame test | No full-frame black events of 0.30 seconds or longer |
| Visual contact-sheet review | Passed |

## File integrity

| File | Size | SHA-256 |
| --- | ---: | --- |
| `shinobi-journey-rill-animated-teaser-v26-1080p.mp4` | 34,869,334 bytes | `AC24CE41F5EDF66385E781D30205E7EBAEC9AA248C95245D455798F740277ACA` |
| `shinobi-journey-rill-animated-teaser-v26-web.mp4` | 11,277,924 bytes | `695B1861800154AF8A642ABCBA6A5AAE81DA5120CC8809464DCA7E40D40326AF` |

## Content audit

- All eight pre-title shots contain generated frame-to-frame image-to-video motion.
- Rill remains the principal character, based on the supplied avatar and locked production anchor.
- Combat motion includes a run/dash, kick extension, guarded recoil, chakra expansion and landing recovery.
- The trailer labels itself `CINEMATIC TRAILER | NOT ACTUAL GAMEPLAY`.
- Rejected SVD and optical-flow proofs are not used in either deliverable.
- The former V25 still-image pan/zoom shots are not used in the V26 story/combat sequence.
