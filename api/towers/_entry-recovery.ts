import { syncCurrencyLedger } from '../_currency-ledger.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { kv as realKv } from '../_storage.js';
import { mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    refundTowerDirectEntryReservation,
    refundTowerPartyEntryReservation,
} from './_party-entry.js';
import type { TowerKv, TowerLock } from './_tower-store.js';

export type MissingTowerEntryRecoveryDeps = {
    kv?: TowerKv;
    lock?: TowerLock;
    now?: () => number;
};

/**
 * Compensate only after the caller has authoritatively confirmed that a minted
 * run was never published. The save-local receipt makes this idempotent and
 * prevents a missing receipt from minting a refund.
 */
export async function compensateConfirmedMissingTowerEntry(input: {
    hostSlug: string;
    runId: string;
    partyId?: string;
}, deps: MissingTowerEntryRecoveryDeps = {}): Promise<{ found: boolean; changed: boolean }> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const hostSlug = safeName(input.hostSlug);
    if (!hostSlug) throw new Error('Tower entry compensation host is invalid.');
    const saveKey = `save:${hostSlug}`;
    return lock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!record || !character) throw new Error('Tower entry compensation save is unavailable.');
        const refund = input.partyId
            ? refundTowerPartyEntryReservation({ character, partyId: input.partyId, runId: input.runId, now: now() })
            : refundTowerDirectEntryReservation({ character, runId: input.runId, now: now() });
        if (!refund.ok) {
            if (refund.code === 'missing-receipt') return { found: false, changed: false };
            throw new Error('Tower entry compensation receipt is invalid.');
        }
        if (!refund.changed) return { found: true, changed: false };
        const next = bumpSaveVersion<Record<string, unknown>>({ ...record, character: refund.character });
        const written = await kv.set(saveKey, mergePreservingImages(next, record));
        if (written === null) throw new Error('Tower entry compensation save write was rejected.');
        if (kv === realKv) {
            await syncCurrencyLedger(hostSlug, next, {
                previousCharacter: character,
            });
        }
        return { found: true, changed: true };
    }, { failClosed: true });
}
