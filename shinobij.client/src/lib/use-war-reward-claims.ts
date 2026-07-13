import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";
import { applyWarCrateGrants, claimServerWarCrates, claimServerWarRewards } from "./world-state";
import { warCrateServerAuthEnabled } from "./war-crate-flag";

/** Reconcile all ended-war payouts whenever either authoritative cache refreshes. */
export function useWarRewardClaims(
    character: Character | null,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
    worldStateVersion: number,
    clanWarStateVersion: number,
): void {
    useEffect(() => {
        if (!character || !warCrateServerAuthEnabled()) return;
        let cancelled = false;
        void (async () => {
            const ids = await claimServerWarCrates(character);
            if (cancelled) return;
            if (ids.length) setCharacter((prev) => prev ? applyWarCrateGrants(prev, ids).character : prev);
            const reward = await claimServerWarRewards(character);
            if (cancelled || !reward) return;
            setCharacter(reward.character);
            if (reward.crates > 0) alert(`You received ${reward.crates} Legendary War Crate${reward.crates > 1 ? "s" : ""} from recent war rewards! Check your inventory.`);
            else if (reward.mvp) alert("MVP rewards delivered: bonus ryo, honor seals, and fate shards added to your account.");
            else if (reward.consolation) alert("Consolation rewards from a recent war loss have been added to your account.");
        })();
        return () => { cancelled = true; };
    }, [character?.name, worldStateVersion, clanWarStateVersion, setCharacter]);
}
