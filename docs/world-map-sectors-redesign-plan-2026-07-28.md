# World Map & Sectors Redesign Plan (2026-07-28)

Owner ask: the main map and sectors look basic / AI-generated, the sectors read as
mismatched artwork themes, and the whole map should be traversable sector-to-sector
("without using Travel"), reorganizing sectors as needed. This plan is based on a
code audit of the live systems plus outside research on how respected games build
screen-based connected worlds (sources at the end).

---

## 1. Diagnosis — what is actually wrong

The surprising audit result: **most of the hard infrastructure already exists.**
The world has a real road graph, server-validated edge crossings, and 60 bespoke
painted sector floors. What's missing is presentation, consistency, and incentive —
the craft is invisible and the styles drift.

### 1.1 The world is connected, but nobody can see it
- `shared/sector-links.ts` defines all 60 sector positions (`SECTOR_POINTS`) and a
  **frozen reciprocal road graph** (`SECTOR_ROAD_PAIRS`, 80 roads). Verified by
  script: fully connected, every sector has 2–4 roads, median road length is sane,
  world diameter is 18 crossings (s26 Western Piers → s48 Needle Spires).
- Edge-walking is **already live end-to-end**: road-exit tiles render on the 12×12
  sector board (arrow + "S23" chips, `WorldMap.tsx:3253`), WASD/click onto the exit
  crosses sectors, and the server validates the exact crossing against the shared
  graph (`api/player/travel.ts` `mode:'edge'`, `edgeTravelExit`).
- **But the world map never draws the roads** — `SECTOR_ROAD_PAIRS` has zero client
  render usage. Players see scattered numbered dots on a painting, so the world
  reads as a teleport menu, not a place.
- **Sector names exist and are never shown.** Every sector has an evocative
  identity ("Falls Overlook", "Canal Heart", "Cinderfrost Divide") — but only inside
  the art-generation sheet (`shinobij.client/scripts/sector-art-data.mjs`). The UI
  says "Sector 23" everywhere. This alone is a huge "AI made this" signal.

### 1.2 Crossing feels identical to teleporting
- Every travel — one step to a neighbor or across the whole world — is the same
  flat **3s mask** (`WORLD_TRAVEL_MS`, `api/player/travel.ts:18`) with the same
  loading treatment. Walking has no feel of motion or continuity.
- **Map-click travel is free, instant (3s), and unrestricted** to any of the 60
  sectors. Research calls this the Oblivion problem: when teleport-anywhere is
  free, roads become dead content and the world feels small. Our roads are exactly
  that today.
- Arrival tiles are already reciprocal (you appear one tile inward on the matching
  edge) — good bones — but there's no directional transition, and the painted paths
  in the art don't lead to the exit tiles.

### 1.3 The art is four styles pretending to be one
Spot-checked floors (all `public/sector-map/s<N>.webp`):
- s42 Heartwood Shrine (forest): flat storybook cartoon, thick outlines, cel shade.
- s27 Canal Heart (harbor): stylized-**3D render** look, no outlines, realistic water.
- s58 Walled Garden (castle): semi-3D, candy-bright, outlined foliage + dimensional buildings.
- s49 Highpass Peaks (snow): full **3D-render** look, sculpted cliffs, glossy ice.
- s16 Moongrotto (moonshadow): soft airbrushed 2D illustration, no outlines.

The July art-QA pass enforced *content* rules (no stray people, no watermarks, no
faux-kanji) but never enforced a *style lock* — FLUX drifts render style with
subject vocabulary (architecture/water prompts pull a 3D look, forest prompts pull
storybook). The world-map keyart is yet another style (dense hyper-saturated
anime keyart with garbled AI banner text). This is precisely the owner's
"different artwork themes" complaint.

### 1.4 Three copies of a wrong geography
`biomeForWorldSector` exists in **three places** with the same numeric bands
(1-20 shadow, 21-35 forest, 36-45 volcano, 46-55 snow, 56-60 central):
- `shinobij.client/src/data/sectors.ts:38`
- an inline copy in `WorldMap.tsx:2105`
- server `api/_elapsed-state.ts:39` (`biomeForSettledSector`, writes `currentBiome` on travel settle)

The bands **contradict the painted map** the art was generated from
(`sector-art-data.mjs` classifies by actual map position): the Ashen Leaf *forest*
region (s36-43) is coded "volcano"; the Stormveil *harbor city* (s21-34) is coded
"forest"; the actual volcano sectors (s2, s7, s51, s52) are coded shadow/snow.
Roughly **35 of 60 sectors carry the wrong biome label**, which drives visible
wrongness: weather rotation, ambience fallback, combat-backdrop choice, and the
per-biome jutsu-type multipliers (`api/combat-core/formulas.ts:220`). The display
layer already papers over it with `SECTOR_ART_AMBIENCE` (`src/data/sector-ambience.ts`)
— gameplay still uses the bands.

What realignment does **NOT** touch (verified): the +10% home-terrain PvP buff is
keyed to clan-owned `world:territory:<sector>` records (`api/pvp/session.ts:1353`),
not biome; village war zones and shrine/trace KV keys are sector-number-keyed and
sector numbers never change.

### 1.5 Small defects found along the way
- `WorldMap.tsx:226` — the legacy biome-board fallback returns a literal
  `\sector-map\${biome}.webp` (escaped `$` in a template literal → broken URL).
  Near-dead path since all 60 sectors have bespoke floors, but it's a landmine.
- Only Stormveil has a bespoke village-outskirts board; the other three villages'
  Outer Territory pages reuse a wild sector's floor.
- Close-but-unlinked pairs worth a deliberate decision: 57–59 (castle, blocked by
  the keep — probably intentional), 22–27 (Stormveil terraces↔canals — likely a
  missing road).

---

## 2. What the research says (condensed)

Full report with sources in §7. The patterns that matter for us:

1. **Albion Online is our shape**: discrete zones + physical edge exits + a world
   map that renders the zone graph as contiguous regions with a danger/status
   overlay. No seamless streaming needed — presentation does the work.
2. **Zelda / Link's Awakening seam rule**: adjacent screens must share a
   continuing feature (road, river, treeline) across the edge; where two art
   themes are incompatible, insert a *buffer/transition* screen that uses only
   shared vocabulary, or wall that edge and route around. (Our art sheet already
   invented these ecotones — s51 Cinderfrost Divide, s55 Icefall Cliffs, s7 Cinder
   Foothills, s12 Waymarker Road, s19 Jade River Bridge — they're just unlabeled.)
3. **Pokémon route identity**: connective screens get names, encounters, purpose —
   never filler.
4. **Fast travel is earned by feet** (Diablo waypoints, WoW flight masters,
   CrossCode landmarks): local movement free and instant, long-range travel only
   to waypoints you've physically visited. Oblivion (free teleport everywhere,
   pre-unlocked) is the cautionary tale — players never saw its roads.
5. **AI-art consistency at scale**: lock the style *before* generating (one
   camera, one light, one palette-ramp system, one locked style block / style
   anchor image or trained style model), then generate each region as **one
   oversized master canvas sliced into sector tiles** so edge continuity is
   guaranteed by construction, not prompting.
6. **Hand-crafted map feel** = stylized cartography: region labels with real
   typography, drawn roads/rivers, POI stamps, parchment fog over unvisited areas
   (static reveal), tiny brush-styled live markers.

---

## 3. The redesign — five shippable phases

Sector **numbers, KV keys, and art filenames never change** in any phase. Nothing
here rewrites the travel-lease/presence machinery — it all builds on it.

### Phase 1 — Name the world & draw the roads (legibility; zero balance risk)
The cheapest, highest-leverage phase. Client-only.

1. **Promote names/regions to runtime data**: new `shared/sector-names.ts`
   (id → `{ name, region, regionDisplay }`) lifted from `sector-art-data.mjs`
   (10 regions: Ashen Leaf Deepwood, the Midlands, the Lavafront approaches,
   Frost Border, Frostfang Reach, the Castle City, the Hollow Road, the Festival
   Grounds, Moonshadow Wilds, Stormveil Harbor). Test: 60/60 coverage, unique
   names, region sets match the art sheet.
2. **Show names everywhere numbers show today**: world-map tooltips + selected
   sector header ("Falls Overlook — the Midlands · S23"), road-exit chips
   ("→ Blossom Grove"), travel toasts, trace/trail-sign sheets, admin picker.
3. **`WorldRoadsOverlay` component**: SVG curves over `.generated-world-map`
   drawn from `SECTOR_POINTS` × `SECTOR_ROAD_PAIRS` — ink-brush stroke, subtle
   dashes, brighter on hover/route; region name labels in a display face; a
   "you are here" pulse. The invisible graph becomes the map's hero feature.
4. **Cartographic skin**: parchment frame, legend, and styled label plates
   overlaid on the four painted village banners (covers the garbled AI text
   without touching the keyart).
5. Fix the `WorldMap.tsx:226` fallback-URL bug while in there.

Flag: `worldNames.v1` default ON with "off" kill switch (per ship-on convention).
New CSS in a new file (do NOT re-order `index.css` parts — see CSS manifest memory).

### Phase 2 — Make crossing feel like walking (travel UX)
1. **Server**: edge crossings get a short duration — `WORLD_TRAVEL_MS` stays 3000
   for map travel; `mode:'edge'` uses ~800ms (env `WORLD_TRAVEL_EDGE_MS`, default
   800). Lease semantics identical (still minted, still authoritative, still
   anti-teleport; a shorter untouchable window is strictly safer). Client already
   masks on the server-sent duration (`travelMaskMs`), so this is a small diff in
   `api/player/travel.ts` + tests.
2. **Directional slide transition** for edge crossings: current board slides out
   opposite the walk direction, neighbor's floor slides in; avatar auto-walks 2-3
   tiles in from the edge (arrival tile is already the reciprocal inward tile).
   `prefers-reduced-motion` → crossfade. The 3s mask remains only for map travel.
3. **Prefetch neighbors**: entering a sector warms its 2-4 adjacent floors
   (existing `preloadImg` pattern at `WorldMap.tsx:2180`).
4. **Painted gates instead of arrow chips**: per-region transparent gate standees
   (torii, rope bridge, ice arch, dock gate…, ~10 assets via the shrine-standee
   pipeline) placed at exit tiles, with the destination *name* on hover/tap.
   Standee lessons from the shrine work apply (self-contained CSS, never
   `.atlas-landmark`, drop-shadow grounding).

Flag: `worldWalk.v1` default ON; server env default keeps behavior safe if unset.

### Phase 3 — One geography (biome realignment; needs owner sign-off)
1. **Single source of truth**: add the per-sector biome table to `shared/`
   (promote `SECTOR_ART_AMBIENCE` to gameplay truth), make all three band
   functions read it (signatures unchanged), delete the duplicates' logic.
2. **The diff is big and honest**: ~35 sectors change biome label (Stormveil
   harbor 21-35 forest→central, Ashen Leaf 36-43 volcano→forest, midlands/castle
   ring 1/9/10/14/20/44/45 →central, true volcano 2/7/51/52 →volcano, frost
   border 3/55 →snow). Per-sector consequences to sign off: weather rotation,
   combat backdrop, ambience, and the per-biome jutsu-type multiplier
   (`formulas.ts` — this is the balance-relevant column; today those multipliers
   are assigned by arbitrary numeric band, so realignment makes them *coherent*,
   but it IS a combat change on those sectors).
3. Explicitly unchanged: home-terrain buff (territory-based), sector-99 rules,
   village war-zone numeric groupings, all KV keys. `sectorRegionName()` flavor
   strings update to match ("the Stormveil tideways", not "forest territory").
4. Optional later: a 6th `coast` biome for Stormveil with its own weather table +
   backdrop + multiplier — richer but touches `Biome` type across client/server;
   recommend shipping 5-biome realignment first.

Tests: client/server table-parity test + a snapshot of the full 60-sector
old→new diff committed next to the change.

### Phase 4 — One art style (regen behind a locked style bible)
1. **Style bible before any generation**: pick ONE rendering — recommend the
   outlined painterly top-down of s42/s58 (most map-like, matches the board
   overlay) — one camera (top-down, mild ¾), one light direction (NW), one global
   palette with per-region ramps, locked style block + 2-3 anchor images used as
   style references for every batch. The 3D-render outliers (Stormveil harbor,
   Frostfang snow, scattered others) are the regen priority; storybook-style
   regions may survive v1.
2. **Region master-canvas slicing for seams**: per region, generate one oversized
   canvas laid out to that region's sector adjacency and slice each sector's tile
   out — edge continuity (roads/rivers/treelines crossing the seam) comes free.
   Where regions meet, include a strip of the neighbor's edge as img2img
   reference (the Link's Awakening buffer, automated). Fallback where slicing
   fights a sector's identity: per-sector regen with **programmatic edge
   phrases** derived from `SECTOR_EXITS` ("a dirt road runs off the north edge",
   "turquoise sea fills the west edge") appended to `floorPromptFor()`.
3. **Reuse the proven pipeline**: `gen-sector-art.mjs` + the FLUX prompt laws
   from the July QA (positive-only phrasing, no text-carriers, staffage traps),
   baked edge-crop, resumable, per-sector overrides. Budget same order as last
   time (~$15-25 fal).
4. **Landmines honored**: shrine-sector floors (42/34/53/16/13/10) keep their
   empty clearings and get standee-placement re-QA; `s35.webp` (real Cactus
   Flats) never overwritten; generate the 3 missing village-outskirts boards
   (`gen-village-outskirts.mjs`) and retire the legacy 10 biome boards from the
   resolver.
5. **World map last**: the keyart stays the anchor through P1-P3 (labels cover
   its text artifacts). Optionally regenerate it at the end in the same locked
   style — or better, *composite* it from the new region masters so map and
   sectors are literally the same art.

### Phase 5 — Make the walk worth it (pacing + discovery; owner-priced)
1. **Fast travel becomes earned**: map-click travel only to *discovered anchors*
   (4 village gates, 6 shrines, Festival, Death's Gate when unlocked); edge
   walking is the free default. Needs `visitedSectors` on the save — written
   server-side in the travel-settle path (where footfall already increments,
   `api/_realtime/travel-lease.ts` `settleTravelLease`), added to the save DTO
   allowlist; grandfather existing saves by seeding their home region + current
   sector. This changes pacing, not power (balanced-PvP pillar intact), but it
   is the one genuinely player-visible removal — ship behind a flag and let the
   owner pick the default.
2. **Parchment fog** on the world map for unvisited sectors (static reveal from
   `visitedSectors`) — turns walking the world into a completion meta for free.
3. **Roads as content**: bias wanderer/quest-giver weights toward connective
   sectors (`lib/wanderers.ts` weights exist), first-visit name-splash flourish,
   and later a danger-tier tint on the map (war overlay already tints ownership).

---

## 4. Compatibility & invariants checklist (all phases)

- **Never change**: sector ids; `world:shrine:*` / `world:footfall:*` /
  `world:territory:*` keys; `s<N>.webp` filenames; s35 art; s99 map-travel-only;
  sector-0 safe-zone semantics; shrine ids.
- **Coordinates are load-bearing**: `SECTOR_POINTS` feeds marker layout AND
  derived exit directions/tiles (`directionFromTo`). Any coord nudge re-derives
  exits → add a graph invariant test (connected, reciprocal, 2-4 degree, exits
  stable) — none exists today.
- **Travel contract**: client must keep sending the exact `originTile`/`exitId`
  for edge mode; lease-authority rules in `online-store.upsert` and the
  heartbeat reconcile (`lib/sector-reconcile.ts`) stay untouched.
- **App.tsx ratchet (8441)**: everything new lives in modules/components under
  `src/{components,lib,data}` or `shared/`.
- **CSS**: new files (imported by the screen), never re-ordering `index.css`
  manifest parts; combat-CSS split lesson applies.
- **Tests before done** (per repo rules): root `npm test` + client lint; new
  unit tests per phase (names coverage, graph invariants, travel durations by
  mode, biome parity snapshot); e2e feel-check via the preview harness with two
  accounts for a live crossing.
- **No competitor references** in code, prompts, commits, or docs.

## 5. Suggested order & rough effort

| Phase | Ships | Effort | Risk |
|---|---|---|---|
| 1 Names + roads overlay | instantly visible craft | ~1 session | none (client, flagged) |
| 2 Walking feel | 800ms edge slides, gates | ~1-2 sessions | low (small server diff) |
| 3 One geography | coherent weather/backdrops | ~1 session | needs balance sign-off |
| 4 One art style | style-locked regen by region | multi-session + ~$15-25 gen | medium (QA cycles) |
| 5 Earned fast travel + fog | pacing + discovery meta | ~1-2 sessions | owner call on default |

1→2 can land the same week and already deliver the owner's "travel the whole map,
connected" feeling. 3 is a data change wearing a balance hat. 4 is the big visual
payoff. 5 is the retention layer.

## 6. Open questions for the owner

1. **Style pick for Phase 4**: lock to the outlined painterly look (s42/s58), or
   supply a new reference image to anchor the bible?
2. **Fast-travel gating default** (Phase 5): ON for everyone, or soft-launch OFF?
3. **Stormveil biome**: accept `central` in Phase 3, or invest in a 6th `coast`
   biome (weather/backdrop/multiplier design needed)?
4. **22–27 road**: add the missing Stormveil terraces↔canals link?

## 7. Research sources

Screen connectivity: gridbugs.org (Zelda scroll), zladx.github.io (Link's
Awakening tileset buffers), Pokémon route analyses, PCGamesN (Stardew), Medium
(Hyper Light Drifter map), CrossCode wiki. Zone MMOs: EverQuest zones wiki, Albion
Online travel/zone docs + interactive map. Biome layout: Red Ragged Fiend, Anima
cartography, World Anvil, Kotaku/GameDeveloper/GMTK (BotW triangles), theme-park
"weenie" design articles. AI-art consistency: Scenario style-model docs, Summer
Engine 2026 guide (master-image slicing), spritesheets.ai / PixExact workflows.
Map UI: GameRant map-UI roundup, Game UI Database, aerosys fog-of-war docs, HLD
map analysis. Travel friction: samlowe.dev (Morrowind), Stray Pixels + ResetEra
(Oblivion fast travel), Albion travel, unmappedworlds counterpoint.
