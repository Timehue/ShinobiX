/*
 * _kage-unlock — the pure decision for the village Kage-system unlock
 * (api/village/kage.ts 'unlock' action). Extracted so the first-clear
 * semantics are test-locked:
 *
 *   • The FIRST verified finale clear unlocks the village, seats the clearer,
 *     and brands them firstLiberator — permanently, exactly once.
 *   • Every later verified clear changes NOTHING here (the seat is a live,
 *     contested object owned by the challenge system); those players still
 *     earn the liberator title via grantLiberatorReward in the handler.
 */

export type KageUnlockState = {
    kageSystemUnlocked: boolean;
    seatedKage?: string;
    firstLiberator?: string;
    unlockedAt?: number;
};

export function applyKageUnlock(
    current: KageUnlockState,
    playerName: string,
    now: number,
): { next: KageUnlockState; freshUnlock: boolean } {
    if (current.kageSystemUnlocked) {
        // Already unlocked: never reseat, never rebrand.
        return { next: current, freshUnlock: false };
    }
    return {
        next: {
            kageSystemUnlocked: true,
            seatedKage: playerName,
            firstLiberator: playerName,
            unlockedAt: now,
        },
        freshUnlock: true,
    };
}
