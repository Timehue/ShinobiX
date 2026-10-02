# First Pact: performance review and pet RPG proposal

Date: 2026-10-02. Status: small performance and battle-control changes implemented and locally verified; gameplay ideas are proposals, not approved design or shipped features.

Scope: the current working tree, including existing uncommitted First Pact changes. The [production specification](first-pact-production-spec.md), `shared/first-pact-contract.ts`, and server encounter rules remain authoritative. No production player analytics or real-phone profile was available; engagement explanations below are hypotheses based on the playable presentation and source.

## Performance findings

The existing world renderer already caches static artwork and keeps eased camera movement outside React. The remaining issues are concentrated around loading and cache misses:

- First Pact imported `PetShowdownBattle` and model warmup directly. This pulled Three.js, React Three Fiber, combat effects and their presentation into city entry, before a fight was requested.
- Every decoded environment image invalidated the entire city. A camera frame repainted full-width eight-row strips, and a background animation-frame pump continued painting the rest of the city. Its six-millisecond budget was checked only after a complete strip, so one expensive strip could exceed that budget substantially.
- The full-world backing canvas is 4032 × 2688 at 1×, approximately 41 MiB of raw RGBA pixels. At the previous phone cap of 1.25× it reached 5040 × 3360, approximately 65 MiB, before images, screen canvases or a battle's graphics were counted. The allocation probe only reads one pixel; this is not a guarantee of comfortable memory use on phones.
- All city artwork loads on entry. The local harness requested roughly 14.25 MB of JavaScript and artwork in the baseline. Deferring combat code reduces one part of this cost; district asset loading and deployment compression still need separate work.
- Wandering NPCs update every 360 ms. Despite a comment describing nearby simulation, the code processes every wanderer. Their state change redraws the minimap and rerenders the screen. This is a follow-up candidate, not a measured dominant cause.
- The city screen uses z-index 2300, while the shared battle takeover uses `--z-combat` (2000). A mounted battle could sit beneath the city, with the city's controls intercepting clicks. The focused recovery check reproduced the interception. The city now steps below the battle while a bout is mounted.

The small authorized pass defers battle presentation until squad preparation and caps the coarse-pointer world cache at 1× rather than 1.25×. This reduces its raw backing allocation from approximately 65 MiB to 41 MiB (36%) and reduces screen fill work to match. Model warmup remains optional and bounded; the existing recoverable session is saved before warmup. The battle's lazy boundary uses the project's existing chunk recovery.

An on-demand chunk experiment reduced startup raster work but caused cold cache misses during held-key movement. That candidate was rejected and the original whole-world warming behavior retained. A future cache redesign must prewarm the travel corridor and prove sustained walking does not regress. One baseline phone screenshot also showed a washed-out world, so that run cannot establish visually comparable phone performance.

The repeatable harness is `shinobij.client/scripts/benchmark-first-pact.mjs`; artifacts live under `shinobij.client/output/first-pact-performance/`. This is optimized-preview, headless Chromium diagnostics at 4× CPU throttle, not real-device FPS, GPU certification, server latency or proof of field performance. The preview includes QA proof instrumentation that production omits.

### Local results

Three fresh browser contexts per profile ran the same optimized preview, DPR, CPU throttle, readiness wait and held-key sequence. The strongest verified reductions are bytes and allocation, not hardware timings:

| Measure | Baseline | Final |
| --- | --- | --- |
| Isolated preview entry JavaScript, minified | 2.247 MB | approximately 0.470 MB |
| Entry JavaScript transfer through the local compressed preview | approximately 804 KB | 149 KB |
| Total measured JavaScript and PNG/WebP transfer | 14.247 MB | 13.596 MB |
| Phone world cache | 5040 × 3360; approximately 65 MiB | 4032 × 2688; approximately 41 MiB |
| Median desktop art-ready time | 7.71 seconds | 8.25 seconds |
| Median phone-profile art-ready time | 10.05 seconds | 7.98 seconds |
| Median desktop animation-callback p95 | 128 ms | 226 ms |
| Median phone-profile animation-callback p95 | 67 ms | 51 ms |

The timing results are mixed, and callback timing is not FPS or input latency. Background machine load was not controlled, and the washed-out baseline phone capture limits visual comparability. Do not claim a uniform speedup. The final held-key runs caused zero world-cache repaints in both profiles, confirming the rejected cold-chunk misses were removed. Desktop and phone screenshots in `final/` were reviewed and the city painted correctly. Significant startup long tasks remain; district asset loading and smaller prewarmed or baked render regions are the next performance work.

Verification: the optimized preview build and client TypeScript check passed. The initial focused First Pact suites passed 96 tests. The follow-up wiring pass passed 79 API/contract/client tests and 74 city/companion/narrative/wiring tests (133 distinct tests, with the 20 wiring tests in both runs). These cover server admission, campaign binding leases, exact-once settlement and completion rewards, sealed companion identity, reachable citizens and buildings, interiors, and App/server route wiring.

The expanded `scripts/verify-first-pact-battle-loading.mjs` passed deferred city loading, one squad prefetch, two-active/two-reserve formation order, rejected start and retry, duplicate-click protection, command submission, terminal settlement, rejected rematch and retry into the next tournament round, phone-sized recovery without WebGL2, visible concession failure and retry, and terminal receipt recovery without mounting combat. It now uses the current source engine, the preview's actual starter pets, and the production shell's token/layout styles. Run it from `shinobij.client` with `node --import tsx scripts/verify-first-pact-battle-loading.mjs http://127.0.0.1:5186`. Its network responses are deterministic fixtures; separate endpoint tests establish server authority. It does not certify 3D artwork, live-server latency, or real-phone rendering. The phone error screenshot in `output/first-pact-performance/wiring/` was reviewed.

The wiring pass also fixed three gaps around deferred loading. The concession error now portals above the battle instead of being trapped in the lowered city layer. A background replacement of the pet array no longer cancels the single recovery attempt. Fresh starts, rematches and saved-session recovery lock movement during preparation; formation selection and closing are disabled while a start is pending, late start responses cannot mount after exit or an account change, and a rejected rematch returns to the correct formation with its error. Interior Escape handling stands down while a battle or another modal owns the input.

The broad legacy visual verifier remains stale: it expects `highCourtAnnex` where the current proof reports `highCourtV3`, and also asks for an older Vey dialogue label. It cannot certify the current whole campaign until refreshed. The focused wiring pass above verifies the implemented performance and transition changes, not every campaign scene.

Release validation used an isolated checkout of current remote `main` at `6aa7b15aa47c872e4168fb1121131a5de93bbae2`, retaining its newer companion-presence rules and excluding unrelated workspace changes. All 133 focused tests, lint for the changed screen/scripts, the client TypeScript build, the optimized production build with production-length public test configuration, and the expanded browser check passed. The unchanged production bundle gates passed at 9,112,626 B of budgeted product JavaScript/CSS and 1,437,570 B for the initial graph. Battle recovery starts in a pending state derived from its saved session; the shared prefetch promise preserves failed stylesheet loads for chunk recovery instead of allowing an unstyled second import.

## Why the world may feel less exciting than its artwork

The game already has more than a simple story corridor: district writs, the three-round Vale Stable tournament, a multi-round Balancing, a repeatable Standing Court, spendable Court Standing, sealed companion identities and optional aftermath visits. Adding another generic gauntlet would duplicate existing content.

The gap is the relationship between exploration and the player's pets. In the street, the player mainly travels to a person, reads dialogue and enters a predefined fight. The companion follows and has narrative callbacks, but has few useful field actions. Court Standing chiefly buys access or a finding in the record. A returning level-100 player needs an early reason to experiment with their existing team and a clear picture of what they can earn next.

Proposed fantasy: **bring your own four companions into a living city, help its people together, discover local battle opportunities, and leave with a team whose shared journey is visible.** Preserve the fixed fall of the Court and the theme of beasts choosing to witness people.

## Recommended core loop

**Spot something in a district → use a companion to investigate → choose a short challenge → adjust the two active pets and two reserves → win a visible milestone → unlock a new local opportunity.**

One session should deliver a discovery, a meaningful team decision, a battle and a reward players can see. Story scenes give these activities purpose. More long dialogue should not be the main reward for doing them.

## Ideas in priority order

| Priority | Addition | Concrete player experience | Initial scope |
| --- | --- | --- | --- |
| 1 | Companion field actions | A tracker notices pawprints in Guardian Gardens; a sage reads a disturbed memory; a defender helps a resident cross a hazardous lane. The pet moves to the clue and reacts. | One interactable and one short animation, using current sprites. Role flavor provides advantages or alternate clues, never a hard requirement that blocks a roster. |
| 1 | A named local rival | A handler sees the player's team, challenges them, and later returns with a readable counter strategy. Before rematching, players see the rival's two active roles and one tactical hint. | One rival with three authored variants; use the existing server Showdown engine and 2+2 formation. |
| 1 | Visible team journey | A compact team panel shows all four companions, one current local goal, and the next cosmetic milestone. A successful rescue changes a badge, a stable memento, or the companion's field reaction. | Cosmetic mastery first. Reuse existing saved companion identities and nicknames; do not introduce another mandatory power grind. |
| 2 | Small district expeditions | A garden trail offers a safer route or a tougher handler; an Aqueduct trip asks whether to scout the next opponent or take a small supply cache. Both paths end in a distinct encounter. | Three authored nodes per outing, a short session, explicit exit and resume. Keep the static city; avoid a procedural world rewrite. |
| 2 | Pet rescue and willing recruitment | A distrusted beast chooses to accompany the player after a rescue and an earned trial. Players learn what makes it different before deciding to bring it home. | A temporary guest or cosmetic introduction first. Permanent recruitment needs existing pet-cap, rarity, roster and reward-authority rules designed and validated. |
| 2 | A useful Vale Stable | The rescued stable becomes a place to view the team, practise a matchup, meet the rival, and display earned mementos. NPC responses change after local successes. | Reuse its existing interior and tournament; add reasons to return rather than another disconnected menu. |
| 3 | District champion variants | A champion telegraphs a shield pattern or weather turn; players earn an alternate cosmetic by winning under a voluntary condition. | Expand existing writ/trial encounters with authored variants after the first slice proves compelling. |

Keep bond advancement modest and expressive: a companion investigates sooner, gains a new reaction, or unlocks a team pose. If mechanical bonuses are later introduced, scope them to First Pact and review their effects on existing pet modes. Avoid a new global stat multiplier, repeatable Aura Stone faucet, automatic daily checklist, or mandatory ownership of every native role.

## First slice to build next

Start in **Guardian Gardens**, a district that already has routes, scenery, Old Kaio and a local conflict. Target a 10–15-minute outing for a veteran player:

1. Within the first minute, a carried pet notices something near the path. A brief animated reaction makes that companion useful immediately.
2. Kaio offers a practical problem with a visible stake: find a separated beast before the Court's handler clears the garden. Keep setup to a short exchange.
3. Investigate two clues. The player's pets change how the clues are presented; every valid four-pet squad can finish.
4. Meet a named rival. Show the opponent's roles, one readable tactic, and the specific local reward before opening squad selection.
5. Resolve one short Showdown. On a loss, retain discovered clues and allow team adjustment. On a win, show the rescued beast returning and place a memento at Vale Stable.
6. Offer one optional rival rematch with a changed formation. Clearly show what is new and what can be earned once.

This slice validates discovery, pet personality, squad decisions and visible consequences using existing map and battle infrastructure. It is a stronger next investment than expanding the city's dimensions or adding many new currencies.

## Implementation boundaries and acceptance

Field actions and rival admission should have explicit shared definitions. Store milestones, admission and reward proofs through server-owned First Pact progress; never grant rewards from local clue clicks or browser storage. Reuse exact-once settlement and recovery. Version new progress fields through the existing normalizer so older saved crossings remain playable. The vow's sealed pets and names must keep their historical meaning even if the current roster changes.

Use lightweight DOM/canvas animation in the city. Load only the district assets and battle participants needed next. Do not mount a second 3D scene for the stable or field companion. New overlays must fit the phone viewport and leave the point of interaction visible.

Measure the next slice with a small event set: crossing entered, first field action, squad opened, rival started, rival finished, reward viewed and voluntary rematch started. Compare time to first meaningful action, drop-off before the first battle, failure-to-retry behavior and voluntary replay. Ask a few players whether they can explain why they chose their squad and what they want to earn next. No engagement uplift should be claimed before player evidence exists.

Performance acceptance should cover cold entry, sustained walking through district boundaries, entry/exit of interiors, opening squad selection, battle entry, refresh recovery, and return to the city on representative Android hardware. Capture long-task and input-latency evidence as well as screenshots. The remaining memory and district asset work should be prioritized using those profiles.
