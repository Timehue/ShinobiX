# Celestial Tower: The First Pact

## Mode identity

The First Pact is the level-100 premier single-player Pet Colosseum RPG. The Celestial Tower opens a fixed temporal crossing into the Sunken Court's last age and carries the player and their current companions into the actual past. It is not a reconstructed refuge. The Court's collapse remains fixed, but the campaign can change which people, names, and records the first scribes preserve before it happens.

The combat format is fixed at four player pets: two begin active and exactly two wait in reserve. Every campaign and tournament opponent uses the same 2v2-plus-two-reserve Showdown format.

## Player-facing loop

1. Open the Celestial Tower in Central Hub. Characters below level 100 see the sealed entry.
2. Cross into the Sunken Court and freely traverse one continuous top-down tile world.
3. Follow Scribe Vey's Chronicle through three investigations and three server-sealed pet confrontations.
4. Optionally help Sena Vale preserve her stable by winning a three-round tournament.
5. Return to the Arrival Court after defeating the Balanced Court and complete the three-part epilogue.
6. Re-enter the fixed crossing after completion to revisit the city and its people.

Desktop supports WASD, arrow keys, click-to-path, `E`, and Space. Mobile exposes a five-button directional/interact pad. The tracked objective can calculate a path to the next story actor, and the minimap shows the entire connected court, the player, citizens, and objective destination.

## Connected world

The authored world is an 84×56 tile map. Every walkable tile is flood-fill reachable from Arrival Court; the connectivity test rejects isolated walkable islands.

| District | Primary purpose |
| --- | --- |
| Arrival Court | Celestial threshold, campaign entry, and epilogue return |
| High Court | Scribe Vey and the unedited Chronicle |
| Bell Quarter | Frightened-bell omen |
| Guardian Gardens | Empty-sky omen |
| Aqueduct | Impossible-current omen |
| Grand Colosseum | Main Court confrontations and Vale tournament |
| Kennel Ward | Sena Vale and the stable side quest |
| Market & Scriptorium | Civilian texture and supporting dialogue |
| Gateworks | Engineer Tam and the learning-lattice confrontation |

Static NPCs hold authored story positions. Wandering NPCs choose deterministic, reachable destinations inside district bounds, pause at destinations, and treat the player and other actors as temporary blockers.

## Chronicle campaign

| Chapter | Exploration/story gate | Battle gate | Result |
| --- | --- | --- | --- |
| I — A City Still Breathing | Meet Vey; preserve the Bell, Gardens, and Aqueduct omens in any order; report all three | — | The Court can no longer separate the warnings into harmless rumors |
| II — The Courtesy of Teeth | Enter the omens; confront the Menagerie; recover the Withheld record | Court Menagerie | Reveals that the first handlers asked their companions to witness them |
| III — What the Gate Keeps | Carry the record to Tam; open the old Gateworks route; name all four companions as witnesses with Sena | Lattice Wardens | Reconstructs the original pact as consent rather than ownership |
| IV — Four Wills, One Answer | Return to the Grand Colosseum | Echo of the Balanced Court | Opens the return to the threshold and epilogue |

Before the final battle, the player chooses one of three pact promises. The server stores exactly one answer. Each answer connects the bond to the four qualities taken by the modern village anchors: reason, future, exit, and trust. The Court uses that promise against the formation in the final confrontation, and the return-to-present epilogue remembers it.

## Main-story continuity contract

- The Sunken Court is a human civilization and the Court is its civic optimizer. Neither is a creature, god, spirit, or portal.
- The lattice beneath the Gateworks is the civic infrastructure the modern world calls Hollow Gate. The four village anchors do not exist yet, though their intake rules begin here.
- The Withheld are people who refuse cession of a defining choice. They are not ancestors living inside the player, a bloodline, or a source of chosen-one power.
- Bonded beasts are living witnesses with independent choices. The First Pact does not place a soul or living creature inside a Chronicle card.
- Vey is one of the first scribes preserving records during the Court's last age. The player helps one record survive but does not create the Chronicle, a Legacy, or the Withheld.
- The player cannot prevent the fall, found a hidden sanctuary, or replace the main story's four village endings. The fixed crossing preserves individual proof while the present-day ruins and macro-history remain unchanged.

Story transitions are ordered. The browser can request a beat but cannot skip its predecessor. Wins are bound to their exact Showdown session proof and settle once even when the finishing response is retried.

## Side quest: A Stable's Last Stand

Sena Vale asks the player to preserve Vale Stable's place in the record. Accepting or completing the side quest never changes main-campaign routing.

| Round | Opponent | Tactical lesson |
| --- | --- | --- |
| Qualifier — The Open Sand | Copper Jackals | Establish the 2v2 formation and reserve timing |
| Semifinal — Weather in the Ring | Rainbell Menagerie | Read arena weather and rotate reserves |
| Final — A Name Worth Keeping | The Gilded Fang | Break the champion's protection pattern before its signature turn |

Three wins mark the stable saved. Losses do not consume the round; the same encounter remains open for a new four-pet formation.

## Progression and recovery

- Court Standing records permanent campaign and side-quest progress in the First Pact server state.
- The Chronicle journal exposes the current chapter, completed chapters, preserved omens, Court Standing, and Vale Stable status.
- World position checkpoints when changing districts and on normal exit.
- Checkpoint districts are derived from shared world coordinates on the server; a saved tile made obsolete by a map revision is repaired to the nearest legal, unoccupied tile on load.
- Campaign progress persists for five years and is normalized before use.
- An unfinished Showdown stores a short browser breadcrumb and a server session. Refresh resumes the exact fight; a finished fight whose response was lost can be reclaimed and settled safely.
- The recovery breadcrumb is retained across transient state or settlement failures, and bound-fight sidecars renew with the same sliding 45-minute lease as their Showdown session.
- Forfeit records a server loss before clearing the recovery breadcrumb. If recording fails, the recoverable fight stays open and the player receives a retryable error.

## Authority boundary

The client owns presentation: tile rendering, pathfinding, ambient NPC movement, dialogue display, camera, minimap, and cinematics.

The server owns access and progress: stored character level, the expected story/tournament encounter, the four distinct carried and available pets, opponent construction, battle commands and outcome, ordered Chronicle beats, Court Standing, battle proofs, and exact-once settlement. First Pact fights are never eligible for the ordinary Pet Colosseum currency faucet.

Production routes:

- `POST /api/first-pact/state` — state, entry, ordered story beats, side-quest acceptance, and world checkpoints.
- `POST /api/pet/showdown` with `action: "first-pact"` — encounter admission; normal Showdown `state`, `turn`, and `forfeit` actions own the fight lifecycle.

## Art package

- Sunken Court cinematic key art.
- Authored 4×4 top-down environment atlas with deterministic sub-crops for non-repeating floors.
- Purpose-built 4×4 transparent exterior architecture atlas: High Court archive, civic homes, record halls, stable and kennel compounds, market arcades and stalls, garden pavilion, Bell Tower, and cyan-lit Gateworks buildings.
- Purpose-built transparent Grand Colosseum with a walkable central sand floor and four gates aligned to the collision-authoritative north, east, south, and west entrances.
- Purpose-built 4×4 transparent street-dressing atlas used for eight story-relevant landmarks: an archive notice, garden fountain and tree, Vale Stable equipment, a market cart, and exposed waterworks machinery. Repeated decorative props are intentionally omitted so the public routes remain visually quiet.
- Eighteen registered architecture placements carry explicit tile collision masks derived from their rendered alpha silhouettes. Movement, click-to-path, wandering AI, and the minimap consume the same walkability result, so visible buildings cannot be crossed and transparent gaps remain part of the street network.
- Exterior rendering uses continuous material sampling across neighboring tiles, outlined civic curbs, cyan water boundaries, a lit city-shelf edge, and a short eased camera glide. Reduced-motion users receive an immediate camera.
- Ten individual cast portraits covering every named static and wandering NPC.
- Source atlases, generation briefs, and deterministic Sharp processing scripts remain beside the production assets.

## Verification

Run from the repository root unless noted:

```text
npx tsc -p tsconfig.cpanel.json --noEmit --pretty false
node --import tsx --test api/pet/showdown.first-pact.test.ts api/first-pact/state.test.ts shared/first-pact-contract.test.ts
node --import tsx --test shinobij.client/src/lib/first-pact-wiring.test.ts shinobij.client/src/lib/first-pact-world.test.ts
npm run check:runtime-mode-docs
```

Run from `shinobij.client`:

```text
npm run build
npm run check:first-pact-exteriors
npx vite build --config scripts/vite.first-pact-qa.config.mjs
npx vite preview --config scripts/vite.first-pact-qa.config.mjs --host 127.0.0.1 --port 5186 --strictPort
node scripts/verify-first-pact-visual.mjs http://127.0.0.1:5186
```

The browser verifier covers exterior views of High Court, Guardian Gardens, Kennel Ward, Market & Scriptorium, Gateworks, Bell Quarter, the Aqueduct, and the Grand Colosseum; start/in-motion/settled camera frames; grounded player/NPC pins; desktop dialogue and Chronicle; the four-slot tournament formation; keyboard-operable mobile controls; mobile crossing and level lock; the three-option pact scene at desktop and mobile sizes; the Court's final argument; recoverable loading failure; every pact-specific epilogue callback; and desktop/mobile epilogues. It also fails on missing architecture, Colosseum, or street-dressing resources; console errors; blank canvases; missing portraits; viewport overflow in the pact scene; malformed formations; and serious or critical accessibility violations.
