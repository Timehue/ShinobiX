# V25 Rill Cinematic QA Report

## Deliverables

| File | Duration | Resolution | Approx. size | Intended use |
| --- | ---: | ---: | ---: | --- |
| `shinobi-journey-rill-cinematic-v25-1080p.mp4` | 69.0 s | 1920×1080 / 30 fps | 95.5 MiB | High-quality master |
| `shinobi-journey-rill-cinematic-v25-web.mp4` | 69.0 s | 1920×1080 / 30 fps | 33.3 MiB | Full web playback |
| `shinobi-journey-rill-landing-v25-1080p.mp4` | 24.0 s | 1920×1080 / 30 fps | 32.7 MiB | Landing cut master |
| `shinobi-journey-rill-landing-v25-web.mp4` | 24.0 s | 1920×1080 / 30 fps | 9.9 MiB | Landing-page deployment |

## Automated checks

- Full decode completed without video or audio errors for all four MP4 files.
- Full master contains 2,070 frames; landing master contains 720 frames.
- Full master: H.264 High, progressive yuv420p, 48 kHz stereo AAC.
- Black-frame scan found no continuous full-frame black events of 0.40 seconds or longer.
- Full mix measured **-14.5 LUFS integrated** with **-4.9 dBFS true peak**.
- Landing mix measured **-15.3 LUFS integrated** with **-5.1 dBFS true peak**.
- Web encodes include `faststart` metadata for progressive browser playback.

## Visual review

- Reviewed a 25-frame full-trailer contact sheet and a 16-frame landing-cut contact sheet.
- Inspected the opening meter reveal, Sunken Court reveal, Rill payoff close-up, and final CTA at full 1920×1080 resolution.
- Rill's face, hair, ice-blue eyes, white coat, black fur mantle, and icy-water visual language remain consistent across the generated hero frames.
- Text remains within the cinematic safe area and is readable against the graded footage.
- The end card clearly includes the game logo, `PLAY FREE NOW`, `SHINOBIJOURNEY.COM`, and `CINEMATIC TRAILER | NOT ACTUAL GAMEPLAY`.

## Integrity hashes

- Full master SHA-256: `5FA33A40DA2BE8AD62DD1061DA6BD17176C02035B0B6440B4B07215630E78A23`
- Landing web SHA-256: `6FB2E8A566C39AC545C043B30761032559D0D96E31386F0D216B2CD91FB45D67`
