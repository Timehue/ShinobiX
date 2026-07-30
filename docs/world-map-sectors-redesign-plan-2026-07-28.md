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
2. Run `node scripts/migrate-world-geo.mjs --apply` at deploy.
3. Owner feel-check: walk village gate to the Lavafront without touching Travel,
   plus two-client visibility and mobile touch.
