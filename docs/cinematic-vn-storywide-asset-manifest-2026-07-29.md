# Cinematic VN story-wide asset manifest

Release scope: reusable village scene families plus the recurring main-story
cast, complementing the bespoke Ashen Leaf pilot package in
`cinematic-vn-pilot-asset-manifest-2026-07-28.md`.

The follow-up pose, readability, crisis/aftermath, sound, and mobile pass is
documented in `cinematic-vn-improvement-pass-2026-07-29.md`.
The final soundtrack sources, processing, runtime mix, and commercial-use
provenance are documented in `vn-soundtrack-direction-2026-07-29.md`.

All new raster art was made with the built-in OpenAI image generator in
reference-guided generation mode. Existing shipped village paintings anchored
environment style; existing shipped portraits were strict identity references
for actors. Generated masters remain in the Codex generated-image store. Final
game assets were visually reviewed, resized, optimized to WebP, and certified by
`npm run qa:cinematic-vn`.

## Shared environment prompt

Use case: `illustration-story`. Premium 16:9 cinematic visual-novel environment
plate in the established hand-painted anime shinobi RPG style. The supplied
village reference controls architecture, material, weather, and palette but is
not copied compositionally. Eye-level 35 mm composition, foreground/midground/
background depth, face-safe negative space on both sides, mobile-safe center,
functional empty architecture. No people, creatures, text, logo, watermark, UI,
frame, baked particle overlay, modern technology, cyberpunk, fisheye,
oversaturation, duplicated architecture, or muddy detail.

Village-specific direction:

- Stormveil: charcoal slate, dark cedar, copper conductors, violet-white
  lightning, restrained amber practical light.
- Ashen Leaf: living cedar and roots, ember/cream/forest palette, warm smoke
  light and traditional water/fire infrastructure.
- Frostfang: heavy timber, carved dark stone, ice-glass, snow, charcoal/white/
  pale-cyan palette.
- Moonshadow: canals, black lacquer, wet stone, mist, silver moonlight, restrained
  indigo/violet practical lights.

Each village received four scene prompts: `civic` (council/register/roll hall),
`intimate` (workshop/archive/clinic/ledger room), `threshold` (street/gate/pass/
bridge), and `sanctum` (engine/kiln/frost-seal/mirror vault).

Environment delivery target: 1672 x 941 WebP, quality 88, under 700 KB.

| Final asset | Generated master |
|---|---|
| `public/scenes/story/cinematic/storywide/stormveil-civic.webp` | `exec-18652e39-42dc-4e9e-8353-c042c239ac02.png` |
| `public/scenes/story/cinematic/storywide/stormveil-intimate.webp` | `exec-ab87ded8-ea89-4fa1-8072-6d8140a9d826.png` |
| `public/scenes/story/cinematic/storywide/stormveil-threshold.webp` | `exec-d0fa0c1c-8e49-40ed-a75e-c7415922b07e.png` |
| `public/scenes/story/cinematic/storywide/stormveil-sanctum.webp` | `exec-97e7bac4-4bdb-4573-9b46-b87f404984eb.png` |
| `public/scenes/story/cinematic/storywide/ashen-civic.webp` | `exec-eff89fd0-bb18-4a1e-8f4f-29bfa1fa4be6.png` |
| `public/scenes/story/cinematic/storywide/ashen-intimate.webp` | `exec-beff90cf-5c6b-4f4f-9d3e-c1f429775095.png` |
| `public/scenes/story/cinematic/storywide/ashen-threshold.webp` | `exec-16461bf6-651f-492b-b7c5-7c900db31356.png` |
| `public/scenes/story/cinematic/storywide/ashen-sanctum.webp` | `exec-cf16fd81-a6b8-4111-b2af-8a4efe40ae13.png` |
| `public/scenes/story/cinematic/storywide/frostfang-civic.webp` | `exec-4912ab2f-1c77-453a-bdb3-0e688d931ebd.png` |
| `public/scenes/story/cinematic/storywide/frostfang-intimate.webp` | `exec-03e66d59-e6c5-46e2-9a9d-28e23a6a5abb.png` |
| `public/scenes/story/cinematic/storywide/frostfang-threshold.webp` | `exec-d2ef94d9-7b06-4c50-994d-5cd61b50f2d6.png` |
| `public/scenes/story/cinematic/storywide/frostfang-sanctum.webp` | `exec-1b734bdc-29d6-46ae-93af-f0ecf6dc13b0.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-civic.webp` | `exec-3e1858dd-f8b1-4e80-ae99-407eb69aacb6.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-intimate.webp` | `exec-911d09f6-e7c6-456c-a841-1848adeb6c6f.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-threshold.webp` | `exec-841ee668-f620-4f05-b7f0-7b1e5e104f17.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-sanctum.webp` | `exec-3d33292d-5e51-4a1b-9262-ba60a7fe2c7b.png` |

## Shared actor prompt and cleanup

Use case: `illustration-story`. The supplied shipped portrait is a strict
identity, face, apparent-age, costume, and palette reference. Produce a polished
waist-up/three-quarter neutral-speaking transparent VN actor in premium
hand-painted anime RPG key-art style, facing toward screen center, with the full
head and hands inside generous padding and restrained rim light. Flat `#ff00ff`
chroma field only—no scenery, floor, shadow, gradient, text, logo, UI, watermark,
redesign, extra fingers/limbs, chibi treatment, or Western-superhero styling.

The imagegen chroma-removal helper used corner sampling, soft matte,
transparent threshold 18, opaque threshold 96, one-pixel edge contraction,
0.35 feathering, and despill. Final actors are transparent WebP and are checked
for alpha and a minimum 900 px width.

| Final asset | Identity reference | Generated master |
|---|---|---|
| `public/portraits/cinematic/storywide/mira-volt.webp` | `public/portraits/mira-volt.webp` | `call_72nA2pAYh2DCarZpd17zUtO1.png` |
| `public/portraits/cinematic/storywide/kage-raiko-veyr.webp` | `public/portraits/kage-raiko-veyr.webp` | `exec-492ac4ac-15db-456f-b311-92a646970c55.png` |
| `public/portraits/cinematic/storywide/elder-vanta.webp` | `public/portraits/elder-vanta.webp` | `exec-79ffffa6-3355-4abc-a681-68c525e01cda.png` |
| `public/portraits/cinematic/storywide/kage-hoshina-enju.webp` | `public/portraits/kage-hoshina-enju.webp` | `exec-7b07d64c-241c-4845-b175-248c8013ca45.png` |
| `public/portraits/cinematic/storywide/captain-yura.webp` | `public/portraits/captain-yura.webp` | `exec-789ed788-9b52-472c-87cc-dd4cd38281f5.png` |
| `public/portraits/cinematic/storywide/kage-kael-whitefang.webp` | `public/portraits/kage-kael-whitefang.webp` | `exec-b762fcc7-6b5e-4fe7-af1a-b78302e1666b.png` |
| `public/portraits/cinematic/storywide/elder-sova.webp` | `public/portraits/elder-sova.webp` | `exec-07f3c407-bd6a-430e-9041-3467af6ee1ea.png` |
| `public/portraits/cinematic/storywide/nyx.webp` | `public/portraits/nyx.webp` | `exec-ff2f0661-3705-4d87-b5f4-9af4d51e4f3d.png` |
| `public/portraits/cinematic/storywide/kage-sable-nocturne.webp` | `public/portraits/kage-sable-nocturne.webp` | `exec-8c071536-e3f9-4086-96af-fc7f09db4496.png` |
| `public/portraits/cinematic/storywide/shade-master-iro.webp` | `public/portraits/shade-master-iro.webp` | `exec-1ac11aed-12f0-44a9-93c7-c6d496f0f5aa.png` |

### Finale expression variants

The level-100 hero interventions now use four reference-guided acting variants.
They preserve the shipped identity and costume while changing only expression
and gesture. Green chroma masters were extracted with a soft matte, contracted
one pixel, despilled twice, and normalized to 1000 x 1536 transparent WebP.

| Final asset | Acting beat | Generated master |
|---|---|---|
| `public/portraits/cinematic/storywide/mira-volt-grieving.webp` | grief held under resolve | `call_GIrR94tt4jR3G3qlNlxlgtBs.png` |
| `public/portraits/cinematic/storywide/toma-reed-resolute.webp` | protective resolve | `exec-573da33d-341a-4bb0-9775-8e6213858676.png` |
| `public/portraits/cinematic/storywide/captain-yura-defiant.webp` | freed, unbroken defiance | `exec-58c4512d-f5d8-413a-97c2-fa20c55925ec.png` |
| `public/portraits/cinematic/storywide/nyx-resolute.webp` | vulnerable self-possession | `exec-d00f7a0a-b168-445c-8cca-322f4a0f451a.png` |

### Finale testimony variants

| Final asset | Acting beat | Generated master |
|---|---|---|
| `public/portraits/cinematic/storywide/elder-vanta-solemn.webp` | accepts blame with the closed ledger in his hands | `call_NjfaDKcflsK8O3LSqJycsaEt.png` |
| `public/portraits/cinematic/storywide/elder-mori-solemn.webp` | presents the measured bloom pattern | `call_w3rLSzWUJ4Rtm9dhZWJcbM6W.png` |
| `public/portraits/cinematic/storywide/elder-sova-solemn.webp` | reads the Count book outward | `call_sRXpmI40kVN7c234Sk3B22zo.png` |
| `public/portraits/cinematic/storywide/shade-master-iro-solemn.webp` | reads the buyer manifest without defensive posture | `call_oJJqRFjVaEPLgxdel1gwV21u.png` |

### Level-100 climax environments

| Final asset | Key story object | Generated master |
|---|---|---|
| `public/scenes/story/cinematic/storywide/stormveil-climax-blank-board.webp` | blank board and Kesa's cable maps on the storm floor | `call_1vCvHXNTyA5CK76YMp62fABM.png` |
| `public/scenes/story/cinematic/storywide/ashen-climax-rootfire.webp` | shears on the anvil before the Rootfire | `call_osNgmGpN2yRrKpv4zmAwcrR3.png` |
| `public/scenes/story/cinematic/storywide/frostfang-climax-meter-zero.webp` | end-stopped meter and one ridge lantern | `call_HZtGcIp13z9TW9PeP6QS2d4A.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-climax-black-glass.webp` | black-glass ripple, receipts, and unopened file | `call_YzCou1GQSp0qyH6bVy4OBG2j.png` |

## Runtime use and audio policy

- Chapter-specific shipped paintings remain the opening and ending/climax
  compositions.
- Intermediate pages resolve to a scene family from the written title/scene;
  admin-authored event/page/line direction always overrides automatic choices.
- The next resolved backdrop and both actor cutouts preload only one beat ahead.
- Explicit page actor art takes priority over automatic storywide pose variants,
  preserving authored level-100 transformations.
- Ordinary dialogue, typewriter text, Back, and Next remain silent.
- Fifty-two hero beats carry explicit camera, tone, transition, cue, and motion
  direction. Routine dialogue holds a static background; motion is reserved for
  openings, crises, aftermaths, evidence, reveals, and confrontations.
- Only title, authored paper/reveal/omen/battle beats, and visible decision
  points can emit a short semantic cue. Ambience is low, persistent across pages,
  follows the global mute, and fades on unmount.

## Certification result

`npm run qa:cinematic-vn` now certifies 35 environments, 32 actor cutouts, and
five production score loops. The certification checks file presence,
1672 x 941 environment dimensions, transparent actor alpha, minimum actor
width, per-file size budgets, OGG container signatures, and audio delivery
budgets.
