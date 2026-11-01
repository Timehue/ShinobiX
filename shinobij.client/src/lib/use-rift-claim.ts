import { useEffect } from "react";
import type { Character } from "../types/character";

/** The rift this character can claim now: a recorded boss kill and no open run. */
export function claimableRiftId(character: Character | null): string | null {
    const riftId = character?.riftQuestBossReceipt?.riftId;
    return riftId && !character?.hollowGateRun ? riftId : null;
}

/**
 * Redeems a rift's boss receipt once its run has ended. The receipt lives on the
 * save, so a shinobi win, a pet win, a dropped reply and a reload all land here.
 * The server pays each receipt once, under the save lock. The claim itself loads
 * on demand: this hook sits in the startup graph, which has no bytes to spare.
 */
export function useRiftClaim(
    character: Character | null,
    setCharacter: (updater: (prev: Character | null) => Character | null) => void,
): void {
    const name = character?.name;
    const riftId = claimableRiftId(character);
    const runToken = character?.riftQuestBossReceipt?.runToken;

    useEffect(() => {
        if (!name || !riftId || !runToken) return;
        let current = true;
        void import("./rift-server")
            .then(({ runRiftClaim }) => runRiftClaim(name, riftId, setCharacter, () => current))
            .catch(() => undefined);
        return () => { current = false; };
    }, [name, riftId, runToken, setCharacter]);
}
