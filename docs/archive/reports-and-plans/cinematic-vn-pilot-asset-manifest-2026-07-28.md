# Cinematic VN pilot asset manifest

Pilot scope: Ashen Leaf level-4 chapter (`story-ashen-leaf-village-4-0`) and
level-20 interlude (`story-interlude-ashen-leaf-village-20`).

All new raster art was generated with the built-in OpenAI image generator,
then art-directed, inspected, resized, and exported as WebP. Character art used
the existing shipped portrait as an identity reference and a flat chroma-key
generation mode; the standard imagegen chroma-removal helper produced the
transparent stage portrait. The rejected first Registry Duty Clerk pass is not
shipped.

## Environment plates

| Final path | Story use | Prompt direction |
|---|---|---|
| `shinobij.client/public/scenes/story/cinematic/ashen-register-hall-wide.webp` | Chapter arrival | Wide living-cedar register hall, morning light, empty character lanes |
| `shinobij.client/public/scenes/story/cinematic/ashen-register-wall.webp` | Fourth question and pre-reveal beats | Close living cedar record wall, inkstone and quill, no black flower |
| `shinobij.client/public/scenes/story/cinematic/ashen-black-flower-reveal.webp` | Line-timed black-flower reveal | Same wall transformed by one dramatic black bloom |
| `shinobij.client/public/scenes/story/cinematic/ashen-old-grove-trial.webp` | Guardian handoff | Memorial grove, broken flagstones, roots suggesting an old guardian |
| `shinobij.client/public/scenes/story/cinematic/ashen-register-annex.webp` | Interlude arrival and pre-evidence dialogue | Practical cedar archive annex with tables, ledgers, and paper-window light |
| `shinobij.client/public/scenes/story/cinematic/ashen-annex-charts.webp` | Line-timed quartered-circle reveal | Close evidence table with route charts and repeated quarter-circle marks |
| `shinobij.client/public/scenes/story/cinematic/ashen-annex-steps.webp` | Interlude closing choice | Annex steps and old gate in late-afternoon amber light |

Environment output target: approximately 16:9, 1672 × 941, WebP quality 87.

## Character stage portraits

| Final path | Identity reference | Prompt direction |
|---|---|---|
| `shinobij.client/public/portraits/cinematic/toma-reed.webp` | `public/portraits/toma-reed.webp` | Dark field clothes, red fabric scarf, no magical flames |
| `shinobij.client/public/portraits/cinematic/registry-duty-clerk.webp` | `public/portraits/registry-duty-clerk.webp` | Older male clerk, charcoal registrar robe, glasses, cedar ledger |
| `shinobij.client/public/portraits/cinematic/elder-mori.webp` | `public/portraits/elder-mori.webp` | Elder, ember-mark headband, layered red/charcoal robes, still posture |
| `shinobij.client/public/portraits/cinematic/kite-harrow.webp` | `public/portraits/kite-harrow.webp` | Black hair with silver forelock, dark coat, gray-blue scarf |

Character output target: approximately 2:3, 1024 × 1536, transparent WebP,
quality 90 with alpha quality 100. Chroma removal used corner sampling, a soft
matte, one-pixel contraction, light feathering, and spill cleanup.

## Direction and sound policy

- The black flower remains absent through Toma's “Wait” and appears only on
  “Look at your line.”
- Harrow's chart plate appears only when she identifies the quartered-circle
  mark and remains for the following system-level reveal.
- Ordinary dialogue, typewriter characters, and the Next button are silent.
- Authored semantic cues are limited to title, paper, reveal, omen, decision,
  and battle handoff beats. Ambience is deliberately low and can be muted with
  the existing game-wide audio setting.
