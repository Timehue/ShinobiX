import { useState } from "react";

/** Reset a retained battle host when navigation selects another challenge. */
export function useClanWarBattleKey(): string | null {
    let currentKey: string | null = null;
    try {
        const { warId, challengeId } = JSON.parse(sessionStorage.getItem("clanWarChallenge.v1") ?? "{}");
        if (typeof warId === "string" && warId && typeof challengeId === "string" && challengeId) {
            currentKey = JSON.stringify([warId, challengeId]);
        }
    } catch { /* The screen renders its existing missing-binding gate. */ }
    const [lastKey, setLastKey] = useState(currentKey);
    if (currentKey && currentKey !== lastKey) setLastKey(currentKey);
    // Card battles clear their stash on completion. Keep the finished table
    // mounted until another valid challenge replaces it or the player leaves.
    return currentKey ?? lastKey;
}
