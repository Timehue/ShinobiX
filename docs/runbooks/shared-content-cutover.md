# Shared-Content Cutover Runbook (P0-4 → follow-up)

Where admin-authored global content lives, what P0-4 changed, and the exact
remaining steps to retire the admin player saves as a content store.

## Today (after P0-4)

| | Canonical store (`content:<field>`) | Admin slots (`save:admin1` / `save:admin2`) |
|---|---|---|
| Written by | `/api/admin/content-publish` (locked + version-guarded) | the same endpoint's compatibility mirror, and the legacy `?signal=1` save |
| Read by | the four server catalogs (dual-read, appended last) | the same four catalogs, plus **every client** (shared-content projection) |
| Guarded | lock per field + optimistic concurrency | save lock + `_saveVersion` check (added in P0-4) |

Both publish paths write both places, so the two cannot drift. The store is
empty until the first publish; every catalog therefore behaves exactly as it
did before P0-4 until content is published (pinned by
`api/_content-dual-read.test.ts`).

## Publishable fields

`CONTENT_FIELDS` in `api/_content-store.ts`, derived from the ownership
manifest's `shared-admin-content` boundary — `creatorJutsus`, `creatorItems`,
`creatorAis`, `creatorEvents`, `creatorMissions`, `creatorRaids`,
`creatorCards`, `editablePets`, `petEncounterVn`, `ancientChestVn`,
`hollowGateEventConfig`. The client list in
`shinobij.client/src/lib/content-publish.ts` mirrors it (kept in sync by test).

## Operating notes

- **Publishing:** the Admin Panel's Save button publishes automatically. A
  second admin tab holding older content gets a conflict and must reload —
  that is the guard working, not a bug.
- **Inspecting:** `GET /api/admin/content-publish` (admin auth) returns
  `{ field: { version, updatedAt, updatedBy } }`.
- **A publish that reports "Save failed: …"** did NOT reach players. The
  canonical write is what fails first; the slot mirror only runs after it.
- **Rollback:** nothing to roll back — the slots are still written and still
  read. Reverting the P0-4 commits leaves live behavior intact because the
  canonical store is additive.

## Remaining cutover steps (NOT part of P0-4)

Do these only after a soak in which every content edit has gone through the
publish endpoint and `GET /api/admin/content-publish` shows a version for
every field in active use.

1. **Backfill.** One-shot admin script: read both slots, publish each field's
   current value through `publishContent` (unversioned mirror semantics), so
   content authored before P0-4 exists canonically. Until this runs, the
   canonical store only holds fields republished since P0-4 — harmless,
   because dual-read still falls back to the slots.
2. **Move the client onto the store.** Add a public read endpoint (or extend
   the shared-content projection) and point `pullSharedAdminContent` at it, so
   clients stop depending on `save:admin1` / `save:admin2` being readable.
3. **Stop mirroring.** Once no reader consults the slots, drop the mirror from
   `content-publish.ts` and from the legacy `?signal=1` path.
4. **Freeze the slots.** Add the authored fields to the ordinary save path's
   frozen set for the admin slots too (they are already frozen for the six
   `creator*` fields), and delete the shared-content exception from
   `buildPublicSaveDTO`. At that point the admin saves are ordinary player
   saves again.
5. **Unify tombstones.** `api/_admin-item-catalog.ts` lets a later live copy
   resurrect a deleted id; `api/shop/_catalog.ts` does not
   (shared-content audit, finding 6). With one store there is one source, so
   pick one rule deliberately and delete the divergence.

## Known gaps left open on purpose

- Content authored before P0-4 is not in the canonical store until step 1.
- `editablePets` / VN / gate-config values are still unvalidated on the
  ordinary admin-slot save path (audit finding 5) — admin-auth-gated, so this
  is an integrity nicety, not an access-control hole.
- The two tombstone semantics still differ (step 5).
