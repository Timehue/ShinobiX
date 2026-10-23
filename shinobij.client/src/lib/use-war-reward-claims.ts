import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { applyWarCrateGrants, claimServerWarCrates, claimServerWarRewards } from "./world-state";
import { warCrateServerAuthEnabled } from "./war-crate-flag";
import { claimSectorWarPurses, sectorPurseAlert, warRewardAlert } from "./war-purse-claims";

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
            const crates = await claimServerWarCrates(claimCharacter);
            // A granted claim is remembered as settled, so no later sweep will
            // deliver it again: adopt it even if a newer poll cancelled this run.
            // The commit itself refuses an older or foreign version. Only if the
            // server's save can't be adopted, mirror the crate locally.
            const adopted = !!crates.character && commitRef.current(crates.character, crates._saveVersion);
            if (crates.ids.length && !adopted) {
                setCharacter((prev) => prev && prev.name === claimCharacter.name ? applyWarCrateGrants(prev, crates.ids).character : prev);
            }
            if (cancelled) return;
            const reward = await claimServerWarRewards(claimCharacter);
            if (reward && commitRef.current(reward.character, reward._saveVersion)) {
                // The village-war purse rides this claim (2026-10 rebalance).
                const message = warRewardAlert(reward);
                if (message) alert(message);
            }
            if (cancelled) return;
            // Sector-war purses name no war: their own claim, throttled per session.
            const sector = await claimSectorWarPurses(claimCharacter);
            if (sector && commitRef.current(sector.character, sector._saveVersion) && sector.ryo > 0) alert(sectorPurseAlert(sector.ryo));
        })();
        return () => { cancelled = true; };
    }, [character?.name, worldStateVersion, clanWarStateVersion, setCharacter]);
}
