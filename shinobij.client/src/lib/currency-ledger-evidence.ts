/*
 * The currency-ledger cutover evidence (GET /api/admin/economy → currencyLedger),
 * summarised for the Admin Diagnostics economy section. The server sends the
 * last eight days of each counted event (api/_currency-ledger.ts
 * readCurrencyLedgerTelemetry); this turns that into one row per event and the
 * one answer the next cutover step waits on: has anything blocked it?
 * See docs/runbooks/currency-ledger-cutover.md.
 */

export type CurrencyLedgerDay = { date: string; count: number };

export type CurrencyLedgerEvidenceRow = {
    event: string;
    label: string;
    /** Counts toward the gate on the fail-closed step. */
    blocksFailClosed: boolean;
    total: number;
    today: number;
};

export type CurrencyLedgerEvidence = {
    rows: CurrencyLedgerEvidenceRow[];
    /** Days covered, oldest first. */
    days: string[];
    /** Sum of the blocking events across the window. */
    blockers: number;
};

const EVENT_LABELS: Record<string, { label: string; blocksFailClosed: boolean }> = {
    'ledger-divergent': { label: 'Divergent rows (same save version, different balances)', blocksFailClosed: true },
    'raw-save-write': { label: 'Save writes outside the commit helper', blocksFailClosed: true },
    'ledger-lagging-different': { label: 'Rows behind the save with different balances', blocksFailClosed: false },
    'ledger-ahead': { label: 'Rows ahead of the save (restore)', blocksFailClosed: false },
    'ledger-orphan': { label: 'Rows from deleted accounts replaced or removed', blocksFailClosed: false },
    'ledger-created': { label: 'Rows created', blocksFailClosed: false },
    'ledger-upgraded': { label: 'Rows upgraded from the old projection', blocksFailClosed: false },
    'ledger-race': { label: 'Ledger-only races retried', blocksFailClosed: false },
    'autosave-decrease': { label: 'Autosaves that lowered a decrease-only currency', blocksFailClosed: false },
};

function count(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Tolerant of a missing or malformed payload (an older server): returns no rows. */
export function summarizeCurrencyLedgerEvidence(raw: unknown): CurrencyLedgerEvidence {
    const empty: CurrencyLedgerEvidence = { rows: [], days: [], blockers: 0 };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    const rows: CurrencyLedgerEvidenceRow[] = [];
    let days: string[] = [];
    for (const [event, series] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(series)) continue;
        const points = series
            .filter((point): point is CurrencyLedgerDay => !!point && typeof point === 'object' && typeof (point as CurrencyLedgerDay).date === 'string')
            .map((point) => ({ date: point.date, count: count(point.count) }));
        if (points.length > days.length) days = points.map((point) => point.date);
        const known = EVENT_LABELS[event];
        rows.push({
            event,
            label: known?.label ?? event,
            blocksFailClosed: known?.blocksFailClosed ?? false,
            total: points.reduce((sum, point) => sum + point.count, 0),
            today: points.at(-1)?.count ?? 0,
        });
    }
    // Blockers first, then by how much happened.
    rows.sort((a, b) => Number(b.blocksFailClosed) - Number(a.blocksFailClosed) || b.total - a.total || a.event.localeCompare(b.event));
    const blockers = rows.filter((row) => row.blocksFailClosed).reduce((sum, row) => sum + row.total, 0);
    return { rows, days, blockers };
}
