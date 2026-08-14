import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { applyWarCrateGrants, claimServerWarCrates, claimServerWarRewards } from "./world-state";
import { warCrateServerAuthEnabled } from "./war-crate-flag";

/** Reconcile all ended-war payouts whenever either authoritative cache refreshes. */
export function useWarRewardClaims(
    character: Character | null,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
    onVersionedCharacter: VersionedCharacterCommit,
    worldStateVersion: number,
    clanWarStateVersion: number,
): void {
    const characterRef = useRef(character);
    const commitRef = useRef(onVersionedCharacter);
    useEffect(() => {
        characterRef.current = character;
    }, [character]);
    useEffect(() => {
        commitRef.current = onVersionedCharacter;
    }, [onVersionedCharacter]);

    useEffect(() => {
        const claimCharacter = characterRef.current;
        if (!claimCharacter || !warCrateServerAuthEnabled()) return;
        let cancelled = false;
        void (async () => {
            const ids = await claimServerWarCrates(claimCharacter);
            if (cancelled) return;
            if (ids.length) setCharacter((prev) => prev ? applyWarCrateGrants(prev, ids).character : prev);
            const reward = await claimServerWarRewards(claimCharacter);
            if (cancelled || !reward) return;
            if (!commitRef.current(reward.character, reward._saveVersion)) return;
            if (reward.crates > 0) alert(`You received ${reward.crates} Legendary War Crate${reward.crates > 1 ? "s" : ""} from recent war rewards! Check your inventory.`);
            else if (reward.mvp) alert("MVP rewards delivered: bonus ryo, honor seals, and fate shards added to your account.");
            else if (reward.consolation) alert("Consolation rewards from a recent war loss have been added to your account.");
        })();
        return () => { cancelled = true; };
    }, [character?.name, worldStateVersion, clanWarStateVersion, setCharacter]);
}
