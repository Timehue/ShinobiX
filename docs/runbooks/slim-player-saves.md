# Slim player saves — rollout runbook

Ordinary player saves (`save:<name>`) used to carry full copies of the shared
admin content. Measured on production 2026-10-01: the character averaged ~10 KB
of a ~280 KB median save; most of the rest was copies (pet kits 139 KB, AIs,
events, cards, plus ~53 KB of item and ~26 KB of jutsu copies on average). Those
copies inflated every autosave, the owner GET, the nightly `save-snapshot:*` rows
(~92% of the database), the roster read and the compare-and-set commit. Removing
the four never-read fields cuts the average save's JSON from ~360 KB to ~90 KB
(measured over 170 production saves, 2026-10-01).

## What changes, and what deliberately does not

| Field | Action | Why it is safe |
|---|---|---|
| `editablePets`, `creatorAis`, `creatorEvents`, `creatorCards` | removed | No server code reads a player's copy; the client pulls the admin slots at login and keeps a device copy (`lib/shared-admin-content-cache.ts`). |
| `creatorItems` (every entry: admin copies, forged gear, unknown ids) | **kept** | Combat falls back to a player's copy when the admin catalog no longer defines an id, and the Admin Panel deletes custom items without a tombstone. A copy can be the last definition of gear the player holds, including gear held OUTSIDE the save row (an Exchange listing in escrow, a pending grant), so item copies are never slimmed. |
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

Slimming is **on by default** and needs no Railway setting.
`SLIM_PLAYER_SAVES=0` exists only as an emergency kill switch.

1. Deploy. Each active player's save is slimmed on their next autosave, but a
   save's **first** slim is proven on that save's own data before it commits
   (`firstSlimKeepsEveryFight` in `api/save/_slim-parity.ts`): the real fighter
   loaders (`checkSlimParity`: forged top-up, `hydrateCharacterFromSave`,
   `sealTowerFighter`, and the item resolver for every equipped and owned id)
   run on the full and the slimmed record. Any difference, loader error or
   unavailable admin catalog keeps that save full and logs
   `[slim-save] save:<name> kept full: ...` once per process. Search the
   Railway logs for `[slim-save]` after the first day.
2. Optional, for dormant saves (players who do not log in): as full admin,
   `POST /api/admin/slim-player-saves` `{ "dryRun": true, "cursor": 0, "limit": 50 }`,
   repeating with `nextCursor` until null, reports what would change and any
   `parityFailures`. `{ "dryRun": false, ... }` with the same cursor loop then
   writes them: compare-and-set under each save's lock, parity re-checked on the
   fresh row, a failing save never written, `_saveVersion` kept, 250 ms between
   writes. Re-running is idempotent. Dormant saves left full are harmless.

## Rollback

- Set `SLIM_PLAYER_SAVES=0`: no further saves are slimmed.
- Already-slim saves keep working; the removed content is a copy of what the
  admin slots hold (held admin items were never removed). The nightly `save-snapshot:*` rows keep 90 days of the
  original rows if a full restore is ever wanted.
