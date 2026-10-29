import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";

// This hook runs from App, so anything it imports statically lands in the
// startup graph, which has well under 1 KB of gzip budget left
// (scripts/check-build-size.mjs). The guard API and bonus helpers only matter
// once a player is on duty, so they load on the first refresh.
const loadGuardApi = () => Promise.all([import("./clan-api"), import("./village-upgrades")]);

/**
 * How often an on-duty client re-signs its guard post. The server keeps a
 * `guard:<name>` post for 300 s (api/village-guard/queue.ts) so a shinobi who
 * closes the game drops off the roster; staying under half that leaves room
 * for one missed refresh before the post lapses.
 */
export const GUARD_DUTY_REFRESH_MS = 120_000;

/**
 * Refusals that mean the post can no longer be held, so "On duty" must clear.
 * postGuardQueue throws a ClanSaveError carrying the HTTP status (0 when the
 * request never reached the server).
 */
export function guardRefusalEndsDuty(error: unknown): boolean {
    const status = (error as { status?: unknown } | null)?.status;
    return status === 403 || status === 409;
}

/*
 * Keep a Village Guard sign-up alive while the game is open.
 *
 * Signing up used to write the 5-minute server post once, while the save kept
 * `guardQueued: true` for good. After five minutes every PvP, raid and roster
 * read saw the player off duty while Town Hall still showed "On duty" and the
 * heartbeat stayed on its combat cadence. This re-signs the post on an interval
 * and clears the flag when the server refuses it (hospital, a village move, the
 * Academy gate), so the badge matches what defenders actually face.
 */
export function useGuardDutyRefresh(
    character: Character | null,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
    notify?: (message: string) => void,
): void {
    // The payload's level and bonus change with the character; read them from a
    // ref so a re-render never restarts the interval (or fires an extra post).
    const characterRef = useRef(character);
    const notifyRef = useRef(notify);
    useEffect(() => { characterRef.current = character; notifyRef.current = notify; }, [character, notify]);

    const name = character?.name;
    const village = character?.village;
    const onDuty = !!character?.guardQueued;

    useEffect(() => {
        if (!name || !village || !onDuty) return;
        let cancelled = false;
        const refresh = async () => {
            const current = characterRef.current;
            if (!current?.guardQueued || current.name !== name) return;
            try {
                // A failed chunk load rejects here too; it is not a refusal, so
                // duty stands and the next interval tries again.
                const [{ postGuardQueue }, { getTownDefenseGuardBonus }] = await loadGuardApi();
                await postGuardQueue("queue", {
                    name,
                    village,
                    level: current.level,
                    defenseBonusPercent: getTownDefenseGuardBonus(current),
                });
            } catch (error) {
                if (cancelled || !guardRefusalEndsDuty(error)) return;
                setCharacter((prev) => prev && prev.name === name ? { ...prev, guardQueued: false } : prev);
                notifyRef.current?.(`You left Village Guard duty: ${error instanceof Error ? error.message : "the post was refused."}`);
            }
        };
        // Re-sign at once: a reload or a long sleep may have let the post lapse.
        void refresh();
        const timer = setInterval(() => { void refresh(); }, GUARD_DUTY_REFRESH_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [name, village, onDuty, setCharacter]);
}
