# Pet Arena — implementation state

Canonical design: [balance plan](pet-battle-balance-plan-2026-10-10.md).

User authorized implementation of the two-player, 12-pet prototype on 2026-10-10.
Current owner correction: player-facing name stays **Pet Arena**. New ranked
Pet Colosseum matches must be controlled by both players; Beastfront stays
AI-driven on its separate resolver and ladder. Historical ranked receipts keep
their original sealed authority. This supersedes the earlier ranked deferral.

Scope: live PvP from Pet Arena and ranked Pet Colosseum; equal-access loan roster; persisted server
authority; simultaneous private commands; four-pet squads, two active; configurable
moves and competitive allocations; reuse existing cinematic renderer. Sparring is
unrated; ranked records both Pet Elo changes from the committed terminal. No
currency or owned-pet mutations. Existing sessions retain their original rules.

Prototype modules implemented: shared contract/12-pet roster, isolated server
engine and lifecycle, authenticated endpoint, Pet Arena entry, squad builder,
private lead preview and command deck, and cinematic script adapter. Rules are
documented in [the prototype specification](pet-tactics-prototype.md).

Earlier sparring checkpoint: server and production client builds passed. All 140 selected regression
tests pass, including 22 new combat/lifecycle/endpoint tests. Runtime registry
documentation and route wiring checks pass. The final automated two-browser duel
completed 21 rounds with a server knockout draw, locked-order reload recovery,
and desktop/mobile health-panel and command-deck layout checks. It reported no
browser errors or asset failures. The 960-match policy audit and 480-signature
probe are saved alongside browser evidence; no unprepared full-health signature
KOs were observed, and signatures first became available in round four.
No deployment, production KV drill or human playtest is claimed.

Ranked correction implemented: shared session ranked metadata, durable queue
admission, command-controlled ranked token, terminal-only existing Elo settlement,
new ladder host and retained receipt recovery are implemented. Five real
HTTP/auth/storage integration tests pass. The final combined selection has 137
passing combat/ranked/runtime/route/Beastfront regressions. The ranked browser
check completed 14 human-command rounds, with Alice 1012/Bob 988 Elo and one
receipt each; owned pets and currency were preserved. These are local QA accounts.

Latest owner request: remove the empty band above the command menu and integrate
friendly HP and energy into the left pet cards. The preceding visual pass added
original artwork. Portrait pet
selectors, element move cards, stamina/availability text, target cards, action
details and a shared lock footer replace dropdowns. Mobile scroll keeps the
timer and command selectors available; battle intel is a dismissible dialog.
The material layer now uses original blue-black ink/slate artwork, enlarged
curated pet illustrations, painted elemental crests, distinct support glyphs,
bundled display/body fonts and matching health plates. The scene frames itself
above the measured command deck. Friendly HP and energy are integrated into both
left planning cards, removing the duplicate health row and its empty reserved
band; the friendly HUD returns over the arena during playback. Artwork provenance and
the final prompt live in the asset README. The owner rejected the ornate first
background; it and its runtime reference were removed in favor of quiet shinobi
material matching the game's Veiled Steel palette. Another 25 presentation
regressions pass after the final refinement. Fresh desktop/mobile screenshot
review and the final command preview passed with no browser errors or failed
assets. The latest full 14-round ranked browser match also verifies resource
updates after a round and restoration of the friendly HUD during playback.
Mobile framing clears the overhead HUD, and desktop damage details fit
above the lock footer. Redundant style declarations and obsolete historical
admission controls were removed; the private UI namespace is compact. The
production client build, packaged-asset validation and unchanged size gates pass
(9,349,516 bytes of budgeted product JS/CSS against the 9,350,000-byte ceiling).
No deployment or new human playtest is claimed.

Acceptance evidence must distinguish automated simulations and browser operation
from human playtesting. The prototype is a foundation, not a certified full-roster
balance pass. No outside product names belong in repository artifacts.

Latest integration/balance review: ranked search and human battles now lift active
and fullscreen state through Pet Ladder into App guards, chrome and music handling.
Cancelling search releases its guard. Cinematic planning views clear expired
status/weather indicators, and move descriptions match initiative and direct-hit
protection semantics. The selected audit adds navigation/lifecycle checks and
passes 256 tests. The expanded 12,528-match/24,192-signature simulation supports
retaining the experimental numeric configuration; no numeric tuning was promoted.
Storm Hawk/Gale Chick and Granite Tortoise/Abyssal Leviathan remain tuning watch
items under controlled lead substitutions. Full owned-pet direct duels and NPC
rules stay separate from this 12-species balance claim. Findings and reproduction
are in [the review](audits/pet-tactics-prototype/review-2026-10-10.md).
