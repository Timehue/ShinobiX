import { WF_MAX_SECONDS } from '../_pet-sim/pet-warfront-sim.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';

type WarfrontTokenMaturity = { notBefore?: number };
export type WarfrontLeaseSettlement = {
    forfeited?: boolean;
    leaseHeldUntil?: number;
};

export const WARFRONT_FORFEIT_MAX_COOLDOWN_SECONDS = WF_MAX_SECONDS;

export function warfrontActiveAuthorizationKey(playerName: string): string {
    return `pet:warfront-active:${playerName}`;
}

export function warfrontForfeitLeaseUntil(token: WarfrontTokenMaturity, now = Date.now()): number {
    const requested = typeof token.notBefore === 'number' && Number.isFinite(token.notBefore) ? token.notBefore : now;
    return Math.max(now, Math.min(requested, now + WARFRONT_FORFEIT_MAX_COOLDOWN_SECONDS * 1000));
}

/** Replace only this match's redeemable lease with a bounded, non-searchable
 * marker. Holding the active-key lock makes concurrent result/forfeit recovery
 * converge on one marker; neither path can clear or overwrite a newer match. */
export async function holdWarfrontForfeitRerollLease(
    playerName: string,
    battleToken: string,
    reportKey: string,
    heldUntil: number | undefined,
): Promise<void> {
    const key = warfrontActiveAuthorizationKey(playerName);
    const remaining = typeof heldUntil === 'number' && Number.isFinite(heldUntil)
        ? Math.max(0, Math.ceil((heldUntil - Date.now()) / 1000))
        : 0;
    if (remaining <= 0) {
        await kv.delIfEqual(key, battleToken);
        return;
    }
    await withKvLock(key, async () => {
        const current = await kv.get<unknown>(key);
        if (current !== battleToken) return;
        const marker = `forfeit-cooldown:${reportKey}:${Math.floor(heldUntil as number)}`;
        await kv.set(key, marker, { ex: Math.min(WARFRONT_FORFEIT_MAX_COOLDOWN_SECONDS, remaining) });
    }, { failClosed: true });
}

/** Reconcile the exact active authorization after a durable settlement. A
 * normal receipt releases it; a forfeit receipt retains regulation maturity. */
export async function reconcileWarfrontActiveAuthorization(
    playerName: string,
    battleToken: string,
    reportKey: string,
    settlement: WarfrontLeaseSettlement | null | undefined,
): Promise<void> {
    if (settlement?.forfeited) {
        await holdWarfrontForfeitRerollLease(playerName, battleToken, reportKey, settlement.leaseHeldUntil);
        return;
    }
    await kv.delIfEqual(warfrontActiveAuthorizationKey(playerName), battleToken);
}
