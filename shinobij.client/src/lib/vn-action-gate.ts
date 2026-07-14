export type VnActionLock = { current: boolean };

/** Claim one VN transition synchronously, before React can batch a re-render. */
export function claimVnAction(lock: VnActionLock): boolean {
    if (lock.current) return false;
    lock.current = true;
    return true;
}
