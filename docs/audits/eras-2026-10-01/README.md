# Era impact audit

Date: October 1, 2026 (America/Chicago).
Lifecycle: completed audit; improvement designs are proposals, not approved rules.
Evidence: current working tree based on `aec3cc862b0234ce804beb878b3e92687a431545`, including existing uncommitted changes. Repository behavior and isolated local tests; no production counters, environment values, player telemetry, or authenticated browser session were inspected.

Follow-up: the author approved making eras more engaging. [World Era Chapters](../../era-chapters.md) records the subsequent implementation. Findings below describe the pre-change snapshot; the adjacent probe now checks successful announcement/title recovery after the fix.

Later verification: [Campaign integration review](integration-review.md) covers the harder I–III campaigns, actual payout recovery, Hall admission refresh and the former IV/V difficulty gaps. The subsequent [Master/Grandmaster implementation](master-campaign-implementation.md) closes the short-objective and predecessor gap. Use the linked current campaign rules for implemented requirements; the findings below remain historical.

## Verdict

**World Eras currently matter as server history and individual prestige, but have little effect on what most players can do.** Eras I–IV are historical markers. Era V is a functioning collective milestone tracker whose unlock records a finisher, broadcasts news, grants that player a title, and starts a new historical window. It does not currently open an era-specific mission, trial, encounter, reward claim, or gameplay rule.

The useful foundation is already present: authoritative settlement hooks, milestone tuning, preserved finisher credit, banners, Hall records, and permanent Legacy birth-era stamps. The missing piece is a concrete shared payoff and a visible connection between a player's action and that payoff.

Echoes of War also uses the word era. Those four **campaign Ages are a separate system**: they group ten sequential battles, provide changing story context, and preserve witness choices that change later dialogue. They already have progression and narrative relevance. This audit's main recommendations concern the five World Eras.

## Question and design expectation

Question: Does changing an era change available activities, player decisions, community goals, rewards, or lasting identity? What would make that change worth pursuing?

Authority: [Live Product Status](../../LIVE_PRODUCT_STATUS.md) owns shipped availability. [Legacy system plan §14](../../legacy-system-plan.md#14-era-system) describes intended era behavior. It explicitly preserves existing systems, calls Era V the first genuine gate for new content layers, asks for mixed contributions and population-sensitive pacing, and says to credit one finisher but reward everyone. Runtime code proves implementation, not approval of differences from that plan.

## What each World Era does now

| Era | Default state | Concrete significance |
| --- | --- | --- |
| I: Shinobi Awakening | Unlocked | Authored founding history and a Hall time window. |
| II: The Hollow Gate Opens | Unlocked | Gate history and a Hall time window; current Gate admission does not consult this state. |
| III: Village Dominion | Unlocked | War history and a Hall time window; war participation does not consult this state. |
| IV: World Boss Awakening | Unlocked | Boss history and the default birth-era stamp for newly accepted Legacies. |
| V: Mythic Legacies | Milestone active | Five collective counters plus a mythic-rarity awakening trigger; unlock news, Hall entry, finisher title, and subsequent Legacy birth-era stamps of 5. |

Definitions: `api/_era-defs.ts:69`. Birth-era selection: `api/_era.ts:160`; stamping: `api/legacy/_acceptance.ts:307`. Display: `shinobij.client/src/screens/HallOfLegends.tsx:238` and `:630`, plus LegacyPanel, UserView, and LogbookCareerRecord.

Era V requires **5,000 missions, 1,500 PvP wins, 400 wanderer encounters, 150 qualifying Hollow Gate extractions, and 25 Legacy awakenings**, plus the first recorded awakening of a mythic-rarity Legacy while the era is active. All five counts must pass. Awakening means stage 1→2; it is distinct from the stage 4→5 trial called `mythic`. The trigger can be banked before the counts finish. Evidence: `api/_era-defs.ts:139`, `api/legacy/trial.ts:181`, `api/_era.ts:336`.

## Findings and actions

| Finding | Classification / impact | Evidence and confidence | Recommended owner/action |
| --- | --- | --- | --- |
| Era V has no content payoff wired to its unlock. Mythic rarity eligibility and all trial stages can proceed before V opens. | Implementation drift from §14.1. Completing the communal effort gives most players no new activity. Gating the awakening itself would create a circular dependency. | High: era consumers traced across API/shared/client; eligibility in `api/_legacy-score.ts:147`; trial start in `api/legacy/trial.ts:394`; effects in `api/_era.ts:451`. | Design + gameplay: add a new permanent content layer after unlock. Preserve current Legacy access. |
| Only the credited finisher receives an era title. No shared reward or per-player era contribution record is created. | Implementation drift from “reward everyone” in §14.2. Participation is invisible beyond aggregate bars. | High: `completeEraEffects`; normal-unlock probe leaves a bystander's save unchanged. | Design + rewards: define contributor recognition and a replay-safe personal claim, with a path for later arrivals. |
| Current goals are fixed absolute totals, and all are mandatory. | Matches mixed-category design; validation gap for population-sensitive pacing. PvP or eligible awakeners can bottleneck an otherwise active PvE community. Ordinary one-Legacy-per-character progression makes 25 awakenings require at least 25 different characters; this does not prove 25 independent humans. | High for configured rules, unmeasured for live pacing: `api/_era-defs.ts:139`; sealed-path journey test. | Live ops: inspect rates and eligible population before tuning. Avoid asserting that the authored “weeks of normal play” target is achieved. |
| Contributions are lifetime global totals, including when V is locked, rather than active-era-scoped contributions. War battles and boss kills are counted but appear in none of V's five requirements. | Implementation drift from §14.3's per-era active tracking. Pausing V does not pause accumulation. Future chapters would inherit old effort unless baselines are introduced. | High: `api/_era.ts:27`, `:188`; locked-state probe. | Backend + design: preserve V's existing totals; define activation baselines or era-specific ledgers for future eras. Decide explicitly which activities count. |
| Once the mythic trigger is banked, later ordinary contributions do not recheck unlocks immediately. | Matches the nightly fallback in §14.3, but produces delayed player feedback. The last contributor may see all requirements complete while the era remains in progress until the daily pass. | High: contribution helpers versus `checkEraUnlocks`; `api/cron/_scheduler.ts:397`. | Backend: a bounded, recoverable unlock evaluation on relevant settlement completion; avoid full world reads after every action. |
| A failed announcement or title save can still set `era:effects-done`, preventing the recovery sweep from retrying. | Implementation drift from the engine's stated recovery guarantee; direct runtime defect. The game's rare communal moment can lose its announcement or the finisher's reward. Hall failures have a similar caller-level risk because their return is ignored, though Hall failure was not injected here. | High, reproduced: `api/_era.ts:464–499`; `announce` catches failures in `api/_announce.ts:75`; offline failure probes. | Backend: stable announcement receipt, checked delivery results, explicit title completion, and completion only after required destinations are confirmed. Preserve first credit and timestamps. |
| Era cards show aggregate bars and lore, but no “what opens,” contribution receipt, village totals, or task action links. They fetch when the tab loads rather than continuously updating. | Unspecified runtime behavior / product gap. Players cannot easily connect their next action to a useful outcome. | High: `HallOfLegends.tsx:174`, `:706–735`; `EraView` in `api/_era.ts:278`. | UI + design: show the reward/content promise, bottleneck, personal progress, and direct activity links. Refresh after relevant activity or on a bounded interval while visible. |
| The progress summary averages fractions even though completion uses an AND rule. | Unspecified runtime behavior / misleading implication. Four full bars and one empty bar average 80%; this is not evidence of short time remaining. Zero-waived goals also render as an empty bar despite being done. | High: `HallOfLegends.tsx:710`, `:729`; `effectiveRequired` allows zero. | UI: show “4 of 5 measures met; awaiting …”; render waived goals as satisfied and handle the trigger separately. |
| Historical dates for I–IV are authored constants used to partition Hall entries; they are not verified launch-event records. | Design ambiguity. Useful chronology can be mistaken for observed server history. Most modern entries fall into IV until V opens. | High for implementation; no live historical verification: `_era-defs.ts:48–56`, `:80–122`; `HallOfLegends.tsx:238`. | Narrative + live ops: distinguish lore chronology from recorded unlocks and verify dates before presenting them as real release firsts. |

No `_Context.md` or `PROJECT_STATE.md` was found. This report adds audit evidence and proposals only; it does not change the canonical product status, the Legacy plan, thresholds, deployed state, or accepted design.

## Recommended direction: permanent world chapters

Keep I–IV as history and make V's completion open **one specific, permanent shared experience**. A small authored experience is preferable to a collection of invisible bonuses: players should be able to name what changed when the age turned.

### First implementation slice: The First Mythic Survey

Proposal, not an existing mission:

1. **Before unlock:** Hall and a visible world notice promise “Open the First Mythic Survey: investigate what changed beneath Central, leave your account in the Hall, and earn a commemorative cosmetic.” Add mission, duel, wanderer, Gate, and Legacy activity links with their actual eligibility requirements.
2. **At unlock:** preserve the finisher's Herald title and announce the newly available Survey with an action link. Open an authored three-step quest through existing NPC/mission infrastructure: hear the eyewitness account, choose a field investigation or a Gate investigation, then record the result at the Hall. The two routes support different interests without requiring every participant to clear PvP and the Gate personally. An investigation should contain an actual encounter or objective and distinct story evidence.
3. **Personal payoff:** completing either route grants the same commemorative cosmetic and a permanent “Witness of the Mythic Age” journal record, through a server-owned, idempotent claim. Scope the art/reward explicitly before implementation; no currency amount or stat buff is approved here.
4. **Community recognition:** show the credited finisher and village, then the community's contributions. Future contribution receipts can support an “Age Builder” distinction for qualifying pre-unlock activity. Historic anonymous totals cannot establish individual ownership: do not infer retroactive contributors from client save counters.
5. **Later arrivals:** the Survey and its main reward remain available after the event. Distinguish historical builder credit from completing the permanent chapter. Existing players retain every shipped activity and Legacy stage.

This gives three kinds of meaning: **something new to play, something lasting to own, and evidence that the community caused the change**. A server-first title remains special while the rest of the server gets a reason to care.

### Delivery order and acceptance checks

| Order | Slice | Definition of done |
| --- | --- | --- |
| 1 | Reliable existing unlock | Inject failures at announcement, village-chat, Hall, and title writes; retry delivers each required effect once, preserves credit, and never marks completion early. |
| 2 | Honest UI and actionable promise | Show AND progress, waived goals, banked trigger, concrete payoff, activity links, and a current-state refresh. A player can identify the remaining requirement and a suitable action. |
| 3 | One permanent content unlock | Before V: only the new Survey is unavailable. After V: server admission allows it. Existing mythic awakening/trials work in both states. Old and new players can complete the Survey, and claim replays do not duplicate rewards. |
| 4 | Participation and population tuning | Server receipts record player/era identity; contribution categories have abuse rules; live ops sees counts, rates, eligible population and stalled requirements. Targets are chosen from actual rates. |
| 5 | Future eras | Define authored unlock content, activation baselines, future era numbering, and migration before adding VI. `EraDef.number` currently permits only 1–5. |

For a target duration D days, use observed qualifying completions/day r to consider a remaining requirement near `D × r` for each metric, then forecast roughly `remaining / r`, including zero-rate and low-population cases. The era's forecast is the maximum across mandatory measures **and the mythic trigger**. Fix goals at activation or change them through an explicit audited live-ops intervention; do not silently move targets every time population changes. Large raw totals alone do not demonstrate healthy participation.

If the team does not want to author any new era content, the coherent alternative is to present World Eras explicitly as a **world chronicle**, remove promises of content gates, and judge them by history/recognition value. More counters alone will not solve the missing payoff. Recurring objectives should be a separate campaign/season system rather than resetting permanent historical unlocks.

## Echoes of War assessment

The four Ages divide floors 1–3, 4–6, 7–9 and 10 into The Unheard, The Buried, The Silenced and The Last Day (`shinobij.client/src/data/echoes-of-war.ts:272`). Their admission derives from sequential floor clears (`:313`). Witness records seal one server-validated answer after each age's closing encounter (`shared/echoes-witness.ts:15`, `api/card-clash/_echoes-witness.ts:24`). Later introductions and Halden's conclusion acknowledge those specific choices (`shinobij.client/src/lib/echoes-witness-scenes.ts:10`, `:27`).

They matter narratively and as campaign organization; the age labels do not themselves add combat rules or choice-dependent reward amounts. Keep that witness identity. If more distinction is desired, propose one signature opponent mechanic per Age and a clearer visible journal of prior testimony; avoid rewarding one interpretation more than another. These are optional follow-up proposals, not part of the recommended World Era implementation slice.

## Validation and limits

- **34 existing focused tests passed** across era definitions/views, batched contribution reads, Legacy acceptance and stage progression, witness authority/normalization, and reactive narrative/client receipts.
- [Offline probe](probe.mts) passed all assertions and reproduced: default era 4; contributions while V is locked; banked early trigger; normal transition to 5 with a finisher title and unchanged bystander save; lost announcement and title after injected write failures despite the completion marker.
- Run existing tests: `node --import tsx --test api/_era.test.ts api/_era.performance.test.ts api/legacy/_journey-e2e.test.ts api/card-clash/_echoes-witness.test.ts shared/echoes-witness.test.ts shinobij.client/src/lib/echoes-witness-scenes.test.ts shinobij.client/src/lib/echoes-witness.test.ts`.
- Run probe: `node --import tsx docs/audits/eras-2026-10-01/probe.mts`. It forces `NODE_ENV=test` and isolated memory KV, disables the Discord webhook, and mutates only disposable test storage. Its assertions document current observations, including defects; they are not desired-behavior regression tests.
- Initial sandbox execution failed to spawn Node/esbuild workers (`EPERM`); execution outside that sandbox completed successfully. Node used was v24.15.0, not README's currently pinned v24.21.0.
- Live configuration may override states and requirements. Actual Era V completion, population, stall duration, dates, browser rendering, and production delivery health remain unverified. No runtime/gameplay files were edited or deployed.

Revisit when era consumers or settlement hooks change, a content payoff is approved, or read-only production counters and qualifying-player telemetry become available.
