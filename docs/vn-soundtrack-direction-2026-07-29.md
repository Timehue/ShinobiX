# Visual-novel soundtrack direction and provenance

Created 2026-07-29 with Suno v5.5 while the project owner had an active paid
subscription. All ten candidates remain private/unpublished in the owner's Suno
library. Five selected WAV masters were exported and converted into production
loops; the unselected candidates and temporary masters are not runtime assets.

## Creative brief

The score is a restrained dialogue bed, not battle music and not a collection
of UI stingers. Each prompt prohibited vocals, spoken word, choir, chanting,
EDM, dubstep, trap hi-hats, pop drums, rock guitar, trailer braams, jump scares,
comedy, vinyl crackle, abrupt endings, and excessive percussion.

| Route | Final title | Narrative function | Selected Suno candidate |
|---|---|---|---|
| Stormveil | Reasons in the Rain | Worn civic warmth beneath weather, debt, and public testimony | `cc728f6d-5571-4afb-833c-5a9a59c2ebda` |
| Ashen Leaf | The Future in the Fire | Cedar, memory, institutional warmth, and the danger of preservation | `14d03e3c-00a6-4db7-84bd-7d43c278a39e` |
| Frostfang | The Warmth We Keep | Low, spacious winter restraint with one humane center | `30aca73a-0d72-4340-b734-a44c62d945e5` |
| Moonshadow | A Name Under Glass | Elegant low-key secrecy, reflection, and identity under ownership | `43e3e5ba-8d3e-4c0f-8bc2-561410f59051` |
| Level-100 reckoning | Four Debts Below | A shared Hollow Gate motif joining all four village debts | `e5c9f506-2d5d-4a08-b228-784b6c72072e` |

## Production masters

| Runtime file | Loop duration | Integrated RMS | Peak | Boundary jump | Clipped samples |
|---|---:|---:|---:|---:|---:|
| `public/music/vn/stormveil-reasons-in-rain.ogg` | 80.01 s | -19.05 dBFS | -7.12 dBFS | -51.25 dB | 0% |
| `public/music/vn/ashen-future-in-fire.ogg` | 86.66 s | -19.70 dBFS | -3.74 dBFS | -55.30 dB | 0% |
| `public/music/vn/frostfang-warmth-we-keep.ogg` | 91.76 s | -19.28 dBFS | -7.52 dBFS | -67.13 dB | 0% |
| `public/music/vn/moonshadow-name-under-glass.ogg` | 110.27 s | -19.11 dBFS | -6.01 dBFS | -69.43 dB | 0% |
| `public/music/vn/hollow-gate-four-debts.ogg` | 120.00 s | -21.20 dBFS | -7.81 dBFS | -71.24 dB | 0% |

The selected WAV masters were rotated at musically quiet boundaries, joined
with equal-power `qsin` crossfades, and given 12 ms codec-edge micro-fades.
Final delivery uses a -20 LUFS / 8 LRA / -1.5 dBTP loudness pass, 48 kHz
resampling, and Ogg Vorbis quality 5. Metadata records the title, album, paid
Suno origin, model, and creation date. `scripts/analyze-vn-soundtrack.py`
performs repeatable clipping, dynamics, spectral, head/tail, and loop-boundary
checks.

## Runtime mix

- Village chapters and interludes resolve deterministically from the event ID.
- Every level-100 village reckoning changes to the shared Hollow Gate theme.
- Non-story visual novels, road encounters, the Sage, and unrelated creator
  events do not inherit a score accidentally.
- Two persistent audio decks crossfade for 1.25 seconds. Page changes inside the
  same chapter never restart music.
- Base score gain is 0.18. Only authored title, reveal, omen, decision, and
  battle cues duck it. Paper handling and ordinary Next/Back actions do not.
- The global master mute, autoplay retry, visibility pause/resume, and unmount
  fade all fail closed; audio can never block story flow.

## Rights record

Suno states that songs created while subscribed to Pro or Premier receive
commercial-use rights, including use in video games, and that paid-plan users
can download WAV audio. Suno also notes that commercial-use rights do not
guarantee copyright protection, which varies by jurisdiction. Keep this file,
the embedded metadata, subscription receipts, and the private Suno project
records together as the production provenance trail.

- Paid-plan ownership/commercial use: <https://help.suno.com/en/articles/9601665>
- WAV and project export: <https://help.suno.com/en/articles/8128193>
- Stem extraction availability: <https://help.suno.com/en/articles/12702337>
