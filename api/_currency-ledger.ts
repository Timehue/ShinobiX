/*
 * Per-player currency ledger — the first side-car off the whole-save blob (P0-5).
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Every currency mutation today rewrites the player's ENTIRE save JSON. That
 * works because the save lock and `_saveVersion` compose (Phase 0 concurrency
 * audit), but it carries two structural risks: the storage layer caches
 * `save:` reads for 10s, so a second Railway replica could serve a stale read
 * inside a locked read-modify-write; and multi-key settlements are hand-rolled
 * sagas rather than transactions.
 *
 * ── What this is (and is not) ───────────────────────────────────────────────
 * A VERSIONED PROJECTION of the nine currency fields, written alongside the
 * blob at `ledger:currency:<name>`. The blob stays authoritative — nothing
 * reads this for gameplay. Its job is to earn the confidence a cutover needs:
 * once the divergence signal below is provably zero, the ledger can become the
 * read source for currencies (procedure in
 * docs/runbooks/currency-ledger-cutover.md).
 *
 * ── Why a projection, not a dual-write ──────────────────────────────────────
 * Not every save writer funnels through one helper: mutatePlayerSave and
 * writeVersionedPlayerSave cover most endpoints, but several settlements
 * hand-roll their own version stamp and blob write. Rather than pretend to full
 * coverage, each ledger row carries the `_saveVersion` it was projected from.
 * That makes lag SELF-DESCRIBING and separates the two cases that matter:
 *
 *   • stale    — ledger `saveVersion` is behind the blob. Benign: a writer
 *                this module does not hook yet. Converges on the next hooked
 *                write, or via the backfill script.
 *   • divergent — SAME `saveVersion`, DIFFERENT values. That is a real bug:
 *                two writers disagreeing about the same version of the truth.
 *                Only this case is escalated.
 *
 * The monotonic guard (never overwrite a ledger row with an older
 * `saveVersion`) means out-of-order syncs cannot corrupt the projection.
 */
import type { KvLike } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { SAVE_FIELD_CONTRACT } from './save/_state-ownership.js';

type LedgerKv = Pick<KvLike, 'get' | 'set'>;

async function getDefaultKv(): Promise<LedgerKv> {
    return (await import('./_storage.js')).kv;
}

/**
 * The tracked fields, DERIVED from the ownership manifest (P0-1): every
 * character-scope field in the `currency` domain that the server owns or
 * clamps. Adding a currency to the manifest therefore adds it here — no second
 * list to forget. (Claim stamps like `lastBankInterestAt` and the client-owned
 * `bankLog` share the domain but are not balances, so they are excluded by
 * category.)
 */
export const CURRENCY_LEDGER_FIELDS: readonly string[] = SAVE_FIELD_CONTRACT
    .filter((def) => def.scope === 'character'
        && def.domain === 'currency'
        && (def.category === 'server-ledger' || def.category === 'server-clamped'))
    .map((def) => def.field);

export const CURRENCY_LEDGER_PREFIX = 'ledger:currency:';

export function currencyLedgerKey(playerName: string): string {
    return `${CURRENCY_LEDGER_PREFIX}${playerName.toLowerCase()}`;
}

export type CurrencyLedger = {
    name: string;
    /** The blob `_saveVersion` these balances were projected from. */
    saveVersion: number;
    balances: Record<string, number>;
    updatedAt: number;
};

export type LedgerComparison =
    | { status: 'match' }
    | { status: 'missing' }
    | { status: 'stale'; ledgerVersion: number; recordVersion: number }
    | { status: 'divergent'; version: number; fields: Array<{ field: string; blob: number; ledger: number }> };

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** The currency slice of a character, normalized to numbers. */
export function projectBalances(character: Record<string, unknown> | null | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    if (!character || typeof character !== 'object') return out;
    for (const field of CURRENCY_LEDGER_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(character, field)) out[field] = num(character[field]);
    }
    return out;
}

/** True when two balance projections differ on any tracked field. */
export function balancesDiffer(a: Record<string, number>, b: Record<string, number>): boolean {
    for (const field of CURRENCY_LEDGER_FIELDS) {
        if (num(a[field]) !== num(b[field])) return true;
    }
    return false;
}

export function compareLedger(record: Record<string, unknown>, ledger: CurrencyLedger | null): LedgerComparison {
    if (!ledger) return { status: 'missing' };
    const recordVersion = num(record._saveVersion);
    const ledgerVersion = num(ledger.saveVersion);
    if (ledgerVersion < recordVersion) return { status: 'stale', ledgerVersion, recordVersion };
    const blob = projectBalances(record.character as Record<string, unknown> | undefined);
    const mismatched: Array<{ field: string; blob: number; ledger: number }> = [];
    for (const field of CURRENCY_LEDGER_FIELDS) {
        const blobValue = num(blob[field]);
        const ledgerValue = num(ledger.balances?.[field]);
        if (blobValue !== ledgerValue) mismatched.push({ field, blob: blobValue, ledger: ledgerValue });
    }
    if (mismatched.length === 0) return { status: 'match' };
    return { status: 'divergent', version: recordVersion, fields: mismatched };
}

export async function readCurrencyLedger(playerName: string, opts: { kv?: LedgerKv } = {}): Promise<CurrencyLedger | null> {
    const store = opts.kv ?? await getDefaultKv();
    return (await store.get<CurrencyLedger>(currencyLedgerKey(playerName))) ?? null;
}

/**
 * Project a freshly written save record into the ledger.
 *
 * NEVER throws and never blocks correctness: the blob is authoritative, so a
 * failed projection is only lost observability. Skips the write when nothing
 * changed, so ordinary autosaves (which do not move currency) cost nothing.
 * A `divergent` comparison is escalated — that is the signal the cutover is
 * waiting on.
 */
export async function syncCurrencyLedger(
    playerName: string,
    record: Record<string, unknown>,
    opts: { kv?: LedgerKv; previousCharacter?: Record<string, unknown> | null } = {},
): Promise<CurrencyLedger | null> {
    try {
        const character = record.character as Record<string, unknown> | undefined;
        if (!character) return null;
        const balances = projectBalances(character);
        if (Object.keys(balances).length === 0) return null;
        // Fast path: currencies untouched by this write — the ledger cannot
        // have become more wrong, so skip the read AND the write.
        if (opts.previousCharacter !== undefined && opts.previousCharacter !== null) {
            if (!balancesDiffer(balances, projectBalances(opts.previousCharacter))) return null;
        }
        const store = opts.kv ?? await getDefaultKv();
        const key = currencyLedgerKey(playerName);
        const existing = await store.get<CurrencyLedger>(key);
        const saveVersion = num(record._saveVersion);
        // Monotonic guard: an out-of-order sync must not roll the projection
        // back to older balances.
        if (existing && num(existing.saveVersion) > saveVersion) return existing;
        if (existing && num(existing.saveVersion) === saveVersion && !balancesDiffer(balances, existing.balances ?? {})) {
            return existing;
        }
        if (existing && num(existing.saveVersion) === saveVersion && balancesDiffer(balances, existing.balances ?? {})) {
            // Same version of the truth, two different answers — a real bug.
            console.error('[currency-ledger] DIVERGENT', safeLogValue(playerName), safeLogValue(JSON.stringify({
                version: saveVersion,
                blob: balances,
                ledger: existing.balances,
            })));
        }
        const next: CurrencyLedger = { name: playerName.toLowerCase(), saveVersion, balances, updatedAt: Date.now() };
        await store.set(key, next);
        return next;
    } catch (error) {
        console.error('[currency-ledger] sync failed', safeLogValue(playerName), safeLogValue(error));
        return null;
    }
}
