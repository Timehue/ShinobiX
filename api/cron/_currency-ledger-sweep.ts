/*
 * Currency-ledger backfill and orphan sweep (P0-5, docs/runbooks/currency-ledger-cutover.md).
 *
 * A money write creates or repairs its player's ledger row on the way through
 * (api/save/_commit-player-save.ts). This sweep reaches everyone else: a player
 * who has not moved currency since the ledger shipped gets a row from their
 * save, a row lagging behind a writer that skipped the commit helper is
 * brought back in line, and a row whose save is gone (a deleted account, a
 * reaped guest) is removed. It replaces the manual, unlocked
 * `npm run ledger:backfill`.
 *
 * Every repair runs under the save's own lock and commits as one transaction
 * that ASSERTS the save is still exactly the row it was built from, so a
 * repair can never write a ledger for a save that moved underneath it.
 *
 * Once the fail-closed step is taken (CURRENCY_LEDGER_GATE_ENFORCED), a
 * `divergent` row is held for a person instead of being repaired: overwriting
 * it would erase the very evidence the gate stops on.
 *
 * Underscore-prefixed: a helper, driven by api/cron/_scheduler.ts.
 */
import { kv, type KvCasOp, type KvLike } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { readKvProjection, type KvProjection } from '../_storage-projection.js';
import { safeLogValue } from '../_safe-log.js';
import { safeName } from '../_utils.js';
import {
    CURRENCY_LEDGER_FIELDS,
    CURRENCY_LEDGER_PREFIX,
    buildCurrencyLedgerRow,
    classifyCurrencyLedger,
    currencyLedgerKey,
    recordCurrencyLedgerEvent,
    type CurrencyLedger,
    type CurrencyLedgerEvent,
    type LedgerStatus,
} from '../_currency-ledger.js';
import { currencyLedgerGateEnforced } from '../save/_commit-player-save.js';

type SweepStore = Pick<KvLike, 'get' | 'set' | 'keys' | 'mget' | 'compareSet'>
    & Partial<Pick<KvLike, 'compareSetMany' | 'mgetProjected'>>;
type SaveRecord = Record<string, unknown>;

/** Players reconciled per tick. The whole population is covered within a few ticks. */
export const CURRENCY_LEDGER_SWEEP_BATCH = 25;
export const CURRENCY_LEDGER_SWEEP_CURSOR_KEY = 'cron:currency-ledger-sweep:cursor';

const SAVE_PREFIX = 'save:';
const NON_PLAYER_SAVES = new Set(['admin1', 'admin2']);

/** The repairs a sweep pass counts, by the state it found. */
const REPAIR_EVENT: Partial<Record<LedgerStatus, CurrencyLedgerEvent>> = {
    missing: 'ledger-created',
    legacy: 'ledger-upgraded',
    orphan: 'ledger-orphan',
    ahead: 'ledger-ahead',
    'lagging-different': 'ledger-lagging-different',
    divergent: 'ledger-divergent',
};

/** The slice of a save the classification needs; the full row is read only to repair. */
const LEDGER_PROJECTION: KvProjection = Object.fromEntries([
    ['_saveVersion', ['_saveVersion']],
    ['createdAt', ['character', 'createdAt']],
    ['__character', ['character', 'name']],
    ...CURRENCY_LEDGER_FIELDS.map((field) => [field, ['character', field]]),
]);

export type LedgerReconcileAction = 'none' | 'written' | 'removed' | 'held' | 'raced' | 'skipped';
export type LedgerReconcileOutcome = { name: string; status: LedgerStatus | 'no-save'; action: LedgerReconcileAction };

export type CurrencyLedgerSweepResult = {
    scanned: number;
    written: number;
    removed: number;
    held: string[];
    raced: number;
    errors: string[];
    /** The last name reached; the next tick continues after it. */
    cursor: string;
    /** True when this tick reached the end of the population and wrapped. */
    wrapped: boolean;
};

/**
 * A `save:<name>` that belongs to a player under its canonical key: the
 * `safeName` spelling every current writer uses (lowercase), and not a clan
 * blob, an admin content slot or a probe. Legacy keys from before `safeName`
 * (`save:Rill`, `save:Admin 1`) are never reconciled.
 */
export function isPlayerSaveName(name: string): boolean {
    return name.length > 0
        && name === safeName(name)
        && !name.startsWith('clan-')
        && !name.startsWith('health-probe-')
        && !NON_PLAYER_SAVES.has(name);
}

function projectedSave(projected: Record<string, unknown> | null): SaveRecord | null {
    if (!projected) return null;
    const character: Record<string, unknown> = {};
    if (projected.createdAt !== undefined) character.createdAt = projected.createdAt;
    for (const field of CURRENCY_LEDGER_FIELDS) {
        if (projected[field] !== undefined) character[field] = projected[field];
    }
    return { _saveVersion: projected._saveVersion, character };
}

/**
 * Bring one player's ledger row in line with their save, under the save lock.
 * Safe to call at any time and idempotent: a row that already matches is left
 * alone without reading the full save.
 */
export async function reconcileCurrencyLedger(
    playerName: string,
    opts: { store?: SweepStore; gateEnforced?: boolean; now?: number } = {},
): Promise<LedgerReconcileOutcome> {
    const store = opts.store ?? kv;
    const name = playerName.toLowerCase();
    const saveKey = `${SAVE_PREFIX}${name}`;
    const ledgerKey = currencyLedgerKey(name);
    if (!store.compareSetMany) return { name, status: 'no-save', action: 'skipped' };
    return withKvLock(saveKey, async () => {
        const [projected] = await readKvProjection(store, [saveKey], LEDGER_PROJECTION);
        const ledger = await store.get<CurrencyLedger>(ledgerKey);
        if (!projected) {
            if (!ledger) return { name, status: 'no-save' as const, action: 'none' as const };
            // The save is gone: the row belongs to nobody. Remove it only while
            // the save is still absent.
            const removed = await store.compareSetMany!([
                { op: 'assert', key: saveKey, expected: null },
                { op: 'delete', key: ledgerKey, expected: ledger },
            ]);
            if (removed) void recordCurrencyLedgerEvent('ledger-orphan', { now: opts.now });
            return { name, status: 'orphan' as const, action: removed ? 'removed' as const : 'raced' as const };
        }
        if (projected.__character === undefined && projected.createdAt === undefined
            && CURRENCY_LEDGER_FIELDS.every((field) => projected[field] === undefined)) {
            // A save without a character carries no balances to mirror.
            return { name, status: 'no-save' as const, action: 'none' as const };
        }
        const status = classifyCurrencyLedger(projectedSave(projected), ledger);
        if (status === 'match' || status === 'lagging') return { name, status, action: 'none' as const };
        if (status === 'divergent' && currencyLedgerGateEnforced(process.env, opts.gateEnforced)) {
            console.error('[currency-ledger] sweep holds a DIVERGENT row for review', safeLogValue(name));
            void recordCurrencyLedgerEvent('ledger-divergent', { now: opts.now });
            return { name, status, action: 'held' as const };
        }
        // Repair from the full row, asserting that row in the same transaction.
        const full = await store.get<SaveRecord>(saveKey);
        if (!full) return { name, status, action: 'raced' as const };
        const fullStatus = classifyCurrencyLedger(full, ledger);
        if (fullStatus === 'match' || fullStatus === 'lagging') return { name, status: fullStatus, action: 'none' as const };
        const row = buildCurrencyLedgerRow(name, full, fullStatus === 'orphan' ? null : ledger, opts.now);
        const ops: KvCasOp[] = [
            { op: 'assert', key: saveKey, expected: full },
            { op: 'cas', key: ledgerKey, expected: ledger ?? null, value: row },
        ];
        const written = await store.compareSetMany!(ops);
        if (!written) return { name, status: fullStatus, action: 'raced' as const };
        const event = REPAIR_EVENT[fullStatus];
        if (event) void recordCurrencyLedgerEvent(event, { now: opts.now });
        if (fullStatus !== 'missing' && fullStatus !== 'legacy') {
            const log = fullStatus === 'divergent' ? console.error : console.warn;
            log(`[currency-ledger] sweep repaired a ${fullStatus === 'divergent' ? 'DIVERGENT' : fullStatus} row from the save`, safeLogValue(name));
        }
        return { name, status: fullStatus, action: 'written' as const };
    }, { failClosed: true });
}

/**
 * The names a pass reconciles, sorted: every canonical player save, plus every
 * ledger row whose save is gone under EVERY spelling. A row whose save exists
 * only under a legacy key (the ledger key is always lowercase) is not an
 * orphan, and is left alone rather than deleted on one pass and recreated by
 * that player's next money write.
 */
async function sweepPopulation(store: SweepStore): Promise<string[]> {
    const [saveKeys, ledgerKeys] = await Promise.all([
        store.keys(`${SAVE_PREFIX}*`),
        store.keys(`${CURRENCY_LEDGER_PREFIX}*`),
    ]);
    const names = new Set<string>();
    const anySpelling = new Set<string>();
    for (const key of saveKeys) {
        const name = key.slice(SAVE_PREFIX.length);
        anySpelling.add(name.toLowerCase());
        if (isPlayerSaveName(name)) names.add(name);
    }
    for (const key of ledgerKeys) {
        const name = key.slice(CURRENCY_LEDGER_PREFIX.length);
        if (isPlayerSaveName(name) && !anySpelling.has(name)) names.add(name);
    }
    return [...names].sort();
}

/**
 * One bounded pass: up to `batch` players after the stored cursor, wrapping at
 * the end. A busy save lock or a lost race is simply left for the next pass.
 */
export async function runCurrencyLedgerSweep(
    opts: { store?: SweepStore; batch?: number; gateEnforced?: boolean; now?: number } = {},
): Promise<CurrencyLedgerSweepResult> {
    const store = opts.store ?? kv;
    const batch = Math.max(1, Math.floor(opts.batch ?? CURRENCY_LEDGER_SWEEP_BATCH));
    const population = await sweepPopulation(store);
    const cursor = String((await store.get<string>(CURRENCY_LEDGER_SWEEP_CURSOR_KEY)) ?? '');
    const start = population.findIndex((name) => name > cursor);
    const ordered = start < 0 ? population : [...population.slice(start), ...population.slice(0, start)];
    const slice = ordered.slice(0, batch);
    const result: CurrencyLedgerSweepResult = {
        scanned: 0, written: 0, removed: 0, held: [], raced: 0, errors: [],
        cursor, wrapped: start < 0 || start + slice.length >= population.length,
    };
    for (const name of slice) {
        result.scanned += 1;
        try {
            const outcome = await reconcileCurrencyLedger(name, { store, gateEnforced: opts.gateEnforced, now: opts.now });
            if (outcome.action === 'written') result.written += 1;
            else if (outcome.action === 'removed') result.removed += 1;
            else if (outcome.action === 'held') result.held.push(name);
            else if (outcome.action === 'raced') result.raced += 1;
        } catch (error) {
            result.errors.push(`${name}: ${(error as Error).message}`);
        }
        result.cursor = name;
    }
    if (slice.length > 0) await store.set(CURRENCY_LEDGER_SWEEP_CURSOR_KEY, result.cursor);
    return result;
}
