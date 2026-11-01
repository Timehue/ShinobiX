import { useEffect, useRef } from "react";
import { gameToast } from "../components/GameToast";
import type { Character } from "../types/character";
import { completeRiftRun, type RiftResponse } from "./rift-run";

const RETRY_MS = 30_000;
const MAX_ATTEMPTS = 5;

/** True when a failed claim says nothing about the quest itself, so asking again can work. */
export function riftClaimShouldRetry(response: RiftResponse): boolean {
    return !response.ok && (response.reason === "offline" || response.reason === "run-open" || !response.reason);
}

/** The rift this character can claim now: a recorded boss kill and no open run. */
export function claimableRiftId(character: Character | null): string | null {
    const riftId = character?.riftQuestBossReceipt?.riftId;
    return riftId && !character?.hollowGateRun ? riftId : null;
}

/**
 * Redeems a rift's boss receipt once its run has ended. The receipt lives on the
 * save, so a shinobi win, a pet win, a dropped reply and a reload all land here.
 * The server pays each receipt once, under the save lock.
 */
export function useRiftClaim(
    character: Character | null,
    setCharacter: (updater: (prev: Character | null) => Character | null) => void,
): void {
    const name = character?.name;
    const riftId = claimableRiftId(character);
    const runToken = character?.riftQuestBossReceipt?.runToken;
    const claiming = useRef<string | null>(null);

    useEffect(() => {
        if (!name || !riftId || !runToken || claiming.current === runToken) return;
        claiming.current = runToken;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const attempt = async (count: number) => {
            const response = await completeRiftRun(name, riftId, setCharacter, (line) => gameToast(line));
            if (claiming.current !== runToken || !riftClaimShouldRetry(response)) return;
            // Past the last attempt the receipt stays on the save, so the next load claims it.
            if (count < MAX_ATTEMPTS) timer = setTimeout(() => { void attempt(count + 1); }, RETRY_MS);
        };
        void attempt(1);
        return () => {
            clearTimeout(timer);
            claiming.current = null;
        };
    }, [name, riftId, runToken, setCharacter]);
}
