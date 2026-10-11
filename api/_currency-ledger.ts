/*
 * Per-player currency ledger — the first side-car off the whole-save blob (P0-5).
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Every currency mutation today rewrites the player's ENTIRE save JSON. That
 * works because the save lock and `_saveVersion` compose (Phase 0 concurrency
 * audit), but multi-key settlements are hand-rolled sagas rather than
 * transactions (finding F9). (The other risk that audit named, F8 — a cached
 * `save:` read inside a locked read-modify-write — is fixed: `save:` is on the
 * storage layer's no-cache list.)
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * The ten currency balances at `ledger:currency:<name>`, each row carrying the
 * `_saveVersion` it was committed with. A save write that moves currency
 * commits the save and this row in ONE transaction
 * (api/save/_commit-player-save.ts), after classifying the stored row against
 * the stored save (classifyCurrencyLedger). The save's own currency fields
 * stay an exact mirror, so every existing reader keeps working and a revert
 * never loses money. The sequence, and the evidence each step is gated on, is
 * in docs/runbooks/currency-ledger-cutover.md.
 *
 * ── Why rows carry a version ────────────────────────────────────────────────
 * A write that does not move currency skips the ledger, and writers not yet on
 * the commit helper still project after the fact (syncCurrencyLedger). Each
 * row therefore carries the `_saveVersion` it came from, which makes lag
 * SELF-DESCRIBING and separates the cases that matter:
 *
 *   • lagging   — ledger `saveVersion` is behind the save, same balances.
 *                 Normal: currency-neutral writes skip the ledger.
 *   • lagging-different — behind, with other balances: some writer moved
 *                 currency without the commit helper.
 *   • divergent — SAME `saveVersion`, DIFFERENT values. That is a real bug:
 *                 two writers disagreeing about the same version of the truth.
 *
 * The monotonic guard in syncCurrencyLedger (never overwrite a row with an
 * older `saveVersion`) means out-of-order projections cannot roll it back.
 */
import type { KvLike } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { withoutKvLeaseContext } from './_kv-lock-context.js';
import { runBackgroundWork } from './_background-work.js';
import { CURRENCY_CAPS, SAVE_FIELD_CONTRACT } from './save/_state-ownership.js';

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

/**
 * A ledger row. v1 rows (the original projection) carry only name,
 * saveVersion, balances and updatedAt; v2 rows add the version tag, the
 * account binding and a write counter. v2 is a strict superset, so code that
 * only knows v1 — a revert, or the previous deploy during an overlap — reads a
 * v2 row correctly.
 */
export type CurrencyLedger = {
    v?: 2;
    name: string;
    /** `character.createdAt` of the account this row belongs to; names are reusable. */
    bornAt?: number | null;
    /** The blob `_saveVersion` these balances were committed (v1: projected) with. */
    saveVersion: number;
    /** Monotonic count of writes to this row (informational). */
    seq?: number;
    balances: Record<string, number>;
    updatedAt: number;
};

export type CurrencyLedgerV2 = CurrencyLedger & { v: 2; bornAt: number | null; seq: number };

/**
 * Where a stored ledger row stands against the stored save it mirrors.
 *   missing            no row yet
 *   legacy             a v1 projection row (or an old process's write during a deploy overlap)
 *   orphan             a row left by a deleted account whose name was reused
 *   ahead              the row claims a newer save version than the save (a restore)
 *   lagging            behind, same balances — normal after currency-neutral writes
 *   lagging-different  behind, OTHER balances — a writer moved currency without the commit helper
 *   match              same version, same balances
 *   divergent          same account, same version, other balances — two writers
 *                      disagree about one version of the truth
 */
export type LedgerStatus = 'missing' | 'legacy' | 'orphan' | 'ahead' | 'lagging' | 'lagging-different' | 'match' | 'divergent';

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

function characterOf(record: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    const character = record?.character;
    return character && typeof character === 'object' && !Array.isArray(character) ? character as Record<string, unknown> : null;
}

function bornAtOf(record: Record<string, unknown> | null | undefined): number | null {
    const createdAt = characterOf(record)?.createdAt;
    if (createdAt === undefined || createdAt === null) return null;
    const n = Number(createdAt);
    return Number.isFinite(n) ? n : null;
}

/**
 * Classify the stored ledger row against the stored save it mirrors. Pure: the
 * commit path, the backfill sweep and the audit share it.
 */
export function classifyCurrencyLedger(save: Record<string, unknown> | null, ledger: unknown): LedgerStatus {
    if (!ledger || typeof ledger !== 'object') return 'missing';
    const row = ledger as Partial<CurrencyLedger>;
    if (row.v !== 2) return 'legacy';
    if (!save) return 'orphan';
    const rowBorn = row.bornAt ?? null;
    const saveBorn = bornAtOf(save);
    // Only two KNOWN, different birth stamps prove a different account. A
    // legacy save without createdAt gains one on its next autosave; that is
    // the same account, not an orphan.
    if (rowBorn !== null && saveBorn !== null && rowBorn !== saveBorn) return 'orphan';
    const saveVersion = num(save._saveVersion);
    const ledgerVersion = num(row.saveVersion);
    const differs = balancesDiffer(projectBalances(characterOf(save)), row.balances ?? {});
    if (ledgerVersion > saveVersion) return 'ahead';
    if (ledgerVersion < saveVersion) return differs ? 'lagging-different' : 'lagging';
    return differs ? 'divergent' : 'match';
}

/** The v2 row for a save record, continuing the write counter of the row it replaces. */
export function buildCurrencyLedgerRow(
    playerName: string,
    record: Record<string, unknown>,
    previous: unknown = null,
    now = Date.now(),
): CurrencyLedgerV2 {
    const prior = previous && typeof previous === 'object' && (previous as Partial<CurrencyLedger>).v === 2
        ? previous as CurrencyLedger
        : null;
    return {
        v: 2,
        name: playerName.toLowerCase(),
        bornAt: bornAtOf(record),
        saveVersion: num(record._saveVersion),
        seq: (prior ? num(prior.seq) : 0) + 1,
        balances: projectBalances(characterOf(record)),
        updatedAt: now,
    };
}

// ── Telemetry ───────────────────────────────────────────────────────────────
// One daily counter per event, read by an operator (and the admin economy
// view) as the evidence each cutover step is gated on. Counters, not logs,
// because "zero for seven days" is the question being asked.

export const CURRENCY_LEDGER_TELEMETRY_PREFIX = 'telemetry:currency-ledger:';
const CURRENCY_LEDGER_TELEMETRY_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * Every event this module counts; the admin economy view reads exactly these.
 *   autosave-decrease         an autosave lowered a decrease-only currency
 *   ledger-created            a money write found no ledger row and created one
 *   ledger-upgraded           … found a v1 projection row and upgraded it
 *   ledger-orphan             … found a row from a deleted account of the same name
 *   ledger-ahead              … found a row newer than the save (restore / backup)
 *   ledger-lagging-different  … found a behind row with other balances: a writer
 *                             moved currency without the commit helper
 *   ledger-divergent          … found a same-version row with other balances: a bug
 *   ledger-race               the ledger row alone moved under a held save lock
 *   raw-save-write            a player save was written outside the commit
 *                             helper (api/_save-write-guard.ts)
 */
export const CURRENCY_LEDGER_EVENTS = [
    'autosave-decrease',
    'ledger-created',
    'ledger-upgraded',
    'ledger-orphan',
    'ledger-ahead',
    'ledger-lagging-different',
    'ledger-divergent',
    'ledger-race',
    'raw-save-write',
] as const;
export type CurrencyLedgerEvent = typeof CURRENCY_LEDGER_EVENTS[number];

export function currencyLedgerTelemetryKey(event: string, dateIso: string): string {
    return `${CURRENCY_LEDGER_TELEMETRY_PREFIX}${event}:${dateIso.slice(0, 10)}`;
}

/**
 * Count one ledger event for today. Fire-and-forget and safe to call from
 * inside a save lock: it runs OUTSIDE the lock's lease context, so a failed
 * counter can neither fail nor poison the write it describes.
 */
export function recordCurrencyLedgerEvent(
    event: CurrencyLedgerEvent,
    opts: { kv?: Pick<KvLike, 'incr'>; now?: number } = {},
): Promise<void> {
    const key = currencyLedgerTelemetryKey(event, new Date(opts.now ?? Date.now()).toISOString());
    return withoutKvLeaseContext(() => runBackgroundWork(async () => {
        const store = opts.kv ?? (await import('./_storage.js')).kv;
        await store.incr(key, { ex: CURRENCY_LEDGER_TELEMETRY_TTL_SEC });
    })).then(() => undefined, () => undefined);
}

/** The last `days` daily counts of every event, oldest day first; absent days read 0. */
export async function readCurrencyLedgerTelemetry(
    days = 8,
    opts: { kv?: Pick<KvLike, 'mget'>; now?: number } = {},
): Promise<Record<CurrencyLedgerEvent, Array<{ date: string; count: number }>>> {
    const store = opts.kv ?? (await import('./_storage.js')).kv;
    const span = Math.max(1, Math.min(30, Math.floor(days)));
    const now = opts.now ?? Date.now();
    const dates = Array.from({ length: span }, (_, i) => new Date(now - (span - 1 - i) * 86_400_000).toISOString().slice(0, 10));
    const keys = CURRENCY_LEDGER_EVENTS.flatMap((event) => dates.map((date) => currencyLedgerTelemetryKey(event, date)));
    const values = await store.mget(...keys);
    const out = {} as Record<CurrencyLedgerEvent, Array<{ date: string; count: number }>>;
    CURRENCY_LEDGER_EVENTS.forEach((event, e) => {
        out[event] = dates.map((date, d) => ({ date, count: num(values[e * span + d]) }));
    });
    return out;
}

/**
 * The decrease-only currencies a generic autosave lowered. The sanitizer lets
 * these through as `min(incoming, stored)`; no live client flow spends them
 * through an autosave, so every entry here is either the legacy stat-respec
 * Fate Shard debit or a stale tab writing back an old wallet. Measured before
 * anyone decides to freeze them (it changes nothing on its own).
 */
export function decreaseOnlyCurrencyDrops(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
): Array<{ field: string; before: number; after: number }> {
    if (!before || !after) return [];
    const drops: Array<{ field: string; before: number; after: number }> = [];
    for (const field of Object.keys(CURRENCY_CAPS)) {
        if (!Object.prototype.hasOwnProperty.call(before, field)) continue;
        const was = num(before[field]);
        const now = num(after[field]);
        if (now < was) drops.push({ field, before: was, after: now });
    }
    return drops;
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
        const stored = await store.get<CurrencyLedger>(key);
        // A row left by a deleted account of the same name is not history to
        // protect: its version says nothing about this account's saves.
        const existing = stored && classifyCurrencyLedger(record, stored) === 'orphan' ? null : stored;
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
        const next = buildCurrencyLedgerRow(playerName, record, existing);
        await store.set(key, next);
        return next;
    } catch (error) {
        console.error('[currency-ledger] sync failed', safeLogValue(playerName), safeLogValue(error));
        return null;
    }
}
