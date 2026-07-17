import {
    inspectSettlementReceipt,
    appendSettlementReceipt,
    type ServerSettlementReceipt,
} from '../_settlement-receipts.js';

// ─── Atomic, exactly-once PvP reward settlement (in-save receipts) ────────────
//
// PvP rating/base settlement used to write an idempotency receipt to ONE key and
// the credited save to ANOTHER, in two separate kv.set calls. A crash (deploy,
// OOM, DB blip) between them left the receipt placed but the save un-credited —
// and on retry the receipt blocked re-crediting, so the reward/rating was
// PERMANENTLY LOST (it only ever failed toward "player got less", never a mint).
//
// This moves the idempotency marker INTO the credited save
// (`character.serverSettlementReceipts`, a server-owned field the save sanitizer
// preserves verbatim), reusing the same machinery shop/inventory settlement use.
// The credit and its receipt now land in the SAME kv.set — one Postgres row
// write, which is atomic:
//   • crash BEFORE the write → nothing persisted → retry re-credits (fresh).
//   • crash AFTER  the write → credit + receipt persisted → retry skips (replay).
// There is no window where the credit lands without the receipt or vice versa,
// so settlement is exactly-once with no cross-row transaction and no migration.
//
// The idempotency key is SERVER-DERIVED from the battleId + settlement kind (not
// a client-supplied requestId), so it cannot be forged. Each fighter's own save
// tracks its own settlement independently, so a two-sided rating settlement
// recovers each side on its own retry.

/**
 * Server-derived, per-battle idempotency key for a PvP settlement. Deterministic
 * so a retry produces the same id. battleId is `pvp-<uuid>`, so the prefixed id
 * is always within parseSettlementRequestId's 16–80 char / [A-Za-z0-9_-] bound;
 * the sanitize+clamp is belt-and-suspenders for any legacy id shape.
 */
export function pvpSettlementId(kind: string, battleId: string): string {
    return `pvp-${kind}-${battleId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

export type PvpCreditDecision = { fresh: boolean; receipts: ServerSettlementReceipt[] };

/**
 * Decide whether `character` still needs crediting for `settlementId`.
 *   • fresh:true  → credit now, then embedPvpSettlementReceipt() before writing.
 *   • fresh:false → already settled (replay) OR a defensive conflict/invalid; do
 *     NOT credit again (fail toward not-minting). The caller returns the current
 *     authoritative totals read straight from the save.
 * `fingerprint` is a stable per-(battle,role) tag, so a retry always replays
 * rather than conflicting.
 */
export function inspectPvpCredit(
    character: Record<string, unknown>,
    settlementId: string,
    fingerprint: string,
): PvpCreditDecision {
    const r = inspectSettlementReceipt(character, settlementId, fingerprint);
    return { fresh: r.status === 'fresh', receipts: r.status === 'fresh' ? r.receipts : [] };
}

/**
 * Embed the idempotency receipt into an ALREADY-credited character, so the
 * credit and the receipt persist together in a single atomic save write. The
 * stored value is a tiny marker — replays read the authoritative totals from the
 * save, not from the receipt, so the receipt never bloats the save.
 */
export function embedPvpSettlementReceipt(
    creditedCharacter: Record<string, unknown>,
    receipts: ServerSettlementReceipt[],
    settlementId: string,
    fingerprint: string,
    now: number,
): Record<string, unknown> {
    return appendSettlementReceipt(creditedCharacter, receipts, {
        requestId: settlementId,
        fingerprint,
        value: { settled: 1 },
        settledAt: now,
    });
}
