/*
 * The one commit every player-save writer goes through (P0-5, step 3 of
 * docs/runbooks/currency-ledger-cutover.md).
 *
 * A save write that MOVES CURRENCY commits the save and its currency ledger
 * row (`ledger:currency:<name>`, api/_currency-ledger.ts) in ONE Postgres
 * transaction (kv.compareSetMany). The save's currency fields stay an exact
 * mirror of the ledger, so every existing reader of `character.ryo` keeps
 * working and a revert never loses money; what changes is that the two can no
 * longer disagree, and that every money write is checked against the ledger
 * before it lands.
 *
 * A write that does NOT move currency (the common autosave) takes the fast
 * path: the same single compare-and-set as before, with no ledger I/O at all.
 *
 * ── The check ────────────────────────────────────────────────────────────────
 * Before each money write the stored ledger row is classified against the
 * stored save it mirrors (classifyCurrencyLedger). Every status other than
 * `match` and `lagging` is counted, and the unexpected ones are logged; those
 * counts are the evidence the fail-closed step is gated on. Until that step
 * the save wins: the new row is always built from the balances being written.
 */
import type { KvCasOp, KvLike } from '../_storage.js';
import { safeLogValue } from '../_safe-log.js';
import { storedValueEquals } from '../_stored-value.js';
import { withinPlayerSaveCommit } from '../_save-write-guard.js';
import {
    CURRENCY_LEDGER_FIELDS,
    balancesDiffer,
    buildCurrencyLedgerRow,
    classifyCurrencyLedger,
    currencyLedgerKey,
    projectBalances,
    recordCurrencyLedgerEvent,
    syncCurrencyLedger,
    type CurrencyLedger,
    type CurrencyLedgerEvent,
    type LedgerStatus,
} from '../_currency-ledger.js';

type SaveRecord = Record<string, unknown>;
type CommitStore = Pick<KvLike, 'get' | 'compareSet'> & Partial<Pick<KvLike, 'compareSetMany' | 'set'>>;

/** The event each counted status is recorded under; `match` and `lagging` are normal play. */
const STATUS_EVENT: Partial<Record<LedgerStatus, CurrencyLedgerEvent>> = {
    missing: 'ledger-created',
    legacy: 'ledger-upgraded',
    orphan: 'ledger-orphan',
    ahead: 'ledger-ahead',
    'lagging-different': 'ledger-lagging-different',
    divergent: 'ledger-divergent',
};

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function characterOf(record: SaveRecord | null | undefined): SaveRecord | null {
    const character = record?.character;
    return character && typeof character === 'object' && !Array.isArray(character) ? character as SaveRecord : null;
}

/** Thrown only once the fail-closed step is enforced: a same-version disagreement refuses the money write. */
export class CurrencyLedgerDivergenceError extends Error {
    constructor(playerName: string) {
        super(`Currency ledger disagrees with the save for ${playerName}; the write was refused.`);
        this.name = 'CurrencyLedgerDivergenceError';
    }
}

/**
 * Whether a `divergent` ledger refuses the write. Report-only until the soak
 * gate in docs/runbooks/currency-ledger-cutover.md is met; that step flips
 * CURRENCY_LEDGER_GATE_ENFORCED in code. DISABLE_CURRENCY_LEDGER_GATE=1 is the
 * emergency opt-out once it is on.
 */
export const CURRENCY_LEDGER_GATE_ENFORCED = false;
export function currencyLedgerGateEnforced(env: NodeJS.ProcessEnv = process.env, enforced = CURRENCY_LEDGER_GATE_ENFORCED): boolean {
    return enforced && env.DISABLE_CURRENCY_LEDGER_GATE !== '1';
}

/** Emergency opt-out: back to compare-and-set followed by a best-effort projection. */
export function currencyLedgerAtomicDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_CURRENCY_LEDGER_ATOMIC === '1';
}

export type PlayerSaveCommit = {
    /** Owner of the save; the ledger key is derived from it. */
    playerName: string;
    saveKey: string;
    /** The exact stored row this write replaces (null: the save must not exist). */
    expected: SaveRecord | null;
    /** The complete record to store. */
    intended: SaveRecord;
};

export type PlayerSaveCommitOptions = {
    /** Test seam for the fail-closed gate (defaults to CURRENCY_LEDGER_GATE_ENFORCED). */
    gateEnforced?: boolean;
    now?: number;
};

/**
 * Commit a player save, and — when it moves currency — its ledger row in the
 * same transaction. Resolves true when committed, false when the save (or the
 * ledger row) moved since it was read; nothing is written on false. Errors
 * propagate unchanged, so a caller's lost-reply read-back still applies: if the
 * save reads back as `intended`, the ledger row committed with it.
 *
 * The caller must hold the save's lock (`withKvLock('save:<name>')`), exactly as
 * for the plain compare-and-set this replaces.
 */
export function commitPlayerSaveRecord(
    store: CommitStore,
    commit: PlayerSaveCommit,
    opts: PlayerSaveCommitOptions = {},
): Promise<boolean> {
    // The scope the runtime raw-write guard (api/_save-write-guard.ts) treats
    // as the sanctioned path for a player-save write.
    return withinPlayerSaveCommit(() => commitInScope(store, commit, opts));
}

async function commitInScope(
    store: CommitStore,
    commit: PlayerSaveCommit,
    opts: PlayerSaveCommitOptions,
): Promise<boolean> {
    const { playerName, saveKey, expected, intended } = commit;
    const after = projectBalances(characterOf(intended));
    const movesCurrency = Object.keys(after).length > 0
        && balancesDiffer(projectBalances(characterOf(expected)), after);

    // Fast path: currency did not move, so the ledger cannot have become more
    // wrong. One compare-and-set, exactly as before this helper existed.
    if (!movesCurrency) return await store.compareSet(saveKey, expected, intended);

    if (!store.compareSetMany || currencyLedgerAtomicDisabled()) {
        const committed = await store.compareSet(saveKey, expected, intended);
        if (committed && store.set) {
            await syncCurrencyLedger(playerName, intended, {
                kv: store as Pick<KvLike, 'get' | 'set'>,
                previousCharacter: characterOf(expected),
            });
        }
        return committed;
    }

    const ledgerKey = currencyLedgerKey(playerName);
    // Two attempts: the second only when the SAVE is unchanged, i.e. the ledger
    // row alone moved (an older process's best-effort projection during a deploy
    // overlap, or an unlocked audit repair). The save lock is held throughout.
    let reported: LedgerStatus | null = null;
    for (let attempt = 1; ; attempt++) {
        const ledger = await store.get<CurrencyLedger>(ledgerKey);
        const status = classifyCurrencyLedger(expected, ledger);
        // A retry re-reads the row; count what it finds only if that changed.
        if (status !== reported) reportStatus(playerName, status, expected, ledger);
        reported = status;
        if (status === 'divergent' && currencyLedgerGateEnforced(process.env, opts.gateEnforced)) {
            throw new CurrencyLedgerDivergenceError(playerName);
        }
        // An orphan belongs to a deleted account: nothing of it carries over.
        const continuing = status === 'orphan' ? null : ledger;
        const ops: KvCasOp[] = [
            { op: 'cas', key: saveKey, expected, value: intended },
            { op: 'cas', key: ledgerKey, expected: ledger ?? null, value: buildCurrencyLedgerRow(playerName, intended, continuing, opts.now) },
        ];
        if (await store.compareSetMany(ops)) return true;
        if (attempt >= 2) return false;
        // Retry only for the one refusal this helper can explain and repair:
        // the save is exactly as read, and the ledger row is not. Anything else
        // (the save moved, or a refusal with both rows unchanged) is the
        // caller's conflict, answered as before.
        if (!storedValueEquals(await store.get<SaveRecord>(saveKey), expected)) return false;
        if (storedValueEquals(await store.get<CurrencyLedger>(ledgerKey), ledger)) return false;
        void recordCurrencyLedgerEvent('ledger-race');
    }
}

/** The player a `save:<name>` key belongs to. */
export function playerNameOfSaveKey(saveKey: string): string {
    return saveKey.startsWith('save:') ? saveKey.slice('save:'.length) : saveKey;
}

/**
 * Drop-in for `store.compareSet(saveKey, expected, intended)` on a player save:
 * the same true/false contract, with the currency ledger committed alongside
 * when the write moves currency.
 */
export function commitPlayerSave(
    store: CommitStore,
    saveKey: string,
    expected: SaveRecord | null,
    intended: SaveRecord,
): Promise<boolean> {
    return commitPlayerSaveRecord(store, { playerName: playerNameOfSaveKey(saveKey), saveKey, expected, intended });
}

/**
 * The exact-acceptance variant (the rule of compareSetExactKvRow): the write is
 * accepted only when the save reads back as `intended`, which also adopts a
 * write whose acknowledgement was lost. Otherwise the commit's own error, or
 * `kv-compare-set-unconfirmed:<key>`, is thrown.
 */
export async function commitPlayerSaveExact(store: CommitStore, commit: PlayerSaveCommit): Promise<void> {
    let writeError: unknown;
    try {
        await commitPlayerSaveRecord(store, commit);
    } catch (error) {
        writeError = error;
    }
    const readback = await store.get(commit.saveKey).catch(() => null);
    if (storedValueEquals(readback, commit.intended)) return;
    if (writeError) throw writeError;
    throw new Error(`kv-compare-set-unconfirmed:${commit.saveKey}`);
}

function reportStatus(playerName: string, status: LedgerStatus, save: SaveRecord | null, ledger: CurrencyLedger | null): void {
    const event = STATUS_EVENT[status];
    if (!event) return;
    void recordCurrencyLedgerEvent(event);
    // Creating or upgrading a row is the expected backfill: counted, not logged.
    if (status === 'missing' || status === 'legacy') return;
    const detail = {
        status,
        saveVersion: num(save?._saveVersion),
        ledgerVersion: num(ledger?.saveVersion),
        mismatched: CURRENCY_LEDGER_FIELDS
            .map((field) => ({ field, save: num(characterOf(save)?.[field]), ledger: num(ledger?.balances?.[field]) }))
            .filter((entry) => entry.save !== entry.ledger),
    };
    if (status === 'divergent') {
        console.error('[currency-ledger] DIVERGENT', safeLogValue(playerName), safeLogValue(JSON.stringify(detail)));
    } else {
        console.warn(`[currency-ledger] ${status}`, safeLogValue(playerName), safeLogValue(JSON.stringify(detail)));
    }
}
