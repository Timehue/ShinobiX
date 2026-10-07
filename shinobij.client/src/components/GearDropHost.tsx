import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { useWeeklyBossRewardSync } from "../lib/use-weekly-boss-reward-sync";
import { stepCounts } from "../lib/gear-drop-watch";
import { dismissGearDrop, getGearDropsSnapshot, observeGearCounts, subscribeGearDrops } from "../lib/gear-drop-store";
import { lazyWithRetry } from "../lib/lazyWithRetry";

const GearDropToasts = lazyWithRetry(() =>
    import("./GearDropToasts").then((module) => ({ default: module.GearDropToasts })),
);

/**
 * Announces a gear step drop the moment one lands in the player's bag, whichever
 * fight, chest or boss paid it. What counts as news, and what stays quiet, is
 * decided by lib/gear-drop-store: it remembers per account which drops were
 * already announced, so logging in never repeats an old one.
 *
 * It is also where a Weekly Boss winner's payout is brought into the bag live
 * (lib/use-weekly-boss-reward-sync), because it is mounted for every signed in
 * player on every screen and the boss pays into their save with no reply.
 */
export function GearDropHost({ character, onVersionedCharacter, saveIsClean }: { character: Character | null; onVersionedCharacter: VersionedCharacterCommit; saveIsClean: () => boolean }) {
    const name = character?.name ?? null;
    useWeeklyBossRewardSync(name, onVersionedCharacter, saveIsClean);
    const counts = useMemo(
        () => stepCounts(character?.inventory, character?.equipment),
        [character?.inventory, character?.equipment],
    );
    useEffect(() => { observeGearCounts(name, counts); }, [name, counts]);
    const drops = useSyncExternalStore(subscribeGearDrops, getGearDropsSnapshot, getGearDropsSnapshot);

    if (drops.length === 0) return null;
    return (
        <Suspense fallback={null}>
            <GearDropToasts drops={[...drops]} onDismiss={dismissGearDrop} />
        </Suspense>
    );
}
