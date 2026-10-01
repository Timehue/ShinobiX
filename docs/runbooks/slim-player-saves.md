# Slim player saves — rollout runbook

Ordinary player saves (`save:<name>`) used to carry full copies of the shared
admin content. Measured on production 2026-10-01: the character averaged ~10 KB
of a ~280 KB median save; ~97% was copies (pet kits 139 KB, AIs, events, items,
jutsu, cards). Those copies inflated every autosave, the owner GET, the nightly
`save-snapshot:*` rows (~92% of the database), the roster read and the
compare-and-set commit, and they decided no fight.

## What changes, and what deliberately does not

| Field | Action | Why it is safe |
|---|---|---|
| `editablePets`, `creatorAis`, `creatorEvents`, `creatorCards` | removed | No server code reads a player's copy; the client pulls the admin slots at login and keeps a device copy (`lib/shared-admin-content-cache.ts`). |
| `creatorItems` entries whose id the built-in `ITEM_CATALOG` defines, or the live admin catalog defines **and the player does not hold** | removed | Combat resolves `ITEM_CATALOG ?? admin ?? player copy` (`api/pvp/_multipliers.ts buildItemLookup`), so these copies can never be read. |
| Copies of admin items the player holds (anywhere in the save: inventory, equipment, stacks, bank, pet gear) | **kept** | The Admin Panel deletes a custom item without a tombstone; after that, the player's copy is the only definition of gear they still own. |
| Forged named gear (`named-weapon-*`, `named-armor-*`) | **kept** | The save is its only home. |
| Any item neither catalog knows; admin-deleted ids | **kept** | Removing them could change resolution. |
| `creatorJutsus` | **kept** | PvP resolves a player's stored copy over the admin one; the owner chose zero PvP change. |
| `character`, `savedBloodlines`, equipment, pets | untouched | |

The client also stops uploading the shared fields on every autosave (the server
never took them from the body), which ships on independently of the switch.

## Safeguards that ship with it

- Combat loads the admin item catalog strictly (`loadAdminCombatContent`): if it
  has never loaded since boot, a fight start fails with a retry instead of
  sealing a fighter without their admin weapon/armor.
- Elemental Core attunement resolves admin weapons from the admin catalog.
- The PvP challenge flow lists the opponent's own items first, then local admin
  content, so admin gear still displays for a slimmed opponent.
- The client keeps the last good admin content (shared fields only) per slot on
  the device and uses it when the login pull fails; a live slot always wins over
  a cached one, and when nothing at all is available it retries once after 15 s.
- A save refetch (409, reload) keeps the admin items already applied this page,
  and the save-conflict check compares only the player's own forged items, so a
  slimmed save never produces a recovery banner on its own.

## Rollout

1. Deploy with `SLIM_PLAYER_SAVES` unset (off). The client payload trim is live;
   stored saves are unchanged.
2. Dry run (read-only), as full admin, repeating with `nextCursor` until null:
   `POST /api/admin/slim-player-saves` `{ "dryRun": true, "cursor": 0, "limit": 50 }`.
   It runs the real fighter loaders (`checkSlimParity`: forged top-up,
   `hydrateCharacterFromSave`, `sealTowerFighter`, and the item resolver for every
   equipped and owned id) on each save before and after slimming.
   **Proceed only if every batch reports `parityFailures: []`.**
3. Set `SLIM_PLAYER_SAVES=1` on Railway. Active players slim on their next
   autosave.
4. Dormant saves: `{ "dryRun": false, ... }` with the same cursor loop. Writes are
   compare-and-set under each save's lock, re-check parity on the fresh row, skip
   any save whose parity fails, keep `_saveVersion`, and pause 250 ms between
   writes. Re-running is idempotent.

## Rollback

- Set `SLIM_PLAYER_SAVES=0` (or unset): no further saves are slimmed.
- Already-slim saves keep working; the removed content is a copy of what the
  admin slots hold (held admin items were never removed). The nightly `save-snapshot:*` rows keep 90 days of the
  original rows if a full restore is ever wanted.
