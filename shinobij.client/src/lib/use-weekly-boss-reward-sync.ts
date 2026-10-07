import { useEffect, useLayoutEffect, useRef } from "react";
import type { VersionedCharacterCommit } from "../types/character";
import { visiblePoll } from "./poll";
import { syncWeeklyBossRewards } from "./weekly-boss-reward-sync";

/** How often a signed in player re-reads the boss. The endpoint is edge cached, so this is cheap. */
export const WEEKLY_BOSS_REWARD_CHECK_MS = 60 * 1000;
/** When a check had to wait for the player's unsaved edits to be saved, look again this soon. */
export const WEEKLY_BOSS_REWARD_RETRY_MS = 10 * 1000;
const MAX_QUICK_RETRIES = 6;

/**
 * Keeps a signed in Weekly Boss winner's bag in step with the server. The boss pays
 * its winners inside their saves with no reply to carry it, so this reads the public
 * boss state while the tab is visible and adopts the winner's save once per boss.
 * It runs on every screen, so a winner sees the Core, Key and any gear piece without
 * having to refresh. See lib/weekly-boss-reward-sync.
 *
 * Adopting a save replaces the local character, so it holds off while the player has
 * unsaved edits (`isSaveClean`) and looks again a few seconds later. The commit and
 * the check are read through refs so App's per render callbacks never restart the poll.
 */
export function useWeeklyBossRewardSync(name: string | null, commit: VersionedCharacterCommit, isSaveClean: () => boolean): void {
    const latest = useRef({ commit, isSaveClean });
    useLayoutEffect(() => { latest.current = { commit, isSaveClean }; });
    useEffect(() => {
        if (!name) return;
        let alive = true;
        let retries = 0;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const check = () => {
            void fetch("/api/weekly-boss", { method: "GET" })
                .then((response) => (response.ok ? response.json() : null))
                .then(async (data) => {
                    if (!alive || !data?.boss) return;
                    const result = await syncWeeklyBossRewards(data.boss, {
                        name,
                        commit: (character, version) => latest.current.commit(character, version),
                        isSaveClean: () => latest.current.isSaveClean(),
                        isCurrent: () => alive,
                    });
                    if (result === "deferred" && alive && retries < MAX_QUICK_RETRIES) {
                        retries += 1;
                        retryTimer = setTimeout(check, WEEKLY_BOSS_REWARD_RETRY_MS);
                    } else if (result !== "deferred") {
                        retries = 0;
                    }
                })
                .catch(() => { /* best effort: the next check or a refresh adopts it */ });
        };
        const stop = visiblePoll(check, WEEKLY_BOSS_REWARD_CHECK_MS, 0.1, { immediate: true });
        return () => { alive = false; clearTimeout(retryTimer); stop(); };
    }, [name]);
}
