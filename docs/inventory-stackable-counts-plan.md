# Plan — Stackable items as counted stacks (Option B)

**Status:** PROPOSED — needs owner approval before any code (changes the save
shape; CLAUDE.md Hard Rule).
**Goal:** Stop the "items into the void" bug by storing stackable / non-unique
items (consumables, throwables, scrolls, dungeon shards, pet food/gear) as a
single counted entry each, so they no longer consume the 500-entry inventory cap
and no longer bloat the save payload.

---

## 1. Problem recap

- `Character.inventory` is a flat `string[]` — **one array entry per physical
  item** ([character.ts:146](../shinobij.client/src/types/character.ts)).
- The only cap is server-side: `INVENTORY_CAP = 500`, enforced as
  `inventory.slice(0, 500)` on save
  ([api/save/[name].ts:450](../api/save/%5Bname%5D.ts)). `slice` keeps the
  **oldest** 500 and silently drops the rest. New items are appended to the end,
  so the **newest** items are the ones lost — with no warning to the client.
- Stackable items (many duplicate strings) are exactly what fills the array,
  while non-unique gear is the dominant cap-eater.

## 2. Target data model

Add one top-level field to `Character`:

```ts
// character.ts — alongside `inventory: string[]`
/** Counted stacks for non-unique items (consumables, throwables, scrolls,
 *  pet food/gear, dungeon shards). Keyed by item id → quantity. Items here do
 *  NOT live in `inventory` and do NOT count toward the inventory cap. */
itemStacks?: Record<string, number>;
```

Rationale for a `Record<string, number>` (id → count):
- O(1) count/own lookups (replaces the `inventory.filter(i => i === id).length`
  pattern used in ~20 places).
- Compact JSON (47 shuriken = `{"thrown-shuriken":47}`, not 47 strings).
- Mirrors the existing counted-stack precedent `TreasuryItemStack` +
  `cleanTreasuryItems/addTreasuryItem/removeTreasuryItem`
  ([lib/items.ts:89](../shinobij.client/src/lib/items.ts)). (Treasury uses an
  array of `{itemId,count}`; we use a record for cheaper lookups — note the
  divergence in code comments.)

`inventory: string[]` stays, but holds **only unique / equippable gear**
(weapons, armor, accessories, the Aura Sphere, named forge items, etc.).

### What counts as "stackable"

Driven by the **existing** `stackableItemIds` set
([pet-config.ts:105](../shinobij.client/src/data/pet-config.ts)). It already
contains: all `petFeedItems`, `petPveGear`, `petConsumables`,
`TERRITORY_CONTROL_SCROLL_ID`, `hollow-gate-key`,
`dungeon-legendary-fragment`, `veil-of-the-hollow`.

**Decision needed (§9):** the items players hit the cap with most — throwables
and combat pills — are **not** in that set today. Proposed additions:
`thrown-shuriken`, `thrown-senbon`, `thrown-serpent-dust`, `item-smoke-bomb`,
`item-attack-pill`, `item-defense-pill`, `dungeon-key` (`DUNGEON_KEY_ID`),
`LEGENDARY_WAR_CRATE_ID`, `WARFORGED_RELIC_ID`, and the name-keyed
`"Soldier Pill"` / `"Chakra Pill"`. (Name-keyed entries need a normalize
special-case — see §4.)

## 3. New centralized helper module

Create `shinobij.client/src/lib/inventory.ts` (and a tiny server twin or shared
import) so no call site pokes at the raw arrays. Keep `lib/items.ts`'s existing
exports as **thin wrappers** for backward compat (Refactoring Rule).

```ts
isStackableId(id: string): boolean              // wraps stackableItemIds (+ name keys)
countItem(c: Character, id: string): number     // inventory matches + itemStacks[id]
ownsItem(c: Character, id: string): boolean
addItem(c, id, n = 1): Character                 // routes: stackable → itemStacks, else inventory[]
addItems(c, ids: string[]): Character
removeItem(c, id, n = 1): Character              // routes; clamps at 0, deletes 0-count keys
removeItems(c, reqs: Record<string,number>): Character
unifiedStacks(c, allItems): Array<{id,count,name}>   // for display: merges both stores
normalizeInventory(c: Character): Character      // MIGRATION: split legacy inventory[]
```

`normalizeInventory` is the load-time migration: walk `inventory[]`, move every
`isStackableId` entry into `itemStacks` (summing counts), leave uniques in
`inventory[]`. **Idempotent and lossless** — running it twice is a no-op.

## 4. Migration

1. **Client load** — call `normalizeInventory` where the save is hydrated
   ([App.tsx:1474](../shinobij.client/src/App.tsx) `inventory: parsed.inventory ?? []`).
2. **Server save** — call the server twin in `sanitizeCharacterSave`
   ([api/save/[name].ts](../api/save/%5Bname%5D.ts)) so the server is the source
   of truth and a stale client can't un-migrate. Server is authoritative for the
   cap and for treasury/reward grants.
3. **Name-keyed items** (`"Soldier Pill"`, `"Chakra Pill"`): normalize maps the
   display-name entry to its canonical id (or keeps the name as the stack key)
   so they collapse correctly. Enumerate these explicitly.

## 5. Cap changes (api/save/[name].ts)

- `inventory[]` now holds only uniques → keep a backstop cap (e.g. 500 unique
  entries) purely as a tamper guard; legit players never approach it.
- `itemStacks`: clamp to bound payload —
  - cap distinct keys (e.g. ≤ `stackableItemIds.size + 8` slack), and
  - clamp each count to a sane max (e.g. ≤ 9999) to stop overflow abuse.
- Update the empty-save guard ([line 216](../api/save/%5Bname%5D.ts)) to also
  seed `itemStacks: {}`.

## 6. Call-site changes (grouped)

All raw `.inventory` pokes route through the helpers. Counts by category:

**Append → `addItem`/`addItems`** (~22 sites):
App.tsx (5757, 6188 aura, 7076 loot, 9108 war crate), Arena.tsx:2121,
Shop.tsx:105, CentralHub.tsx (214, 352, 523, 538, 999, 1000, 1004–1010, 1017,
1024, 1090), HunterBoard.tsx:80, WorldMap.tsx:662, VillageWarScreen.tsx:195,
TownHall.tsx:231, world-state.ts (685, 926, 1131), AdminPanel.tsx:3335,
Inventory.tsx (138 evicted-item-return, 155 unequip, 179 crate rewards),
lib/items.ts:119 (`addInventoryItems` becomes a wrapper).
*Note:* the loot guard `stackableItemIds.has(id) || !inventory.includes(id)`
(App.tsx:7067, WorldMap.tsx:661) is subsumed by `addItem`.

**Count / own → `countItem`/`ownsItem`** (~25 sites):
App.tsx (4168, 6288), PetYard.tsx (296, 304, 318, 334, 378, 428, 447, 852, 883,
664), CentralHub.tsx (418, 474, 1045, 1061, 1094, 1117, 1118, 1174, 1244),
HunterBoard.tsx:41, AdminPanel.tsx (4975–4977), world-state.ts:1118,
ClanHall.tsx:261, TownHall.tsx:163.

**Remove / consume → `removeItem`/`removeItems`** (~15 sites):
App.tsx (5795 dungeon key, 6307 hollow gate), PetYard.tsx (336, 356, 447–450
evolution stone), CentralHub.tsx (482, 1070, 1125 fragments/keys),
ClanHall.tsx:264, TownHall.tsx:166, Inventory.tsx (122 index-remove, 251 sell,
192–209 pill consume), HunterBoard.tsx:58, AdminPanel.tsx:351,
lib/items.ts (122 `removeInventoryItems` wrapper), world-state.ts:1123.

**Equip / unequip** (Inventory.tsx 125–166): equipping a stackable (throwable
into `thrown`/`item` slot, pet gear) does `removeItem(id,1)` + set slot;
unequip does `addItem(id,1)`. Uniques behave exactly as today.

**Display** (the user-visible fix):
- Inventory.tsx `backpackStacks` (line 84) must merge `itemStacks` into the
  rendered stack list (count badge per stack). Sell/use/equip act on a
  `{id,count}` stack, not an array index.
- `inventoryItemStacks` (lib/items.ts:131) folds in `itemStacks`.
- Packrat achievement (achievements.ts:101) `inventory.length >= 100` →
  total across both stores.

## 7. Server-side paths (anti-cheat sensitive — keep authoritative)

- **Foreign-read strip lists**: add `'itemStacks'` everywhere `'inventory'` is
  stripped — save/[name].ts (14, 60), player/roster.ts:27, pvp/session.ts:323,
  _realtime/presence-input.ts.
- **Treasury donate (donor side)** `_treasury-donate.ts` `countOwned` /
  `removeFromInventory` (62–68): must read+decrement `itemStacks` too.
- **Treasury transfer (recipient side)** clan/treasury/transfer.ts:186 and
  village/treasury/transfer.ts:242: route stackable items to `itemStacks`.
- **Weekly boss reward** weekly-boss.ts:276–287: route via server `addItem`.
- **Territory scroll grant** missions/_mission-catalog.ts:163
  (`grantTerritoryScrollsToInventory`) → write to `itemStacks`
  (TERRITORY_CONTROL_SCROLL_ID is already stackable). Update its test.
- **Pet evolve** pet/evolve.ts:62–81 + pet/_evolution.ts:164 `checkEvolve`:
  consume the evolution stone from `itemStacks` (it's stackable). Server-
  authoritative single-stone consumption preserved.

`_utils.ts` merge already preserves existing-only keys
(_utils.test.ts:91), so a stale client that omits `itemStacks` won't wipe it —
this is the key safety net for the rollout window.

## 8. Rollout — two phases (avoids mixed-version data loss)

The risk: a player with an **old tab open** (pre-update client) reads only
`inventory[]`; if we move stackables to `itemStacks` immediately, that tab shows
0 consumables until refresh. The `_utils` existing-only-preserve merge prevents
*loss*, but to avoid even temporary blindness:

- **Phase 0 (read-compatible):** ship types + helpers + `itemStacks` field +
  **dual-read** (every count/own/display reads both stores) while still writing
  stackables to `inventory[]`. No migration yet. All live clients now understand
  `itemStacks`.
- **Phase 1 (flip writes + migrate):** once clients have updated, flip `addItem`
  to route stackables into `itemStacks`, enable `normalizeInventory` on client
  load and server save, and switch the cap semantics. Stale tabs self-heal via
  the merge + server normalize.

(Single-phase is possible if we accept the brief stale-tab blindness; phased is
the safe default.)

## 9. Decisions needed from owner

1. **Approve the save-shape change** (`itemStacks` field) — Hard Rule gate.
2. **Confirm the stackable set additions** (§2): throwables, pills, dungeon
   key, war crate, warforged relic, name-keyed pills. These are the actual
   cap-eaters; without them the fix barely helps.
3. **Phased vs single-phase** rollout (§8).
4. **Per-stack count clamp** value (proposed 9999).

## 10. Tests (must pass before "done")

- New `lib/inventory.test.ts`: add/remove/count routing, `normalizeInventory`
  idempotency + losslessness, name-keyed pill collapse, equip/unequip stack
  math.
- Server `save` test: normalize on save, unique cap backstop, itemStacks clamp,
  foreign-read strips `itemStacks`.
- Update `_treasury-donate.test.ts` (donor with a counted stack).
- Update `_mission-catalog.test.ts` (territory scroll → itemStacks).
- New `pet/evolve` test (stone consumed from itemStacks).
- Verify `_utils` merge preserves `itemStacks` as existing-only.
- `npm test` (root) + `npm run lint` (client) + `npm run build`.

## 11. Build / deploy

Standard: `npm test` → client `npm run lint` + `npm run build` → rebuild BOTH
`dist/` (root + force-added `shinobij.client/dist`) → commit src+dist together →
push `HEAD:main`. cPanel auto-deploys committed dist; Railway self-builds.
(Stop any dev server before the client dist rebuild to avoid PNG churn —
see the client-dist image-churn note.)

## 12. Out of scope

- No Supabase schema change (saves are JSON blobs in the KV/disk overlay; this
  is a payload-shape change only).
- No balance / reward-rate changes.
- No change to equipment, jutsu, or pet data models beyond stack routing.
