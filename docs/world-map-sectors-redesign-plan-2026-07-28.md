# World Map & Sectors Redesign (2026-07-28 → 07-29)

Owner ask: the map and sectors looked basic / AI-generated, the sectors read as
mismatched artwork themes, and the whole map should be walkable sector-to-sector
"without using Travel", reorganizing sectors as needed.

**Status: implemented on `claude/world-geo-reorg`.** This document is the record
of what shipped and why. It replaces the original five-phase proposal, which is
superseded in three places: the art style chosen, the numbering approach, and
Phase 5. Owner rulings are marked ⚖.

---

## 1. What the audit found

The plumbing already existed; only the experience was missing.

- `shared/sector-links.ts` held a real road graph (reciprocal, fully connected,
  every sector 2-5 exits), and `api/player/travel.ts` already validated
  `mode:'edge'` crossings against it. Walking worked.
- But the world map **drew none of it** — `SECTOR_ROAD_PAIRS` had zero render
  usage — the sector **names existed only in the art-generation script**, and
  every crossing used the same flat 3 s mask as cross-world map travel.
- Gameplay biome bands contradicted the painted map for ~35 of 60 sectors, in
  **three duplicated copies** of the same band function.
- The 60 floors spanned roughly four different render styles.

## 2. What shipped

**Geography.** `shared/sector-geo.ts` is the single registry: id → name, region,
biome, `artKey`. Sectors were renumbered into contiguous region blocks, each
village's block starting at its own gate — Stormveil 1-8, Ashen Leaf 9-16,
Moonshadow 17-25, Frostfang 26-33, Frost Border 34-35, Midlands 36-45, Castle
City 46-51, Festival 52-54, Hollow Road 55-57, Lavafront 58-60, Death's Gate 99.
Six sectors were added later (61-66). ⚖ *Renumbering approved: "feel free to move
the sectors around and renumber them as long as you keep all the points of
interest."* Every place kept its art, shrine, war membership and roads — pinned by
`api/_sector-geo.test.ts` against a frozen snapshot of the old world.

Coordinates did not move with the numbers, and **art files kept their historical
names**: `artKey` maps a sector to its file, so renumbering renamed no binaries.

**Migration.** Saves self-migrate once on read (`worldGeoV` stamp; currentSector,
pendingTravel, activeRiftQuest), rift seals remap at parse via `geoV`, and
`scripts/migrate-world-geo.mjs` moves `world:territory:*` — dry-run by default,
`--apply` to write, idempotent. ⚖ *The active-war caveat is moot: no live wars or
fights to preserve.*

**Walking.** Edge crossings are **instant** (`WORLD_TRAVEL_EDGE_MS`, default 0)
with a directional slide-in, the avatar walking in from the boundary tile, a
once-per-session region-name splash, painted torii gates on exit tiles tinted by
destination region, and adjacent floors prefetched on entry. Map fast-travel keeps
its 3 s mask. The lease is still minted (presence, footfall and anti-teleport
unchanged); the battle lock, the exact exit-tile check and the rate limit remain
the real guards. ⚖ *Walking must have no travel time; only fast travel does.*
⚖ *In-between corridor areas were proposed and rejected* — they would have
tripled the number of presence areas and diluted the co-presence that makes
players findable to fight.

**Legibility.** `WorldRoadsOverlay` draws the road graph and region plates over
the keyart; sector names appear in marker tooltips, panel headers and exit
labels; hovering a sector glows the shortest walking route to it.

**Art.** One style across all boards, matching the world-map keyart — painterly,
dense brushwork, weathered per-region palette, atmospheric haze — under a strict
overhead camera. ⚖ *Target is the keyart, not the sculpted-3D board look tried
first; top-down with no sky; nothing that clashes with fantasy ninja.* The style
now lives in one place, `scripts/keyart-floor-style.mjs`, imported by every
generator, because divergent copies of it were the root cause of the mismatched
fleet.

**Retired.** The 66 vista scenes and their depth maps (7.3 MB) — the floors made
them unreachable on the default path. The ten shared per-biome boards and their
generator, once Death's Gate got a bespoke board. ⚖ *Retire rather than restyle;
clean it up.* `<SectorScene>` and its stack remain: a territory with its own
custom `backgroundImage` (creator/admin art) still renders them.

## 3. Owner rulings that closed scope

- ⚖ **No earned fast travel / fog-of-war.** Liked, shelved. Map travel stays free.
- ⚖ **No passage gating.** Per-connection level/quest requirements not built.
- ⚖ **No admin connection editor.** The invariants test already catches broken and
  one-way roads at test time.
- ⚖ **Village screens untouched.**
- ⚖ **Tiny staffage figures accepted** on ~10 floors.

## 4. Known residue

- Ashen Leaf has **no bespoke outskirts board**: four attempts (guidance 3.8-4.6,
  torii named as dominant, terrain pinned, guards verified in the prompt) all
  returned a European abbey on a coastal headland. It falls through to its virtual
  sector (13, Headland Woods), which the renumbering made in-region. Re-add only
  via a different technique — e.g. a Kontext restyle of that board — not another
  text-to-image roll.
- **s64 Lantern Vigil** sits slightly more oblique than the fleet average.
- Chest ryo scales with sector number, so renumbering shifted base chest ryo
  slightly. Accepted.

## 5. Prompt laws (each cost a reroll sweep)

Recorded in `scripts/keyart-floor-style.mjs`; the expensive ones:

1. **Negation backfires** — naming what must be absent attracts it.
13. Naming a vertical landmark drops the camera to eye level *with a sky*.
14. The painterly framing pulls **European** architecture unless the East-Asian
    vocabulary is named explicitly.
15. "Silent, still and empty" does not remove figures at this detail density.
17. **The palette clause outweighs the content sentence.** A hardcoded green/teal
    palette repainted every ash field as a green valley — the real reason volcanic
    sectors stayed green across five sweeps. Palettes are per-region now.
18. "moonlit" summons a literal moon, and its sky with it.

Two process lessons worth as much as the laws: **a prompt law only protects the
floors regenerated after it was added** (regenerate the whole fleet, not just the
failures), and **duplicate keys in an overrides object silently win** — verify a
prompt by dumping the whole dry-run to a file, never by truncating it.

## 6. Before merge

1. Rebase onto main and re-run **all** gates — tests, lint, and the full root
   build with the size check (done for the current head).
2. ~~Run `node scripts/migrate-world-geo.mjs --apply` at deploy.~~ **Not needed —
   verified a no-op against production on 2026-07-30.** `world:territory:*` and
   `world:war:*` were both **0 rows**, because those keys are only written by a
   resolved village war or clan capture and none had ever run. The script is kept
   for the record and is idempotent, so it remains safe to run; it just has
   nothing to do. Every other sector-numbered key migrates itself:
   `settleSaveRecord` remaps saves on read (confirmed live — `save:rill` came back
   stamped `worldGeoV: 2` after the deploy), rift seals remap at parse via `geoV`,
   and footfall / trail-signs expire on their own TTLs.
3. Owner feel-check: walk village gate to the Lavafront without touching Travel,
   plus two-client visibility and mobile touch.

## 7. Post-deploy verification (2026-07-30)

Production ran commit `3a433df5e` (confirmed via `/health`). Against the live
database: 109 saves, of which 100 sit at sector 0 (in-village, `remapLegacySector(0)
= 0`, a true no-op), 6 carry no sector field (early return), and 2 sit at old
sectors 1 and 7 — remapping to **51 East Ring Road** and **58 Cinder Foothills**,
both in-region. 37 saves carry a `pendingTravel` whose `destinationSector` remaps on
the same read path. `character.currentSector` is absent on every record, matching
the invariant that `currentSector` is a **top-level** save field.

Operational note for the next migration: this one needed the production
`DATABASE_URL`, which is not on the dev machine, and passing it through a terminal
proved error-prone. The Supabase MCP connector is the right tool — read-only SQL
answers "is there anything to migrate?" in one query, before any credential
plumbing. **Check whether a migration has rows to move before building a way to
run it.**

## 8. Connected floor artwork revision (2026-10-07, local)

Owner direction extends the approved sector 31 combat-floor presentation to all
65 normal sectors. Sector identities, road destinations, village ownership,
save IDs and travel costs retain their existing definitions. Four village
outskirts contain their village at the center, with a southern approach and the
existing member entry flow. Strongholds and six shrines follow their canonical
membership; other sectors have no placeholder building pads. Quest rifts remain
temporary overlays on accessible terrain.

The local paintings and associated 12×12 walk masks live in
`shared/sector-floor-layout-data.json`, exposed through
`shared/sector-floor-layouts.ts`. Authoring begins with actual exits and landmark
approaches, removes unused construction routes, and validates connected walking
ground. Each of the 93 road pairs shares an edge lane, width and stone-material
contract. Coherent ponds, rivers and coastal inlets replace repeated square
water tiles; bridges cross the authored river channels. Individual terrain
motifs and regional planting distinguish sectors within the common overhead
art direction. Complete scenes bake in their permanent landmarks; small labels
provide player identification and interaction.

Movement uses shared walkability and four-neighbor paths. The server refuses
blocked positions before emitting presence changes, and grounds restored or
arrival positions on accessible terrain. Client movement and actor presentation
use the same masks. `DISABLE_SECTOR_OBSTACLES=1` restores legacy movement and
arrival behavior; the public sector-layout endpoint exposes the flag so the
client can follow it. This revision introduces no storage migration, reward
change or combat-rule change.

All 65 normal paintings and the separate sector 99 arena are now admitted in
the isolated worktree at 1024×1024 within the original 250 KiB per-floor cap,
without edge cropping. The fixed 38 normal artwork repairs are closed. Each
current painting has full-size physical review covering all 144 cells; all 93
current reciprocal road pairs are reviewed. Automated delivered-pixel checks
report zero critical alignment findings, zero boards above the interior
allowance and zero failed seams. The 66-board guide test checks 9,504 centers.
These checks supplement physical inspection rather than replacing it.

The owner selected native composition and baking on 2026-10-06, explicitly
authorizing generated shinobi buildings and terrain to be placed precisely and
baked into one complete map image. This supersedes the earlier requirement for
whole-image-only final paintings; no alternative renderer or tileset is shipped.
Seven rejected whole-image attempts are historical, and further blind retries
were stopped. The accepted architecture uses overhead Japanese tiled roofs,
distinct fortified gates and sacred shrine silhouettes, with contained identity
details. Native recipes preserve the layout and actual neighboring road mouths.
The production method is authorized; final owner visual acceptance remains a
separate checkpoint.

Guides rebuild from the current layout and frozen, hashed inputs. Review proofs
bind painting, mask and enlarged sheets so stale images cannot certify a new
floor. Neighbor crops finish extraction before mirroring, and independent pixel
tests cover actual reverse mouths and adjacent exits. Admission validates this
ancestry, current semantic approval and delivered image hashes before copying.
Ten transparent regional quest-rift overlays remain 256×256.

Sector 99 remains map-travel-only. Its continuous lava channel and Obsidian
Stronghold are paired with a connected walk mask and an accessible south gate.
Its twelve stronghold rooms and existing PvP multipliers retain their behavior.

The current integration base is main revision
`ee85c880eb939d128e906e2413f0785e1dc4864a`; main's day/night lighting, sector chat
and arrow controls are preserved. Browser delivery omits only the registry's
authoring names, road diagnostics and hydrology metadata; collision, villages,
landmarks and full cache hashes stay exact. Build-only removal of obsolete model
records likewise preserves all selected live model payloads and original source
assets. Delivery limits are unchanged.

Exact prompts, sources, recipes and delivered hashes are in
`docs/art/connected-sector-world-provenance.json`. Current validation, desktop
and phone review, performance evidence and remaining release gates are owned by
`docs/handoffs/connected-sector-world-work-state.md`. This addendum records local
delivery; nothing is merged or deployed, and final owner acceptance is pending.

Owner road-travel revision, 2026-10-07: remove the torii exit symbols and
permanent glowing exit squares. Painted roads identify crossings. Clicking an
exit first walks the avatar around obstacles to the road mouth; actual arrival
starts authoritative edge travel. New movement cancels the approach. Keyboard
crossings use the same completion. The self marker pans with its floor, lands
at the exact reciprocal entrance and stops. Destination hints remain available
to assistive technology and hover/focus. This supersedes the earlier marker
treatment without changing roads, artwork, saves or server travel timing.
Updated browser validation is tracked in the current work-state handoff.

Recorded-gameplay correction, 2026-10-07: one player marker bridges the outgoing
road mouth and incoming arrival throughout the camera pan. Incoming NPCs and
building labels follow their floor. Actual quiet testing exposed a queued
presence frame overwriting a newer tile; accepted movement now updates that
queued frame. Road crossing confirms the exact sector/tile through the existing
App heartbeat handler, which keeps its normal inbox and session processing.
Actual desktop and phone journeys pass with both Socket.IO and the HTTP-only
fallback. The current final gates certify this corrected artifact.
