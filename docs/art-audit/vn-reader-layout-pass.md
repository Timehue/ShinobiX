# Visual-novel reader consistency pass — 2026-09-18

The reported Chronicle Table screenshot came from the dungeon's separate legacy reader. Its mobile styles removed the scene background from the main stage, leaving a tall empty area and small boxed portraits. The previous art audit verified image identity but did not reject this layout. This pass checks the rendered surface as well as the selected files.

## Changes

- Dungeon dialogue now uses `CinematicVisualNovelStage`: full-screen scene art, shared portrait framing, reading settings, keyboard navigation and responsive dialogue. Empty player-avatar initials cards are omitted. Uploaded player portraits use the shared image store first.
- The Warden remains visible during player replies. Dedicated Warden uploads retain precedence, and reviewed obsolete portraits remain excluded.
- Entrance artwork belongs to seal one; the dedicated Chronicle altar belongs to seal two. The entrance no longer replaces the third chamber. Card and pet battle art still reaches its existing battle host.
- The second and third seal's last dialogue lines remain readable. Starting their encounters requires the named challenge button; Next, background taps and auto-read do not start a battle. Server-owned proof progression and reward settlement are unchanged.
- The top control says **Leave**, and progress is labeled **Seal**. Removed the obsolete dungeon header, duplicate scene caption, boxed-portrait markup and its 171-line stylesheet.
- Visual review found a second issue in the shared landscape layout: the speaker badge overlapped the dialogue. The badge now participates in layout above the text.

## Entry-point audit

| Entry point | Reader |
| --- | --- |
| Active village chapters, interludes, epilogues and Rift scenes | ActiveStoryVisualNovel → TriggeredVisualNovel → cinematic stage |
| World Map road events, Sage, pet encounters and ancient chests | TriggeredVisualNovel → cinematic stage |
| Story Hall archive and branch-resolved replays | TriggeredVisualNovel, read-only → cinematic stage |
| Field-work conversations and reviews | TriggeredVisualNovel → cinematic stage |
| Echoes of War introductions, outcomes and witness variants | TriggeredVisualNovel → cinematic stage |
| Hidden dungeon and all five crafted dungeons | DungeonEncounter → cinematic stage |
| Creator editor preview | TriggeredVisualNovel → cinematic stage |

The explicit Classic reading preference remains available. It is the only component that contains legacy VN stage markup; a routing regression catches any new duplicate. All 1,225 shipped catalog pages default to cinematic presentation. Private/unpublished creator content is outside this catalog; its reader is covered by the shared entry-point audit.

## Verification

- Inventory: 341 event/replay variants, 1,225 pages, 330 resolved assets, zero missing files. Asset resolution includes every catalog dialogue line.
- **2,522 browser layout cases passed**: every catalog page's opening line at 390×844 and 1440×900, plus all 18 dungeon pages at 320×640, 390×844, 844×390 and 1440×900. Checks include actual full-screen background coverage, decoded artwork, dialogue/control bounds, speaker/text overlap, horizontal overflow and runtime exceptions. Dungeon checks also reject empty avatar cards and undersized Warden portraits.
- **Nine interaction checks passed**, exercising same-burst Next, Back, player replies, all three explicit battle handoffs, dedicated room art, shared avatars and Leave. Card-start API calls are intercepted locally; no account or production mutations occur.
- **Six stale-art browser cases passed**: reviewed live exports are replayed through the migrated dungeon reader to ensure its art filtering survives the migration.
- **35 unit regressions passed**, including proof-gated dungeon progression, identity filtering, current asset completeness, all-catalog retirement behavior and reader routing. The client's pinned TypeScript build and focused ESLint checks pass.

Evidence is stored in `tmp/vn-reader-pass/`; stale-art dungeon results remain in `tmp/vn-art-recheck/verified/dungeon-report.json`. The test scripts are `vn-reader-layout-qa.mjs`, `vn-dungeon-flow-qa.mjs` and `vn-dungeon-art-qa.mjs` in `shinobij.client/scripts`.

These changes are local. No deployment or production image purge was performed.

The subsequent [wiring follow-up](vn-wiring-pass.md) fixes and verifies saved history, replay avatars, dungeon theme recovery and battle-result handoffs.
