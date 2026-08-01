# Shared & Admin-Authored Content Audit — Phase 0 (2026-07-31)

Baseline: `origin/main` @ `de50b3385`. Claims tagged **VERIFIED** or **INFERRED**.

## Architecture summary

Admin-authored global content (items, jutsu, cards, AIs, events, missions,
raids, editable pets, VN configs) lives inside the two admin **player saves**
`save:admin1` / `save:admin2`, in the top-level fields enumerated by
`SHARED_ADMIN_CONTENT_FIELDS` (`api/save/[name].ts:97-101`). Server combat
consumes it through one composer — `loadAdminCombatContent`
(`api/_admin-content.ts:34`) over `_admin-jutsu-catalog.ts` /
`_admin-item-catalog.ts`. Clients pull the shared fields via the public-save
DTO exception and merge them into local state. Shared **images** are separate
KV keys (`shared:img:<id>`, manifests `shared:imgfields:<cat>`), not save fields.

## Findings

### 1. Admin slots are both global store and playable saves — VERIFIED

`ADMIN_CONTENT_SLOTS = {'admin1','admin2'}` (`api/save/[name].ts:79-106`).
The ordinary (non-`?signal=1`) save path DOES run for these slots, through
`sanitizeCharacterSave(..., { adminContentSlot })` (`:2584`) under the save lock
(`:2543`). What an ordinary admin autosave can mutate:

- `creatorJutsus/creatorAis/creatorMissions/creatorEvents/creatorCards/creatorRaids`
  — **NO**: `SERVER_LEDGER_TOPLEVEL_FIELDS` (`:397-403`), replaced from stored (`:2156-2158`).
- `creatorItems` — **YES** on an admin slot (forged gear stripped) (`:2154`).
  **Ordering trap:** the `strictLedger` branch at `:2150` comes first, so when
  `STRICT_RAW_SAVE_LEDGER=1` flips, admin-slot `creatorItems` freeze on the
  ordinary path and item publishing depends entirely on `?signal=1`.
- `editablePets`, `petEncounterVn`, `ancientChestVn`, `hollowGateEventConfig`
  — **YES**, unvalidated, riding the top-level spread (`:2141`). Admin-auth
  gated (`adminSaveTargetAllowed`, `:146-149`, `:2422`) — integrity, not
  confidentiality, risk.

### 2. updatedAt-recency clobber fix covers only part of the surface — VERIFIED

- **Jutsu:** recency merge server-side (`api/_admin-jutsu-catalog.ts:54-68`) and
  client-side (`App.tsx:3769-3777`, keeps local only if strictly newer). Present.
- **hollowGateEventConfig:** recency both sides (`api/hollow-gate/start.ts:77-80`,
  `App.tsx:3794-3797`). Present.
- **Items:** NO recency — deliberately slot-order/last-wins
  (`api/_admin-item-catalog.ts:47` "later slots win"; client `mergeById`
  `App.tsx:3756-3760`). `api/_admin-content.ts:20-24` documents the deliberate
  divergence.
- **Cards, AIs, events, missions, raids:** client `mergeById` only
  (`App.tsx:3785-3789`); shop-side merge (`api/shop/_catalog.ts:41-80`) uses
  "built-in wins; Admin 2 wins custom collisions" — no recency.

The stale-snapshot-clobbers-fresh-edit scenario remains possible for
items/cards/AIs/events/missions/raids across the two slots.

### 3. Forged-item leakage — well defended; player mirror is by design — VERIFIED

- Outbound strip: `buildPublicSaveDTO` applies `stripForgedItems` on shared
  reads (`api/save/[name].ts:134-140`; the comment cites the "one forged weapon
  mirrored into 88 saves" incident — commit 13ddfa302's fix filters on the way
  OUT, neutralizing already-stored copies without a migration).
- Inbound strips (defense in depth): ordinary admin-slot write (`:2151-2154`);
  `?signal=1` write (`:2810-2815`); catalog-level filter
  (`api/_admin-item-catalog.ts:40,68-73`, regex synced with `[name].ts:432`).
- Shared content DOES flow into ordinary player saves **by design**: the client
  merges pulled content into local state and autosaves `creatorItems`, so every
  player save carries a sanitized, budgeted mirror (cap 500, `:2033-2040`,
  `:2155`). Player-sent `creatorJutsus`/`creatorAis`/etc. are discarded
  (`:2156-2158`; `_admin-jutsu-catalog.ts:4-10`: "a normal player record NEVER
  carries authored jutsu"). The mirror is explicitly NOT trusted as a definition
  source (`_admin-item-catalog.ts:10-20`, `api/pvp/_multipliers.ts:55-58`).

### 4. Stale admin client can revert newer shared content — VERIFIED, OPEN

`api/save/[name].ts:2800-2826` — the `?signal=1` admin publish path:

- takes **no `withKvLock`** — two concurrent admin editors race (read at `:2802`
  unserialized; the `admin-lock:<name>` set at `:2801` only suppresses ordinary
  player autosaves, `:2557`);
- performs **no `_baseSaveVersion` conflict check** — `adminStoredVersion`
  (`:2803`) is read only to bump, never compared. The 426/409 guards (`:2725`,
  `:2735`) live only in the non-admin branch (`:2518`);
- `mergePreservingImages` (`:2804`, `api/_utils.ts:79-119`) lets incoming arrays
  win wholesale (`:83-99`), so a stale admin tab posting its full state
  overwrites newer `creator*` arrays.

This is the highest-value remaining gap in shared content (P0-4 target).

### 5. Combat reads are unified; shop is a second reader — VERIFIED

Via `loadAdminCombatContent`: `pvp/session.ts:1268`,
`missions/combat-start.ts:71`, `story/boss-start.ts:72`, `towers/start.ts:76`,
`clan-boss/assault-start.ts:84`, `weekly-boss.ts:586`,
`village/anbu-infiltration.ts:175`, `_anbu-infiltration-store.ts:208`,
`_merc-auto.ts:77`. `training/jutsu-ryo.ts:36` uses `loadAdminJutsuObjects`
directly (same catalog). Direct slot readers bypassing the composer:

- `api/shop/_catalog.ts:6,84` — own reader with **different merge semantics**
  for items/cards (used by `shop/settle.ts:35`, `inventory/sell.ts:30`); also
  validates (`cleanItem`/`cleanCard`) where the combat catalog does not.
- `api/hollow-gate/start.ts:73-81` — reads both slots for
  `hollowGateEventConfig` (recency-sorted).

### 6. Deletion markers / resurrection — INCONSISTENT — VERIFIED

- Items: tombstone `__ADMIN_DELETED_ITEM__` honored in
  `_admin-item-catalog.ts:33-34,68`, `shop/_catalog.ts:5,54-57`, client
  `lib/items.ts:44-50`. **Divergent resurrection semantics:** in
  `_admin-item-catalog.ts:68` a tombstone only `out.delete(id)` — a live copy in
  a LATER slot re-adds the item (resurrection in combat); in
  `shop/_catalog.ts:43,55,61` the `deleted` set persists across both records and
  blocks later live copies.
- Jutsu: **no tombstone at all** — deletion = removal from the array;
  `_admin-content.ts:8-10` warns an earlier composer copy "drifted on how a
  deletion tombstone behaves." Client merges never remove entries, so a deleted
  jutsu survives in clients' local state and in the other slot's mirror.
- AIs/events/missions/raids/cards: no deletion mechanism found.

### 7. Versioning & precedence — VERIFIED

- No explicit content schema/version field; only per-entry `updatedAt` and the
  slot save's `_saveVersion`.
- Item precedence: `api/pvp/_multipliers.ts:99` —
  `ITEM_CATALOG[id] ?? fromAdmin(id) ?? custom.get(id)` (built-in > admin >
  player creatorItems). Player copies budgeted (`:73`); admin entries
  deliberately NOT budgeted (owner ruling documented `:78-97`).
- Jutsu precedence: built-in `JUTSU_CATALOG` beats authored on id collision —
  documented as load-bearing (`api/pvp/session.ts:582-589`: the admin slots hold
  frozen snapshots of built-ins; letting them win would revert balance changes).
- Shop: built-ins win; admin deletions hide them; Admin 2 wins customs
  (`shop/_catalog.ts:41,59`).

### 8. Malformed/missing definitions are dropped silently — VERIFIED

Both catalogs `continue` past non-object entries, empty ids, ids >120 chars —
no logging (`_admin-jutsu-catalog.ts:59-62`, `_admin-item-catalog.ts:64-67`);
`shop/_catalog.ts:17-39` returns null silently on bad slot/rarity/cost. Only a
KV read failure is loud (`console.error` + last-good-cache fallback,
`_admin-jutsu-catalog.ts:89-91`, `_admin-item-catalog.ts:99-101`) — a fight
proceeds without admin content rather than failing. Downstream, an unresolvable
id is silently dropped from combat (documented `_admin-item-catalog.ts:17-18`).

## Cards and shared images

- Admin CARDS publish through the same admin slots (`creatorCards`,
  `[name].ts:99`; client merge `App.tsx:3788`; consumed via
  `shop/_catalog.ts:63-66,75-79`).
- Shared IMAGES are separate keys: `shared:img:<id>` (`api/img.ts:24`, written
  `api/images.ts:500`) + per-category manifests `shared:imgfields:<cat>`
  (`api/images.ts:143`). `mergePreservingImages` (`api/_utils.ts:119`) prevents
  a client-stripped `''` field from wiping a stored `data:image` on save.
  Bloodline images live in `shared:imgfields:bloodline` (`api/bloodlines/list.ts:15`).

## Risk summary

| # | Severity | Finding |
|---|---|---|
| 1 | **High** | `?signal=1` publish path: no lock, no version guard, no sanitizer — stale or concurrent admin editors can silently clobber newer shared content |
| 2 | Medium | Recency protection covers only jutsu + hollowGateEventConfig; items/cards/AIs/events/missions/raids remain last-writer-wins across slots |
| 3 | Medium | Tombstone resurrection divergence between combat catalog and shop catalog |
| 4 | Medium | No deletion mechanism for jutsu/AIs/events/missions/raids/cards — removals don't propagate |
| 5 | Low | `editablePets`/VN/gate-config fields unvalidated on the ordinary admin-slot path |
| 6 | Latent | `STRICT_RAW_SAVE_LEDGER=1` flip freezes admin-slot `creatorItems` on the ordinary path — publishing then depends entirely on the unguarded `?signal=1` path (compounds #1) |
