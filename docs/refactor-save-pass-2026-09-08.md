# Save projection and sanitization extraction

This pass follows phase 4 of the [refactor roadmap](refactor-pass-plan-2026-09-08.md). The projection baseline is `c81c2a30c`; the ordered-stage baseline is `3e5659ab3`. The save endpoint shrinks from 3,639 to 1,478 physical lines. Its public exports and HTTP entry point remain compatible.

## Projection ownership

`api/save/_projections.ts` owns public and combat projections and the release-safe content predicate. `_forged-items.ts` owns the existing forged-ID expression, stripping, and preservation. Endpoint wrappers retain the original names and signatures. Both projections still derive their field order and visibility from `_state-ownership.ts`.

The concrete risk is disclosing private player data or publishing personal forged items through shared admin content. The extraction copies the original bodies, including allowlist iteration, omission handling, and forge filtering. Authorization, admin target checks, locks, deletion fences, version checks, rate limits, and write sequencing remain in `[name].ts`.

## Ordered sanitizer dependencies

The inventory was recorded before extraction from the TypeScript declaration graph. Stages receive the same mutable working character and stored/incoming references; they do not clone again or schedule work. The endpoint calls them in their original statement order.

| Order | Owner | Inputs and values needed later |
|---|---|---|
| 1 | `_sanitize-narrative.ts` | Working, stored and incoming characters, existing save and first-save flag. Owns the four narrative normalizers and their two local helpers. |
| 2 | `_sanitize-progression.ts` | Same character references, existing save, first-save flag and original options. Returns the strict-ledger flag read at its original position. Applies economy, progression, stat and vital constraints in their original order. |
| 3 | `_sanitize-pets.ts` | Working/stored characters and that strict-ledger flag. Retains roster order, server identity, breeding locks and carry limits. |
| 4 | `_sanitize-inventory.ts` | Working/stored characters; inventory and stack normalization precede later equipment entitlement checks. |
| 5 | `_sanitize-exams.ts` | Working/stored characters and first-save flag; preserves exam and pending mission-claim constraints. |
| 6 | `_sanitize-bloodlines.ts` | Working/stored characters and existing save. Returns one normalization closure, pending forge list, shared consumed-ID set, and the existing image limit. The first character-level normalization runs here. |
| 7 | `_sanitize-challenges.ts` | Working/stored characters; clamps Endless, Hollow Gate, Tower and defeated-AI history. |
| 8 | `_sanitize-cards-history.ts` | Working/stored characters; preserves card collection/deck/tutorial constraints and battle-history bounds. |
| 9 | `_sanitize-claims-hospital.ts` | Working/stored characters; applies creator-field removal, date/claim floors and hospitalization constraints. |
| 10 | `_sanitize-creator-items.ts` | Incoming save and the image limit from stage 6. Returns sanitized definitions and their original cap for final reconciliation. |

`_sanitize-ledger.ts` owns the shared baseline, ledger, equipment and entitlement helpers. Constants retain their values and single module lifetime. Its exports are limited to helpers actually used by the stages or endpoint.

The endpoint retains the final sequence explicitly: canonicalize first saves; enforce the raw ledger; apply subscriber caps using the stored entitlement; create the output record; preserve training; normalize top-level bloodlines using the **same closure and consumed-ID set** from stage 6; grant learned mastery; validate equipped IDs; consume forge receipts; reconcile creator items; preserve server top-level fields; apply ordinary-player content restrictions. The partial-character return still preserves server top-level fields before returning.

## Verification

- All 10 moved statement ranges and 33 helper declarations match their baseline bodies after whitespace normalization; every helper has exactly one owner. Evidence is retained in `.tmp/refactor-save/body-parity.json`.
- Projection-focused ownership, golden-master, Hollow Gate, forged-item and ratchet checks: 85 passed. Expected golden snapshots were not regenerated.
- Initial all-save-domain run: 356 of 359 passed; three source-location checks required following the moved clamp map and ownership imports. Their assertions were retained. The ownership ratchet now scans every production sanitizer stage as well as the endpoint and projections.
- The first whole-suite run passed 9,686 of 9,692; six source-location checks needed to follow the moved story-progress, attunement, Nindo and name-length constraints. Their assertions were retained. The corrected complete run passed all 9,692 cases (`.tmp/refactor-save/combined-verified-unit.log`). The completion audit records the final combined run after the remaining roadmap work.
- Server TypeScript compilation, deployment configuration and rollback-readiness checks pass. Retained endpoint function bodies also match the baseline, including the HTTP handler. Evidence is retained in `.tmp/refactor-save/http-body-parity.json`.

No schema, storage layout, ownership policy, gameplay formula, dependency, or generated simulation change is included.
