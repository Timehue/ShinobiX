/*
 * Runtime guard for player-save writes that skip the commit helper (P0-5).
 *
 * Every player save is meant to be committed through commitPlayerSaveRecord
 * (api/save/_commit-player-save.ts), which moves the currency ledger in the
 * same transaction. The AST ratchet in api/save/_versioned-save-writes.test.ts
 * enforces that for every key it can resolve statically; it cannot see a key
 * built at runtime. This guard sees every write the Postgres store performs:
 * a `save:<player>` write made outside the helper's scope is logged once per
 * call site and, on the deployed (Railway) server, counted
 * (`telemetry:currency-ledger:raw-save-write:<day>`).
 *
 * Observation only. It never refuses or alters a write, and a failure inside it
 * is swallowed: the price of a bug here is a missing log line, not a lost save.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const commitScope = new AsyncLocalStorage<true>();
const reportedSites = new Set<string>();
const MAX_REPORTED_SITES = 50;
const NON_PLAYER_SAVES = new Set(['admin1', 'admin2']);

/** Run a player-save commit inside the scope the guard recognises. */
export function withinPlayerSaveCommit<T>(fn: () => Promise<T>): Promise<T> {
    return commitScope.run(true, fn);
}

export function inPlayerSaveCommit(): boolean {
    return commitScope.getStore() === true;
}

/** `save:<player>` — not a clan blob, an admin content slot, or a health probe. */
export function isGuardedPlayerSaveKey(key: string): boolean {
    if (!key.startsWith('save:')) return false;
    const name = key.slice('save:'.length);
    return name.length > 0
        && !name.startsWith('clan-')
        && !name.startsWith('health-probe-')
        && !NON_PLAYER_SAVES.has(name.toLowerCase());
}

/** The first stack frame outside the storage layer: the code that made the write. */
function callSite(stack: string | undefined): string {
    const frames = (stack ?? '').split('\n').slice(1).map((line) => line.trim());
    const outside = frames.find((frame) => !/[\\/]_storage\.(ts|js)[:)?]|[\\/]_save-write-guard\.(ts|js)[:)?]|node:internal|node_modules/.test(frame));
    return outside ?? frames[0] ?? 'unknown';
}

/**
 * Note a write to `key` by `operation`. Cheap when the key is not a player save
 * or the write is inside the helper's scope; otherwise logs (once per site) and
 * counts.
 */
export function observePlayerSaveWrite(key: string, operation: string): void {
    try {
        if (!isGuardedPlayerSaveKey(key) || inPlayerSaveCommit()) return;
        const site = callSite(new Error().stack);
        if (!reportedSites.has(site) && reportedSites.size < MAX_REPORTED_SITES) {
            reportedSites.add(site);
            console.warn(`[currency-ledger] raw save write (${operation}) outside the commit helper at ${site}`);
        }
        // The daily counter is the deployed server's evidence. Local runs and
        // storage-shim tests get the log line only: a background counter write
        // there would land in the middle of an unrelated test's statement log.
        if (!process.env.RAILWAY_ENVIRONMENT) return;
        void import('./_currency-ledger.js')
            .then(({ recordCurrencyLedgerEvent }) => recordCurrencyLedgerEvent('raw-save-write'))
            .catch(() => undefined);
    } catch {
        // Observation must never affect the write it observes.
    }
}

/** Test seam: forget which call sites have been reported. */
export function _resetSaveWriteGuardForTest(): void {
    reportedSites.clear();
}
