import { safeName } from '../_utils.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict } from '../save/_projected-write.js';
import {
    refundTowerDirectEntryReservation,
    refundTowerPartyEntryReservation,
} from './_party-entry.js';

/** The refund commits through mutatePlayerSave on the shared KV; only the clock is injectable. */
export type MissingTowerEntryRecoveryDeps = {
    now?: () => number;
};

type Compensation = { found: boolean; changed: boolean };

const INVALID_RECEIPT = 'invalid-receipt';

/**
 * Compensate only after the caller has authoritatively confirmed that a minted
 * run was never published. The save-local receipt makes this idempotent and
 * prevents a missing receipt from minting a refund.
 */
export async function compensateConfirmedMissingTowerEntry(input: {
    hostSlug: string;
    runId: string;
    partyId?: string;
}, deps: MissingTowerEntryRecoveryDeps = {}): Promise<Compensation> {
    const now = deps.now ?? Date.now;
    const hostSlug = safeName(input.hostSlug);
    if (!hostSlug) throw new Error('Tower entry compensation host is invalid.');
    let out: PlayerSaveMutationResult<Compensation>;
    try {
        // The refund and its receipt commit in one write, so a lost
        // compare-and-set re-runs once against the fresh save.
        out = await retryOnSaveVersionConflict(() => mutatePlayerSave<Compensation>(hostSlug, ({ character }) => {
            const refund = input.partyId
                ? refundTowerPartyEntryReservation({ character, partyId: input.partyId, runId: input.runId, now: now() })
                : refundTowerDirectEntryReservation({ character, runId: input.runId, now: now() });
            if (!refund.ok) {
                if (refund.code === 'missing-receipt') return { ok: true, write: false, character, value: { found: false, changed: false } };
                return { ok: false, status: 409, error: INVALID_RECEIPT };
            }
            if (!refund.changed) return { ok: true, write: false, character, value: { found: true, changed: false } };
            return {
                ok: true,
                character: refund.character,
                value: { found: true, changed: true },
                // The refund already recorded its Hollow Gate provenance; the
                // version bump records it again from the pre-refund character
                // and must reach the same answer, not the default 'external'.
                ...(refund.hollowGateCurrencySource ? { hollowGateCurrencySource: refund.hollowGateCurrencySource } : {}),
            };
        }));
    } catch (error) {
        if (isPlayerSaveVersionConflict(error)) throw new Error('Tower entry compensation save write was rejected.');
        throw error;
    }
    if (!out.ok) {
        throw new Error(out.error === INVALID_RECEIPT
            ? 'Tower entry compensation receipt is invalid.'
            : 'Tower entry compensation save is unavailable.');
    }
    return out.value;
}
