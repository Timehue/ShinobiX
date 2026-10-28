# Cinematic VN improvement pass

Scope: actor pose variety, Moonshadow readability, semantic environment
variants, bespoke climax plates, restrained sound direction, chapter music,
mid-story direction, auto-read, and mobile control density.

All raster art in this pass was generated with the built-in OpenAI image
generator in reference-guided `illustration-story` mode. No CLI/API fallback
and no external asset pack was used.

## Actor prompt set

Shared final prompt:

> Premium 2.5D visual-novel actor cutout in polished hand-painted anime RPG key
> art. Image 1 is a strict identity, face, apparent-age, body, costume, palette,
> and rendering reference. Change only the requested pose and controlled
> lighting. Center the actor with generous padding and keep the head, hands, and
> torso inside frame. Use one perfectly flat chroma field with no floor, shadow,
> gradient, texture, reflection, text, logo, watermark, redesign, extra digits,
> cropped anatomy, or glow spill.

Per-asset final direction:

| Final asset | Identity reference | Pose / lighting delta | Generated master |
|---|---|---|---|
| `public/portraits/cinematic/storywide/mira-volt-neutral.webp` | `public/portraits/cinematic/storywide/mira-volt.webp` | Calm conversation; both hands lowered; attentive closed-mouth expression; no lightning or magic; cool-neutral key and restrained cobalt rim. | `call_naJ7VimFtUyYqHVCRHXlbSt6.png` |
| `public/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp` | `public/portraits/cinematic/storywide/kage-sable-nocturne.webp` | Same authoritative neutral stance; lifted near-black fabric separation; restrained violet rim; crescent emblem and eyes readable; never neon. | `call_2o8T57U9S3BonTG7lPYHxY2R.png` |
| `public/portraits/cinematic/storywide/nyx-neutral.webp` | `public/portraits/cinematic/storywide/nyx.webp` | Calm guarded dialogue pose; both hands lowered; no smoke or spell; gentle facial key and moonlit violet edge. | `call_tBvbKAQshqlS7aoq6fQ5sqq1.png` |
| `public/portraits/cinematic/storywide/shade-master-iro-tense.webp` | `public/portraits/cinematic/storywide/shade-master-iro.webp` | Restrained tense listening pose; torso slightly turned; hand near sash; no drawn weapon; focused eyes and violet edge separation. | `call_Ek9mWxfmfq7CZNeLx16Pc2KJ.png` |
| `public/portraits/cinematic/storywide/kage-hoshina-enju-tense.webp` | `public/portraits/cinematic/storywide/kage-hoshina-enju.webp` | Controlled leadership urgency; eyes open; squared shoulders; one firm open-palmed stop gesture; warm fire key and cool rim. | `call_t8qUD2K4aRmBZI45gKaAXVwm.png` |
| `public/portraits/cinematic/storywide/captain-yura-injured.webp` | `public/portraits/cinematic/storywide/captain-yura.webp` | Battle-worn but standing; hand at ribs; small temple bandage and restrained armor scuffs; determined, non-gory aftermath read. | `call_MHcyYlHKtCRkIT6Cqq0Bme1E.png` |

The four authored level-100 Hollow Kage portraits were also rebuilt as
stage-ready cutouts. Their existing storywide actors controlled identity,
costume, and silhouette; the legacy square Hollow portraits controlled only the
supernatural material and mood:

| Final asset | Identity + transformation references | Transformation direction | Generated master |
|---|---|---|---|
| `public/portraits/cinematic/storywide/kage-raiko-veyr-hollow.webp` | `kage-raiko-veyr.webp` + legacy `portraits/kage-raiko-veyr-hollow.webp` | Electric-blue fissures and luminous eyes; damaged shadow-cloak edges; navy/gold identity retained. | `call_hROgGgHbi3HPPtepD3svyUH7.png` |
| `public/portraits/cinematic/storywide/kage-hoshina-enju-hollow.webp` | `kage-hoshina-enju.webp` + legacy `portraits/kage-hoshina-enju-hollow.webp` | Molten orange fissures and restrained living flame; older male identity and flame Kage robes retained. | `call_apEjfkTKQuSb0fBYqWkrO2ZU.png` |
| `public/portraits/cinematic/storywide/kage-kael-whitefang-hollow.webp` | `kage-kael-whitefang.webp` + legacy `portraits/kage-kael-whitefang-hollow.webp` | Cyan ice growth, frost fissures, and sparse runes; clean-shaven face and white Kage silhouette retained. | `call_swHKM9qyYcglRp3vXFrwCr21.png` |
| `public/portraits/cinematic/storywide/kage-sable-nocturne-hollow.webp` | `kage-sable-nocturne-readable.webp` + legacy `portraits/kage-sable-nocturne-hollow.webp` | Cracked crescent porcelain mask, violet fissure light, and restrained torn shadow edges. | `call_Ociel8IxBOdKkts613DT2K8K.png` |

Four evidence-bearing solemn poses complete authored finale performances that
previously fell back to neutral art:

| Final asset | Acting beat | Generated master |
|---|---|---|
| `public/portraits/cinematic/storywide/elder-vanta-solemn.webp` | Lowered gaze, closed ledger held as a public confession | `call_NjfaDKcflsK8O3LSqJycsaEt.png` |
| `public/portraits/cinematic/storywide/elder-mori-solemn.webp` | Bloom-chart book presented outward as measured evidence | `call_w3rLSzWUJ4Rtm9dhZWJcbM6W.png` |
| `public/portraits/cinematic/storywide/elder-sova-solemn.webp` | Count book held open, formidable but morally burdened | `call_sRXpmI40kVN7c234Sk3B22zo.png` |
| `public/portraits/cinematic/storywide/shade-master-iro-solemn.webp` | Buyer manifest read without a weapon or defensive posture | `call_oJJqRFjVaEPLgxdel1gwV21u.png` |

Mira and Hoshina used a flat `#ff00ff` field with a soft matte at transparent
threshold 10 and opaque threshold 80. The dark/blue actors used a flat
`#00ff00` field and a conservative hard key sampled as `#03fa03`, tolerance 70,
to preserve black fabric and skin values. Final alpha sources were trimmed,
bottom-aligned on a consistent transparent 1000 x 1536 canvas, and encoded as
WebP at quality 90 / alpha quality 100 by
`scripts/process-cinematic-vn-actor-assets.mjs`. Its green/magenta despill pass
also fades saturated matte remnants, neutralizes edge hue, and clears RGB from
fully transparent pixels so browser resampling and CSS rim light cannot revive
a chroma seam.

## Environment prompt set

Shared final prompt:

> Premium wide 16:9 2.5D visual-novel environment in the supplied village
> painting's architecture, materials, palette, geography, and hand-painted
> anime RPG style. Environment only. Preserve clear foreground, midground, and
> background depth plus open left/right actor staging zones. Show controlled,
> story-specific damage or weather rather than spectacle. No characters,
> corpses, gore, modern objects, readable text, signs, logo, watermark, UI,
> border, or frame.

Per-asset final direction:

| Final asset | Location reference | Story-state delta | Generated master |
|---|---|---|---|
| `public/scenes/story/cinematic/storywide/stormveil-aftermath.webp` | `stormveil-threshold.webp` | Pale dawn after the storm; wet stone, torn banners, cracked parapet, repair lanterns, distant fading lightning. | `call_JrI1wwwbTkJDrD3TNTxzqs3M.png` |
| `public/scenes/story/cinematic/storywide/stormveil-blackout.webp` | `stormveil-civic.webp` | Empty civic hall after grid failure; cracked roof, rain, dark conduits, emergency lanterns, fallen bench and papers. | `call_5fMaPQaJ2kQHo4ZKpLll9t8i.png` |
| `public/scenes/story/cinematic/storywide/ashen-ashfall.webp` | `ashen-threshold.webp` | Dangerous ashfall, ember gusts, glowing split root, evacuation ropes and toppled cart; no engulfing fire. | `call_HNkqgmeGLGZLGMqcIv0atDCJ.png` |
| `public/scenes/story/cinematic/storywide/ashen-aftermath.webp` | `ashen-civic.webp` | Early-morning register hall recovery; ash, braced beam, cracked screens, rescued ledgers, fading smoke. | `call_7r2CcyugXYgtsIuAGB4eqHiW.png` |
| `public/scenes/story/cinematic/storywide/frostfang-whiteout.webp` | `frostfang-threshold.webp` | Severe readable blizzard; ice buildup, damaged watch platform, half-buried brazier, warm refuge lights. | `call_UXWuK2lpGDaRvGy5CwgMlXAO.png` |
| `public/scenes/story/cinematic/storywide/frostfang-aftermath.webp` | `frostfang-civic.webp` | Winter-dawn longhouse after a breach; boarded window, splintered bench, snow drift and repair brazier. | `call_wMqU3BQA1h3wSqvdg7XFjlTu.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-blackout.webp` | `moonshadow-threshold.webp` | Partly eclipsed canal blackout; lantern path extinguished, silver mist, bent reflection, damaged bridge rail. | `call_As6KMf7of7WN32ND4yS3cAAB.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-aftermath.webp` | `moonshadow-civic.webp` | First gray hour after covert conflict; cracked screen, relit lantern, gathered documents, fading wet footprints. | `call_lwYC79Tc9NnR4uMn67ox4ty6.png` |

Final environments are 1672 x 941 WebP, quality 88.

## Bespoke climax prompt set

Shared final prompt:

> Production 16:9 visual-novel climax background in the supplied village
> references' architecture, materials, palette, and polished hand-painted 2.5D
> anime-RPG rendering. Create a new eye-level 35 mm composition with strong
> foreground/midground/background depth, mobile-safe center, important details
> above the dialogue safe area, and clear lower-left/lower-right actor staging.
> Environment and props only. No people, silhouettes, player avatar, readable
> text, UI, frame, logo, watermark, modern technology, neon, fisheye,
> oversaturation, gore, or muddy detail.

| Final asset | Story-specific direction | Generated master |
|---|---|---|
| `public/scenes/story/cinematic/storywide/stormveil-climax-blank-board.webp` | Rain-dark open storm floor, truly blank challenge slate, Kesa's weighted cable maps, darkening copper lines, rotating sky and Low Terraces lamps | `call_1vCvHXNTyA5CK76YMp62fABM.png` |
| `public/scenes/story/cinematic/storywide/ashen-climax-rootfire.webp` | Living-root Rootfire chamber, central scarred anvil and ceremonial shears, upper cedar-gold fire, darker lower draw, water channel and charts | `call_osNgmGpN2yRrKpv4zmAwcrR3.png` |
| `public/scenes/story/cinematic/storywide/frostfang-climax-meter-zero.webp` | Ancient ice wall, dying end-stopped payment meter, lone handmade ridge lantern, plans and open stair to falling snow | `call_HZtGcIp13z9TW9PeP6QS2d4A.png` |
| `public/scenes/story/cinematic/storywide/moonshadow-climax-black-glass.webp` | Summit black-glass tank under an eclipse, single silver ripple, weighted receipts and unopened file, subtly incomplete reflected architecture | `call_YzCou1GQSp0qyH6bVy4OBG2j.png` |

Final climax plates are 1672 x 941 WebP, quality 90. They are assigned only
to the last reckoning page, so the level-100 sequence can build from the
reusable sanctum to a distinct visual payoff while preserving dynamic player
and transformed-Kage overlays.

## Runtime direction

- Actor pose is selected once per page from the full written beat. Injury terms
  outrank tension terms; otherwise the page is neutral.
- Admins can override left and right actor pose independently at event or page
  scope. A line can still alter camera, grade, impact, or sound, but cannot
  flicker actor art.
- Intermediate story pages classify as standard, crisis, or aftermath. Crisis
  and aftermath use the eight new village-state plates; chapter-specific
  opening and ending paintings remain untouched.
- Explicit authored page actors take priority over automatic pose variants.
  This preserves the four Hollow Kage finale transformations.
- One-beat preloading resolves the next background and both next-page actors,
  including authored art and pose variants, before the page transition.
- Moonshadow stages add a restrained violet silhouette pool and controlled edge
  separation. Speaking actors receive a modest face/value lift.
- Immersive mode contains keyboard focus, restores prior focus on exit, and
  keeps all controls at least 44 px. The 320 px layout removes the nonessential
  scene caption so it cannot cover faces.

## Sound and mobile policy

The semantic cue list remains deliberately tiny: title, paper, reveal, omen,
decision, and battle. Ordinary dialogue, typewriter text, Back, and Next are
silent. This pass adds deterministic noise seeds, duplicate-trigger protection,
gentle high/low frequency limiting, and one short quiet room response. Ambience
stays dry. No un-auditioned generic recording replaced the existing restrained
sound design.

If the browser initially suspends audio, the first user gesture now retries
AudioContext resume even when the requested ambience is already selected. This
prevents a valid ambience graph from remaining inaudible after autoplay
blocking.

On mobile, text speed and Classic Reader move into a 44 px settings menu.
Master mute and Skip remain one tap away. Page/line progress is repeated inside
the menu, reducing top-bar crowding without removing information.

## Completed-archive and accessibility follow-up

- Story Hall now exposes only completed chapters and interludes. Future,
  level-locked, and currently unfinished story metadata is not rendered.
- Every archived beat is a read-only, keyboard-accessible transcript. It cannot
  replay rewards, choices, or battles; recorded interlude choices are shown.
- Chapter VNs are consumed only by real `storyProgress` after a sealed boss win.
  Opening or leaving a chapter can no longer permanently suppress progression.
- The Classic reader's chapter bypass was removed, so the authored final
  decision remains the route into its boss encounter.
- Player-uploaded avatars are never regenerated or rewritten. Natural dimensions
  classify them as tall, square, or wide at runtime; square/wide art receives a
  consistent portrait plinth and face-biased crop while tall cutouts remain
  untouched.
- Persistent text-size controls add Default, Large, and Extra large modes.
  Persistent High Contrast removes dialogue translucency and strengthens type
  and borders. The full spoken line remains available to assistive technology
  without announcing every typewriter character.
- Persistent auto-read waits for type completion plus a line-length-aware
  reading delay, never selects a choice, pauses while settings are open, and
  exposes a one-tap visible off control while active.
- Fifty-two story pages now have explicit camera, transition, tone, cue, impact,
  and expression direction. The added 24 beats give each level-15 through
  level-75 chapter one deliberate reveal/evidence/omen turn. Ordinary dialogue
  backgrounds hold still, leaving motion and sound for story punctuation.
- Five paid-plan Suno themes, including a shared level-100 Hollow Gate motif,
  now crossfade without restarting per page. See
  `vn-soundtrack-direction-2026-07-29.md` for selection, processing, analysis,
  runtime mix, and rights provenance.

## Certification

`npm run qa:cinematic-vn` certified 35 environment plates, 32 actor cutouts,
and five score loops at 21.22 MiB total. Checks cover presence, image
dimensions, alpha, minimum actor width, per-file byte budgets, OGG container
signatures, and audio delivery budgets.

`npm run qa:cinematic-vn:browser` exercises the real
`TriggeredVisualNovel` reader at 320 px through 1920 px, reduced motion,
keyboard focus containment, mobile settings bounds, Classic/Cinematic
round-trip, persistent text size/high contrast, semantic dialogue/background
routing, decoded actor pairs, square/wide uploaded-player framing, and an
authored Hollow finale actor.
