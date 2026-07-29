# Production SFX library

The runtime library in `shinobij.client/public/sfx/production` was generated
with Suno Sounds v5.5 on 2026-07-29 while the project owner was signed in on a
Pro plan. The source WAV masters were fetched from Suno's own CDN, then trimmed,
high-pass filtered, faded, normalized to -3 dBFS peak, and exported as 48 kHz
16-bit PCM WAV.

Dry foley is mono. Ritual, story, crowd, and environmental cues remain stereo.
Environmental beds use a 700 ms overlap at the loop boundary. Playback gain,
cooldowns, voice limits, and semantic reuse live in
`shinobij.client/src/lib/game-audio.ts`.

| Runtime cue | Selected Suno clip |
|---|---|
| impact-light | `0b1c56da-14cc-4c99-9865-01dcd22721a4` |
| impact-heavy | `5e065fae-3f03-485b-b264-20759b74bd19` |
| guard | `6dfedf5e-3d12-40eb-a106-60d29b458d3d` |
| evade | `13a2d47d-c9ab-4b4f-9302-7072e1313f8c` |
| chakra-positive | `284e87ea-0518-4425-9265-4267dab299ab` |
| chakra-negative | `32299066-0900-4785-bfde-b971265d363e` |
| knockout | `2dcfeb41-4bb1-48be-9706-a842ef3aa332` |
| victory-seal | `e042ee82-47c7-4c5d-9743-c09cc2644775` |
| command | `c714a2e9-bb4d-4fb9-b751-c6895baf9346` |
| crowd | `6ae21750-79b9-42f4-aa7a-a0debc2fba0d` |
| paper | `3bdd7d32-c1b8-44ad-a542-477c8f01d392` |
| foil-tear | `df425141-930f-4e70-a47d-4c01fc748b92` |
| card-place | `34d9a7a1-00a5-4411-a506-ed4eb19993cd` |
| pack-pop | `be510dc8-3943-4b72-b32c-22c75ac6cdf6` |
| reveal | `51980eef-8eb8-4457-bf5d-faea59889562` |
| mythic | `2f4a3e79-9f33-49ef-803f-c96e21770e91` |
| chapter-seal | `38207513-393e-4e55-840f-17598248ea43` |
| omen | `78e5e464-0e86-473e-8a5e-03d9198ae503` |
| decision | `11961f5a-13df-4d5e-bcfe-4f8b19b4168b` |
| battle-transition | `e8809cca-89b5-47a5-aef8-9aa2e92d241d` |
| ambience-shrine | `62a7882e-4956-4d14-8a80-f852310c77d2` |
| ambience-village | `36a0b597-9f3d-483f-a5a6-b4c2c711dc8d` |
| ambience-road | `779c94af-fdaa-4e3f-b78f-d970575f2bfb` |
| ambience-interior | `05583b33-ea54-4cc8-a20c-1f16f37683ed` |
| ambience-hollow | `e3cadd06-0f5e-4e00-b5e7-08219fe34077` |

The rejected variants and temporary analysis files are intentionally not part
of the repository. Keep the Suno account history and subscription records with
the project's other source-asset records.
