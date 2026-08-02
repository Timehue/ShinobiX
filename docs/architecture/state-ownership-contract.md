# State-Ownership Contract (P0-1)

Canonical module: **`api/save/_state-ownership.ts`** — one entry per save
field, tagged with its ownership category, domain, and the enforcement
boundaries that consume it. Every ownership list the save pipeline uses is
DERIVED from that table. `api/save/[name].ts` (sanitizer + projections) is the
sole enforcement point; it imports the derived lists and holds no literals.

Guard tests:

- `api/save/_ownership-golden-master.test.ts` (+ `.snapshot.json`) — full-output
  characterization of the sanitize/projection pipeline. Regenerate deliberately
  with `UPDATE_OWNERSHIP_SNAPSHOTS=1 npm test`; the diff is the review artifact.
- `api/save/_state-ownership-parity.test.ts` — derived lists vs frozen
  pre-extraction literals.
- `api/save/_state-ownership-ratchet.test.ts` — unclassified-field ratchet,
  projection-safety invariants, shadow-list drift guard, and a manifest-driven
  proof that ordinary autosaves cannot replace stored-copy-wins fields.
- `api/save/_ownership-admin-path.test.ts` — admin `?signal=1` auth boundary
  and the 426/409 stale-save guards.

## Ownership categories

| Category | Meaning | May a generic autosave change it? |
|---|---|---|
| `server-ledger` | Balance/rating/progression ledger | Spend/decrease only (clamped); frozen entirely under strict mode |
| `server-owned` | Domain state written by dedicated endpoints | No — stored copy wins |
| `server-payout-stamp` | Claim stamps/latches/receipts gating payouts | No — stored copy wins |
| `server-clamped` | Client-writable but clamped/floored/delta-capped | Within the clamp only |
| `derived` | Recomputed server-side (level, professionRank, rankTitle) | No — client value ignored |
| `client-state` | Client-owned gameplay state by design | Yes (payouts guarded elsewhere) |
| `client-preference` | Free-form preference (nindo, tutorial markers) | Yes (moderated) |
| `cosmetic-ref` | Preset/image references | Yes (allowlisted / entitlement-gated) |
| `shared-admin-content` | Global authored content on save:admin1/2 | No for players; admin slots publish it |
| `personal-authored` | Player-authored content (forged gear, bloodlines) | Content yes, budget/entitlement clamped; forged definitions revived if omitted |
| `deprecated` | Retired fields kept as rollback ballast (xp) | No — frozen |
| `forbidden` | Must not exist at that scope (character-level creator*) | Deleted outright |

## Enforcement boundaries (derived lists)

Each `SaveBoundary` tag maps 1:1 to a derived export consumed by
`api/save/[name].ts` — e.g. `always-ledger-char` →
`ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS` (copied from stored on every save),
`server-array-ledger-char` → the copy-if-array redemption-ledger loop,
`public-char` → the public DTO allowlist. See the type's doc comments for the
full list. **Ordering:** only `public-char` is order-sensitive (it drives HTTP
response key order and is order-pinned by the parity test). Every other list
feeds Sets, delete-loops, or stored-copy loops whose output lands in Postgres
`jsonb`, where key order is not preserved — membership is the contract.

## How to classify a new field

1. Decide who writes it. If any server endpoint grants/credits it, it is NOT
   client-owned — pick `server-owned` / `server-ledger` / `server-payout-stamp`
   and add the matching enforcement boundary so the sanitizer actually
   protects it (classification without a boundary documents but does not
   enforce).
2. Add exactly one `f(...)` entry in `SAVE_FIELD_CONTRACT` (correct scope:
   `character`, `top`, or `pet`), with a `note` naming the owning endpoint.
3. Run `npm test`. The ratchet fails until the field is classified; the
   golden master fails if you changed behavior — regenerate the snapshot only
   when the behavior change is intended and reviewed.
4. If the field must be publicly visible, add the `public-char` /
   `public-combat-toplevel` boundary deliberately — fields are private by
   default, and the projection-safety test blocks server-private names.

## What clients may write

- Generic autosaves may write: `client-state`, `client-preference`,
  `cosmetic-ref`, `personal-authored` content (budget-clamped), and
  `server-clamped` fields within their clamps.
- Generic autosaves may NEVER durably change: anything tagged
  `always-ledger-char`, `payout-char`, `clan-points-char`,
  `server-mirror-char`, `server-array-ledger-char`,
  `progression-entitlement-char`, `boolean-latch-char`, `ledger-toplevel`,
  `forbidden-creator-char`, or `pet-identity` — the ratchet test proves this
  field-by-field from the manifest.

## Projections

- **Public (foreign read):** allowlist DTO — `public-char` character fields
  only; zero top-level fields on a base read; `public-combat-toplevel`
  (authored content + bloodlines) added under `?combatOnly=1`.
- **Shared content:** only from the `admin1`/`admin2` slots; exposes the
  `shared-admin-content` fields, with personal forged gear stripped outbound.
- **Combat (owner read):** blacklist strip (`combat-strip-*`) of
  meta/currency/receipt fields.

## Why STRICT_RAW_SAVE_LEDGER stays unchanged

The strict flip makes the full `strict-ledger-char` set stored-copy-wins and
turns inventory validation count-consuming. It is gated on later phases: P0-3
must first fix named-weapon resolution (strict mode would otherwise drop
forged gear whose only definition lives in the player's own `creatorItems`),
and P0-4 must move admin item publishing off the ordinary save path (strict
mode freezes admin-slot `creatorItems` there). P0-1 changes neither the flag
nor any compatibility behavior it gates.

## Remaining ownership work (out of P0-1 scope)

- **P0-2** — settlement/idempotency consolidation (five receipt dialects; the
  trade escrow gap; mission-handoff loss window).
- **P0-3** — single fighter pipeline; retire the client-built fighter modes;
  named-weapon resolution before the strict flip.
- **P0-4** — move shared content out of the admin player saves; lock and
  version the `?signal=1` publish path (auth is verified sound today; the gap
  is concurrency/staleness).
- **P0-5** — per-domain ledgers off whole-save writes (currencies first).
- **P0-6** — fresh-account end-to-end certification against the real server.

Known duplications preserved (recorded on the manifest entries, not silently
resolved): `claimedWarCrateIds` (payout copy AND array-ledger copy — payout
wins), `activeTraining` (inline `?? null` freeze AND ledger-toplevel copy —
the list copy wins; `activeJutsuTraining` deliberately has only the inline
rule, keeping an always-present `null`), `totalEndlessTowerWins` (mirror copy
then a no-op lifetime clamp), and the dead date-lock branch for
`claimedVillageAgendaDate`/`claimedMapControlDate` (the later payout copy
supersedes it).
