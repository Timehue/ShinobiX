# VN artwork production pass — 17 September 2026

## Research and production target

These are reference productions, not a claim that this browser game's budget or
scope is equivalent to a AAA release. No reference game's art is imported.

| Reference | Verified source | Application to ShinobiX (art-direction judgment) |
| --- | --- | --- |
| CLANNAD | [Sekai Project](https://sekaiproject.com/game/clannad/) describes the drama-club story, recurring relationships and Japanese voice option. | Familiar people and places need to stay recognizable across emotional beats. Preserve character faces, costume and story; spend illustration effort on the actual moment. |
| STEINS;GATE (original) | [Official English site](https://steins-gate.com/) identifies its branching story, six endings and phone-based decisions. | Artwork is story state: do not show a future form or a branch's consequence before the reader earns it. Check every reachable branch, not just first pages. |
| STEINS;GATE ELITE | [Spike Chunsoft](https://www.spike-chunsoft.com/games/steinsgate-elite/) documents animated presentation and newly animated ending sequences. | Its production investment is tied to specific scenes and endings. Our authorized scope applies that specificity to still illustrations; existing animation and audio stay intact. |
| ATRI -My Dear Moments- | [Aniplex staff announcement](https://aniplex-exe.com/news/?category=atri-mdm&id=52873) separately credits character design, art direction, backgrounds and direction. [Official English site](https://atri-mdm.com/en/). | Treat the portrait, environment and scene illustration as one directed production, with separate checks for identity, geography, and story timing. |

The practical quality bar is continuity, readable silhouettes, scene-specific
composition, clean alpha, mobile crops, reliable delivery and restrained asset
budgets. Higher detail alone does not meet it. This pass does not add voice acting,
music, new camera behavior, new controls, story text or an alternative renderer.

## Canon and reference lock

Current authority: `src/data/storylines.ts`, `story-interludes.ts`,
`story-road-events.ts`, `story-epilogues.ts`, field and Echoes scripts, plus their
runtime event builders. Old manifests are leads only. Names/gender in the existing
`STORYWIDE_CHARACTER_GENDERS` ledger must be checked against current prose before
an identity is redesigned. Apparent gender from a small thumbnail is not enough.

| Character | Retained reference | Visible production anchors |
| --- | --- | --- |
| Mira Volt | `portraits/cinematic/storywide/mira-volt-neutral.webp` | Short bright blue hair; youthful angular face; charcoal wrap clothing and scarf. Neutral has no lightning. Preserve identity for grief/resolve; do not infer electrical combat from a spoken threat. |
| Toma Reed | `portraits/cinematic/toma-reed.webp` | Short black hair, red scarf, dark layered tunic, warm complexion. Resolute variant keeps these features. |
| Elder Mori | `portraits/cinematic/elder-mori.webp` | Elderly, long gray beard/hair, muted red headband and rust robes. Book-holding solemn variant stays the same elder. |
| Registry Duty Clerk | `portraits/cinematic/registry-duty-clerk.webp` | Older clerk with gray hair, spectacles atop head, dark robe and record bundle. Retain the inspected reference. |
| Kite Harrow | `portraits/cinematic/kite-harrow.webp` | Long rose hair, black travel layers, brown belt and boots; ledger/appraisal role. |
| Captain Yura | `portraits/cinematic/storywide/captain-yura.webp` | Dark tied-back hair, gray fur collar, dark armor; an injury variant must be expressly justified for Yura herself. |
| Elder Sova | `portraits/cinematic/storywide/elder-sova-canon.webp` | White swept-up hair, blue layered robes, elderly woman. Retain the canon variants; old bearded Sova paths remain for compatibility only. |
| Nyx | `portraits/cinematic/storywide/nyx-neutral.webp` | Pale face, dark hood and cloak. Neutral, tense and resolute retain hood/face; no automatic mirroring. |
| Hoshina Enju | `portraits/cinematic/storywide/kage-hoshina-enju-canon.webp` | Long dark hair; red/cream ceremonial robes and flame crest. Hollow version belongs only to its authored finale beat. |
| Kael Whitefang | `portraits/cinematic/storywide/kage-kael-whitefang.webp` | Long white hair, pale blue robes, white fur; preserve original handedness. |
| Raiko Veyr | `portraits/cinematic/storywide/kage-raiko-veyr.webp` | Blue/gold ceremonial clothing, dark hair, broad older face. Hollow version remains explicitly authored. |
| Sable Nocturne | `portraits/cinematic/storywide/kage-sable-nocturne-readable.webp` | Indigo hood/ceremonial hat, pale visible face; preserve readable reference and delayed Hollow reveal. |

| Location | Retained material / palette anchors | Current story constraints |
| --- | --- | --- |
| Ashen Leaf | Living cedar, warm window light, paper/wood records, moss and roots; `ashen-register-wall.webp`, `ashen-register-annex.webp`, `ashen-old-grove-trial.webp`. | Register is a living cedar wall with individual carved lines. The black flower grows from the player's line, not a vase or inkwell. Do not show it before page 7 line 2. |
| Stormveil | Slate, rain-dark stone, rigging and banner cables, coastal rooftops; existing Stormveil exterior paintings. | First chapter takes place at an outdoor arena and clerk's stand. A council-room image is wrong for these pages. Reasons are chalked on slates. |
| Frostfang | Blue ice and stone, timber, fur, snow and practical warm lamps. | Oath hall, cavern, quarry and training yard are distinct. Frost seal and injury imagery must respect current physical state. |
| Moonshadow | Indigo timber, canals, violet lamps, black glass and restrained reflections. | Booth, bedroom, auction cellar, rooftop and Mirror chamber are distinct. A black moon is a finale state, not generic night lighting. |

## Review protocol

1. Inventory runtime-built pages, all possible choice edges, line-specific art,
   source evidence, actor identities, authored URLs and final served URLs.
2. Inspect existing images and identify remapping versus genuinely missing art.
3. Use the locked references for replacements; inspect originals and compressed
   exports. Keep prior paths where saved/published use cannot be disproved.
4. Capture real `TriggeredVisualNovel` / `CinematicVisualNovelStage` results at
   desktop and phone sizes before/after; also check landscape, larger text,
   reduced motion, branch navigation, replay and cached delivery.
5. Record generated, integrated and runtime-verified states separately.

Production shared-image overrides, private creator events and player-uploaded
avatars cannot be enumerated from this checkout. Resolver regression tests cover
their contracts; they are not a substitute for a production content audit.
