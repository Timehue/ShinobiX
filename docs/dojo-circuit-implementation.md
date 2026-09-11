# Dojo Circuit

The Circuit is a server-managed, scheduled community event shared by Stormveil, Ashen Leaf, Frostfang, and Moonshadow. The normal duration is seven days (admin configurable from 1–14 days). It awards three event seals and an archived finisher distinction; the host can name an eligible finisher champion after closing. It does not create MMR, a currency faucet, or a mandatory matchmaking queue.

## Player experience

- A village-themed notice shows current event status, remaining time, and personal seal progress, and opens the same `dojoCircuit` screen from all four village hubs. The Arena District Circuit tab opens that screen too.
- The hub has illustrated discipline cards, detailed trial briefings, a personal seal passport, event timing, rules, and deliberate offline/upcoming/unscheduled/completed/loading/error states.
- The world board shows real registered participants, village counts, each participant's earned seals, search, and recent seal activity.
- Honours has original ceremony artwork, finishers, the recorded champion, and the most recent 24 archived events. Full archived records are retained separately.
- Players explicitly join and open one trial at a time. A resumed trial preserves its original start time and any verified match proof. Leaving a trial discards pending credit, not previously earned seals.
- Combat opens the existing sealed Solo-PvE practice host at the player's level and returns to the Circuit. The verified terminal settlement awards its seal, including practice fights that intentionally give no normal rewards.
- Cards open the Card Hall. The card-AI settlement host stages proof of a specific new victory for check-in. Lifetime win counters are not accepted as proof. Qualifying player duels record directly from the match host’s terminal evidence: at least 45 seconds, three meaningful actions per side, turn three, and a played conclusion rather than a forfeit or timeout. Existing anti-win-trading eligibility is respected.
- Pets open the paid Pet Colosseum. A specific server-verified, rewarded Colosseum result stages proof for check-in. Its immutable start/finish times must fit the active trial and event window. Normal costs, unlocks, availability, and the daily reward cap remain in force.
- Card/pet players return using a Circuit ribbon and record their victory before closing. The browser never supplies a winner or a claimed counter value.
- Combat has dedicated Circuit result art, verification/retry states, keyboard focus containment, and a return action. Card AI has a matching illustrated conclusion and direct return to the Circuit scribe. Combat, card, and companion battle headers carry Circuit identification while a trial is active; companion and player-card conclusions explain Circuit credit.
- The interface uses native vector emblems, a restrained stamp animation, shared game audio cues (respecting global mute), responsive art, keyboard focus, and reduced-motion handling.

## Admin operations

Admin Panel → World Events → Dojo Circuit:

- Global on/off, including the original `game-state` toggle compatibility.
- Schedule a name, local start date, 1–14 day duration, and opening spotlight. The featured discipline rotates daily in combat → cards → pets order, beginning with the chosen spotlight. All disciplines remain available.
- Preview four player-facing states without recording activity.
- End the current event with an inline confirmation.
- Name one three-seal finisher champion after closing. This is final once recorded.

Switching off clears unfinished attempts and blocks participation; earned seals and the event record survive. Scheduled closing time continues while off. Repeating the same toggle request does not clear active attempts.

## Authority and integration

- `shared/dojo-circuit.ts`: shared event types, phase logic, and verified-match proof types.
- `api/dojo-circuit/event.ts`: authenticated reads; locked, rate-limited writes; full-admin management; schedule validation; explicit join/begin/check-in; archive and champion authority.
- `api/dojo-circuit/_store.ts`: common toggle and verified combat/card-PvP settlement integration.
- `api/missions/report-ai-fight.ts`: calls the Circuit hook after the sealed terminal outcome and save settlement; participates in the existing retryable durable-effects path.
- `server-api-routes.ts`: registers `/api/dojo-circuit/event`.
- Circuit records bypass process-local KV caching because they participate in distributed locked updates.
- Generic player saves own no Circuit state. Other players' pending trial proofs are not exposed by the API.
- Card/pet check-in requires the event to be live; combat proof checks session start and terminal time against the active trial and event window. Old combat sessions cannot earn new-event credit.

## Art delivery

Built-in image generation was used for two original illustrations. Project files:

- `shinobij.client/src/assets/dojo-circuit/dojo-hero.webp` (247,644 bytes)
- `shinobij.client/src/assets/dojo-circuit/dojo-hero-mobile.webp` (73,584 bytes)
- `shinobij.client/src/assets/dojo-circuit/ceremony.webp` (227,298 bytes)
- `shinobij.client/src/assets/dojo-circuit/ceremony-mobile.webp` (70,462 bytes)

The supplied combat-arena, hidden-dojo, and pet-duel illustrations are reused in three discipline panels. Village notices share the original hero and use four code-defined village palettes. All crest, discipline, passport, and award marks are scalable native vectors, following the project's code-based icon approach.

Delivery conversion is reproducible with `shinobij.client/scripts/prepare-dojo-art.mjs`. It creates full-width and 840px WebP exports from the two generated source images.

### Hero generation prompt

Use case: stylized-concept. Create a premium painted environment key art for a ninja fantasy MMORPG event called Dojo Circuit. Wide cinematic 16:9 illustration, no lettering, no UI. A magnificent but intimate Japanese dojo courtyard at blue hour, lacquered dark wood, gently glowing ivory paper lanterns, brass architectural accents, indigo cloth banners. On the right two-thirds, the main open dojo glows warmly with a circular competition floor; in the foreground a low wooden table with a few illustrated playing cards and a carved small animal guardian figure subtly unites combat, card dueling, companion battles. Four cloth pennants, deep blue, ember red, ice blue, and muted violet, signify exactly four villages. Left third is atmospheric dark indigo open space suitable for readable UI text overlay. Elegant hand-painted anime fantasy environment, exquisite material detail, strong purposeful composition, rich atmospheric depth, restrained warm highlights, polished game art. Avoid photorealism, excessive bloom, crowds, logos, words, watermarks, interface frames.

### Ceremony generation prompt

Use case: stylized-concept. Asset type: Dojo Circuit closing ceremony background for a ninja fantasy MMORPG, cinematic 16:9 painted anime environment illustration. Quiet prestigious Japanese dojo award ceremony at night, empty raised lacquered-wood dais centered, a beautifully crafted circular brass medal displayed on indigo silk on a low pedestal, exactly four long elegant pennants in deep blue, ember red, ice blue, muted violet framing the sides. Warm ivory lanterns, dark indigo background, gold dust catching the light, subtle falling petals. No people. Composition deliberately leaves upper central dark space and lower corners for interface winner portraits and text that will be drawn in code. Luxurious understated game environment painting, crisp materials, controlled highlights, hand-painted detail. No letters, numbers, words, watermark, interface, logos.

## Verification

- `node --import tsx --test api/dojo-circuit/event.test.ts api/card-clash/match.test.ts api/card-clash/ai-move.test.ts api/pet/_showdown-rewards.test.ts api/_weekly-boss-admin-authority.test.ts api/game-state.performance.test.ts` — original 50-test baseline; follow-up regression coverage is described below.
- `npx tsc -p tsconfig.app.json --noEmit --pretty false` from the client directory.
- `npm run build:server` and `npm run build:client`.
- `node shinobij.client/scripts/dojo-browser-qa.mjs` builds the actual Circuit components with the game's shared styling and uses deterministic API fixtures for visual/interaction testing.
- Browser coverage: 1440, 768, 390, and 320px; hub, brief, launch/return/check-in, board/search, honours and archive/back; all event phases; locked cards/pets; explicit join; four village notices with personal progress; off notice; outage/retry; admin switch, preview, close/cancel, champion selection, and scheduling; combat victory/defeat/draw/pending/retry overlays and keyboard focus; card victory/defeat/draw conclusions at every tested width. Circuit buttons are checked for 44px minimum height.
- Accessibility scanner checks the hub, brief, world board, honours, state screens, results, and admin controls. The browser report and rendered captures are in `output/dojo-circuit/`. No violations were found in these targeted scans; this is not a claim of an accessibility audit of the entire game.
- API integration tests use the real practice-start, combat report, and card-PvP match handlers with server-side terminal fixtures to verify seals are awarded exactly once while ordinary combat rewards remain unchanged. Card-AI and companion check-in use real settlement handlers with terminal fixtures; proof-write outages are retried without duplicate seals. Practice and capped companion wins remain ineligible. Visual fixtures do not simulate the full combat/card/pet engines.

No live event was scheduled or enabled during implementation. All API test data uses the isolated in-memory QA backend.

## Completion audit · 2026-09-11

| Requirement | Implementation and verification |
| --- | --- |
| Cohesive original artwork and scalable marks | Two generated paintings, four optimized WebP exports, three existing discipline paintings, native crest/discipline vectors; inspected in desktop/mobile captures. |
| Exactly four local doors into one world event | Shared event API and four-entry village constant; all four notice variants checked in the browser, including event-off removal and personal progress. |
| Hub, briefings, progress, and clear restrictions | Actual Circuit components exercised at 1440/768/390/320px; join, launch, return, check-in, locked cards/pets, and all event states covered. |
| Combat/card/pet continuity | Existing engines retained; Circuit headers and return ribbon; illustrated combat/card-AI results; card-PvP and companion result guidance. Combat/PvP host integration and card/pet settlement regressions passed. |
| World board, honours, and archive | Participant search, four village counts, seal activity, finishers, champion, archive retrieval and return tested. No ranking/MMR added. |
| Full-admin control and preview | On/off, close/cancel, champion, next schedule, and read-only preview exercised in browser fixtures; auth, lifecycle, preserved records, and daily rotation verified by server tests. |
| Responsive and accessible presentation | No horizontal overflow or page errors at four widths; targeted Axe scans passed, Circuit button heights checked, combat dialog focus contained, reduced-motion support inspected. |
| Production integration | Server and client production builds passed; final `verify:dist` and `sizecheck` passed. Emitted assets contain the final Circuit art, results, admin controls, and responsive CSS. |

The build reports a non-blocking Vite configuration migration warning and a soft total-JS/CSS size warning (7.80 MB across the entire game); the size gate passes. The initial application JS/CSS graph is approximately 370 KB gzip. This task does not claim a whole-game performance or live multi-user certification.

## Integration-audit fixes · 2026-09-11

- **Match-proof check-in:** lifetime counters and legacy baselines no longer authorize a seal. Card AI and paid Colosseum settlement stage the exact match identifier and server-owned start/finish timestamps on the pending trial. Check-in revalidates this evidence. Combat and qualified card PvP continue to record automatically. Client-supplied proof is ignored; old matches, wrong disciplines, and out-of-window results are rejected. Leaving a trial or switching the event off discards its pending proof.
- **Settlement recovery:** card and pet proof delivery runs after durable terminal/payment records. A failed Circuit write can be retried through the existing match host without another payout or seal. Regression tests inject actual proof-write failures. Unpaid practice and daily-capped pet wins stage no proof.
- **Combat refresh:** a player-scoped presentation breadcrumb records the sealed session ID before opening the Circuit fight. The generic recovery builder restores the Circuit result/return destination only for that exact player's practice session. Closing that session removes the breadcrumb. It never authorizes rewards.
- **Archive race:** leaving the archive, opening a different record, changing character, or unmounting cancels the pending archive request. Response identity checks also reject stale completions. The browser regression delays a response, clicks Current Circuit, and verifies cancellation and the current screen at all four viewport widths.

Verification: 77 targeted tests passed across Circuit API, card AI/PvP, companion rewards, admin/shared state, AI recovery API, navigation, and settlement suites. Browser interaction/accessibility checks passed at 1440, 768, 390, and 320px. Tests use isolated memory storage or mocked browser API responses; no live event data was changed.

## Release preparation · 2026-09-11

The release was isolated onto live main at `15e093ab5a1f2cb10774c100c09b2dece29f78bc`, preserving newer storage, village, combat, and rendering fixes instead of replacing shared files with older working copies. Unrelated local work was excluded.

- 124 distinct targeted tests passed, including adjacent game-state and AI request contracts. The Dungeon recovery test now exercises the extracted navigation helper directly, retaining its sealed return destination and run token.
- The real-server fresh-account release certification passed all 90 checks against isolated local memory storage, not production.
- Circuit render-time clock reads were moved into lazy initialization and timer callbacks. Archive/current views have separate keyed tab state, avoiding effect-driven tab resets.
- The updated Circuit passed its browser flow and accessibility checks at 1440, 768, 390, and 320px.
- Releasing the code does not enable, schedule, or otherwise mutate a live Circuit. Full-admin event activation remains a separate operation.
