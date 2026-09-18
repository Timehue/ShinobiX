# ShinobiX VN artwork production report

Follow-up: [integration and avatar sizing review](sizing-review.md) verifies all 98 NPC portrait variants and improves 49 full-length fits, player-avatar alignment and narrow-screen sizing. Its current results supplement the original production pass below.

The accessible local artwork pass is complete: **145 approved WebP assets (124 backgrounds/illustrations, 21 portraits), integrated and runtime verified**, with 185 accurate existing assets retained. This is a substantial continuity and presentation upgrade; it is not a claim of AAA budget, animation or voice-production parity. Nothing was deployed or written to production data.

Research on CLANNAD, STEINS;GATE, STEINS;GATE ELITE and ATRI informed the production approach: stable identities and locations, story-state-specific imagery, and deliberate important-moment illustrations. Official sources, the distinction between verified facts and art-direction judgments, and the compact reference canon are in [the research and canon sheet](../vn-art-direction-2026-09-17.md). No reference-game artwork was imported.

## 1. Coverage

The current catalog covers **341 event/state/replay variants, 1,225 reachable pages, 4,144 dialogue lines and 2,266 artwork uses**, resolving to **330 distinct assets with zero missing files**. Running the same expanded catalog through the original committed resolver found 16 missing paths. The earlier initial snapshot covered only 682 pages; it is not used as the full-scope baseline.

Coverage includes all four village stories and interludes, road stories, endings, the eight field journeys and their earned/legacy returns, historical intake-answer replays, rift introductions/repeat visits/descents/first clears, all ten Echoes opponents and encounter outcomes, reactive witness variants, era introductions, and the shared dungeon, chest, pet, scribe and Sage VN templates.

[ledger.json](ledger.json) records each page's source, conditions, incoming choices, physical staging evidence, actor state, complete action/prop dialogue, line-specific resolved paths, classification, priority, and reverse consumer index. [ledger.csv](ledger.csv) is a compact sortable index. Classifications describe this pass: 507 REPLACE, 489 REMAP, 232 VARIANT, 148 FIT/CACHE FIX and 890 KEEP uses. These are artwork-use counts, not unique images.

Private published creator events, production shared-image overrides, actual uploaded avatars and server-selected Sage offer strings could not be enumerated from this checkout. Their access limitations are explicitly recorded as BLOCKED in the ledger. Valid custom URLs and data URLs remain authoritative.

## 2. Corrections

- Scene selection follows exact event/page titles and relevant lines. Compacted replays no longer infer their artwork from an original page offset. Black-flower, failed proof, pipe-ledger, founding-stone, Nara and Harrow evidence reveals respect their written moments.
- Corrected distinct intake locations, interiors, field work sites, road incidents, aftermaths and ending states. Closed/open chests, five-slot dungeon altar/final chamber, living rescued/healing Nara, removed sash/linen/rope props, and the earlier concealed Moonshadow stone now have appropriate imagery.
- Fixed rift aftermath identity lookup and removed unrelated narrator/absent-Halden fallback portraits. Added ten reader-only Echoes cutouts without replacing battle/card images. Repaired defective transparency and removed the medic's unrelated franchise emblem.
- Actor poses stay attached to their identity when Player/NPC slots swap. An injury mentioned in dialogue no longer injures an unrelated actor. Yura's wrist wrap appears in its supported later state. Kael's asymmetric artwork is no longer automatically mirrored.
- Added individual background focal points and a scoped Moonshadow cutout-shadow correction. The classic reader uses the same corrected art selection. Existing controls, typography and responsive layout remain in place.
- New filenames provide targeted revisioning. Legacy paths and the existing portrait revision/query and service-worker contracts remain supported; no saves or unrelated caches were cleared.

## 3. Assets and exact consumers

[production.json](production.json) lists every approved runtime path, generation source, reference/production brief, review status and actual desktop/phone capture. [consumers.md](consumers.md) lists every known built-in page/branch/replay consumer of all 330 assets. The ledger additionally records the precise zero-based dialogue lines on which each asset is used.

Examples:

| Runtime path | Exact consumer |
| --- | --- |
| `/scenes/story/cinematic/ashen-black-flower-reveal-v2.webp` | `story-ashen-leaf-village-4-0` / The Black Flower, from line 2; Elder Mori; corresponding historical replays |
| `/portraits/cinematic/side-stories/houndmaster-bel-nara-rescue-v1.webp` | `rift-first-clear-beast-warren` / Water Before Thanks |
| `/scenes/story/cinematic/system/ancient-courier-chest-open-v1.webp` | `sys-ancient-chest` / The Chest Opens |
| `/scenes/story/cinematic/system/dungeon-chronicle-altar-v1.webp` | `builtin-hidden-dungeon` and all five `craft-dungeon-*` events / Second Seal: The Chronicle Table |
| `/scenes/story/cinematic/storywide/moonshadow-founding-stone-closed-v1.webp` | `story-reckoning-iro-sealed-shelf` / Filed Under Load-Bearing, Close It for Good; its return / Unsealed |

All 145 approved assets are **generated, integrated and runtime verified** in representative uses. An image being present on disk was not treated as sufficient verification. Rejected and superseded exports are separate from the approved list.

## 4. Intentionally retained

185 current assets remain in use, including accurate established character identities, the living cedar Register wall and annex art, suitable village exteriors, Echoes environments, original biome dungeon entrances, and appropriate late-story forms. Remapping reused these where the problem was assignment rather than illustration quality. Every retained current path and consumer is listed in consumers.md.

Older replaced files also remain where saved/published or other-system usage cannot be disproved. Card/combat artwork and private authoring were not globally rewritten. No legacy asset was deleted based only on a failed filename search.

## 5. Tests and actual runtime checks

- **50 targeted tests passed** across artwork, presentation, story direction and field work. These cover asset existence, aliases, overrides, actor-slot normalization, conditional forms, reveal timing, all ending lanes, field/replay receipts, rift state and Echoes outcomes. A regression check ensures aftermath portrait lookup does not add a title sound cue.
- **Production build passed**, including story-content verification and TypeScript. Build warnings concern existing Vite native-loader compatibility and plugin timing; no build failure remains. The development-only audit catalog and save-test controls are absent from production JavaScript.
- Deep comparison of all **341 original/current event payloads** passed after excluding only artwork URL fields. IDs, dialogue, choices, conditions, rewards and archive receipts agree. Comparison of **4,144 derived presentation lines** also passed excluding only corrected background paths/focal points and supported actor poses; camera, transitions, tone, atmosphere, audio cues and timing behavior agree.
- **428 actual renderer captures** were recorded after the baseline, including desktop 1440×900 and phone 390×844 evidence for every new asset. Final desktop review sheets cover all 145 approved assets. Source/export inspection and phone review were performed throughout the small production batches. This does not mean every possible route was manually clicked.
- Actual ActiveStoryVisualNovel flows exercised entry, advancement, choice/branch selection, Back, serialized exit/resume, delayed reveal, historical replay, battle callback/return, classic/cinematic switching, square/wide/tall avatar fitting, 844×390 landscape, larger text, reduced/normal motion and low-end settings. The low-end reader omits decorative atmosphere while retaining art and controls. No API write or browser page error was recorded.
- An actual service worker retained both old and versioned art; the current version decoded offline with retry-parameter normalization. Existing-client behavior was tested without clearing account storage.

Evidence: `tmp/vn-art-audit/{current.json,before-expanded.json,preservation.json,final-tests.log,final-build.log,runtime-evidence.json,flows/report.json}`. Battle checks cover the real callback and serialized return through a local ephemeral character, not an authenticated live combat session.

## 6. Before and after

[Desktop comparison](../../tmp/vn-art-audit/before-after-desktop.png): left is before, right is after. Rows show the black-flower illustration, the council-hall-to-outdoor-clerk correction, and the hall-to-annex-chart correction. Each pair uses the same event/page/line.

Individual full-resolution captures and browser reports are in `tmp/vn-art-audit/before`, `final-comparison`, `expanded-after`, the per-family capture directories, and `final-runtime-review`. Phone comparisons can be made from the corresponding `-390.png` files. These are screenshots of implemented production components, not generated interface mockups.

## 7. Performance

Approved exports total **43.17 MB across the whole optional story library**. Median new file: **306 KB**; largest: **543 KB**. Backgrounds are 1672×941 WebP; portraits are 1100 pixels high with retained alpha. This library total is not an initial download.

| Representative active scene art, excluding player avatar | Before | After |
| --- | ---: | ---: |
| Black Flower | 364 KB | 330 KB |
| Frostfang First Bell | 138 KB | 479 KB |
| Moonshadow Empty Booth | 77 KB | 374 KB |
| Tovin Finished | 138 KB | 307 KB |
| Bel/Nara rescue | 34 KB plus missing background | 657 KB |
| Open courier chest | 423 KB | 375 KB |

The final system/road phone samples requested one or two artwork files, approximately 0.35–0.86 MB combined. Loading remains scoped to the active scene and at most one upcoming scene's background/two actors; the full library is not preloaded or embedded in the initial JS bundle. The sample active sets estimate 6.3–12.6 MB of decoded RGBA pixels. This is a pixel calculation, not measured browser heap or a device FPS benchmark; lookahead and browser caches can add memory. [performance.json](performance.json) provides exact bytes, paths, dimensions and assumptions.

## 8. Safe cleanup

Removed six rejected/superseded WebP exports introduced during this pass, plus their untracked local build copies: the snow-before-snow kiln yard, low broken-board crop, two incomplete phone key compositions, oversized healing-hound composition, and medic cutout with white inner-arm slivers. Each had zero current consumers, no runtime source references and no tracked-file usage. Their original generated PNGs and rejection provenance remain recorded. No committed build file, legacy art, production content or unrelated directory was deleted.

## 9. Remaining issues and limits

| Item | Specific limitation / disposition |
| --- | --- |
| Private/published creator and production override content | BLOCKED for enumeration by lack of authorized live content in this checkout. Explicit valid authoring and legacy paths are preserved; no claim that every production VN has been inspected. |
| Real player uploads and server-selected Sage offers | Dynamic/private inputs unavailable locally. Supported avatar shapes and override resolution were tested with fixtures; individual private media was not reviewed. |
| Authenticated combat and physical low-end devices | No authenticated live fight or hardware FPS test was performed. Local callback/return, low-end settings, layout and loading behavior were checked. |
| Hob Setter chronology | `story-road-seat-of-scars`, Habit describes “A burned stall by the arena gate,” while What to Write says “Hob's stall is the third thing they'll burn.” The exact chronology needs a narrative-owner decision. Art follows each page: a scorched but standing stall for Habit and an empty notice square for What to Write. No dialogue or future destruction was invented. |
| Dynamic dungeon companions | Final-chamber art supplies the environment and closed treasury; it does not bake in a fixed player, pet species or new guardian design. The existing actor system remains unchanged. |

No known missing local runtime asset or unresolved local integration failure remains in the audited catalog. Production-wide content sign-off and AAA-equivalent audiovisual production are outside what these local checks establish.
