import type { KvLike } from './_storage.js';
import {
    abortWarDeclarationFunding,
    activateWarDeclarationFunding,
    settleReservedWarDeclarationFunding,
    type WarDeclarationFundingPlan,
    type WarDeclarationFundingReservation,
    type WarDeclarationFundingResult,
} from './_war-declaration-funding.js';

type SectorFundingStore = Pick<KvLike, 'get' | 'set' | 'compareSet'>;

export type SectorWarDeclarationFundingResult<T extends Record<string, unknown>> =
    | WarDeclarationFundingResult<T>
    | {
        status: 'expired';
        /** True only when a debit receipt already existed and was help-forwarded
         * to active authority. No new debit is ever started after the deadline. */
        activated: boolean;
        row: Record<string, unknown> | null;
    };

/**
 * Deadline-aware settlement for a row-first sector declaration.
 *
 * A sector's 72-hour play window is immutable in the published row. Once that
 * deadline is reached, beginning a new source intent/debit would charge for a
 * contest that can never become playable. Fence and abort before debit instead.
 * If an exact committed receipt predates recovery, help only that receipt
 * forward to active authority so it is not orphaned; due settlement will stamp
 * the already-ended contest immediately afterward.
 */
export async function settleReservedSectorWarDeclarationFunding<T extends Record<string, unknown>>(
    store: SectorFundingStore,
    plan: WarDeclarationFundingPlan<T>,
    reservation: Extract<WarDeclarationFundingReservation<T>, { status: 'acquired' | 'active' }>,
    endsAt: number,
    now: number = Date.now(),
): Promise<SectorWarDeclarationFundingResult<T>> {
    if (!Number.isSafeInteger(endsAt) || endsAt <= 0 || !Number.isSafeInteger(now) || now <= 0) {
        throw new TypeError('Sector funding deadline and clock must be positive safe integers.');
    }
    const executionPlan = { ...plan, now };
    if (now < endsAt) {
        return settleReservedWarDeclarationFunding(store, executionPlan, reservation);
    }

    if (reservation.status === 'active') {
        // This does not debit: the active branch only confirms the permanent
        // receipt that necessarily preceded activation.
        const confirmed = await settleReservedWarDeclarationFunding(store, executionPlan, reservation);
        return {
            status: 'expired',
            activated: confirmed.status === 'active',
            row: confirmed.status === 'active' ? confirmed.row : null,
        };
    }

    const aborted = await abortWarDeclarationFunding(
        store,
        plan.warKey,
        reservation.row,
        'window-expired',
        now,
    );
    if (aborted.status === 'aborted') {
        return { status: 'expired', activated: false, row: aborted.row };
    }
    if (aborted.status === 'funded') {
        const activation = await activateWarDeclarationFunding(store, plan.warKey, reservation.row, now);
        if (activation.status === 'active') {
            return { status: 'expired', activated: true, row: activation.row };
        }
        return activation;
    }
    return aborted;
}
