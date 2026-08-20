export type VnActionLock = { current: boolean; claimedAt?: number };

/** A held claim goes stale after this window. Double-activation protection
 * only needs to outlive React's batching of the same input burst — holding
 * the claim FOREVER is what wedged the whole VN overlay (z-1000000, Skip
 * included) whenever a claimed action handed control back without advancing
 * the scene: a lost VN-launched battle, a failed finale reward claim. */
export const VN_ACTION_LOCK_EXPIRY_MS = 1_500;

/** Claim one VN transition synchronously, before React can batch a re-render.
 * The renderer still releases the lock on every scene advance; the expiry is
 * the self-heal for paths that never advance the scene. */
export function claimVnAction(lock: VnActionLock, now = Date.now()): boolean {
    if (lock.current && now - (lock.claimedAt ?? 0) < VN_ACTION_LOCK_EXPIRY_MS) return false;
    lock.current = true;
    lock.claimedAt = now;
    return true;
}
