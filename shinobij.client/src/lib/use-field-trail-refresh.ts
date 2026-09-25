import { useEffect, useState } from "react";
import { playerSlug } from "./utils";
import { FIELD_TRAIL_STATE_INVALIDATED_EVENT, invalidateFieldTrailStateReads } from "./field-trail-api";

type FieldTrailInvalidation = { playerKey: string; missionId: string };

/** Refresh accepted field contracts on progress changes and after a reconnect/resume. */
export function useFieldTrailRefreshVersion(playerName: string, missionIds: readonly string[]): number {
    const [version, setVersion] = useState(0);
    const playerKey = playerSlug(playerName);
    const missionKey = [...new Set(missionIds)].sort().join("|");

    useEffect(() => {
        if (!playerKey || !missionKey) return;
        const accepted = new Set(missionKey.split("|"));
        let lastResumeSignalAt = 0;
        const refreshOnResume = () => {
            const now = Date.now();
            if (now - lastResumeSignalAt < 1_000) return;
            lastResumeSignalAt = now;
            invalidateFieldTrailStateReads(playerKey);
            setVersion((current) => current + 1);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") refreshOnResume();
        };
        const onFieldTrailInvalidated = (event: Event) => {
            const detail = (event as CustomEvent<FieldTrailInvalidation>).detail;
            if (detail?.playerKey === playerKey && accepted.has(detail.missionId)) {
                setVersion((current) => current + 1);
            }
        };

        window.addEventListener("focus", refreshOnResume);
        window.addEventListener("online", refreshOnResume);
        window.addEventListener(FIELD_TRAIL_STATE_INVALIDATED_EVENT, onFieldTrailInvalidated);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.removeEventListener("focus", refreshOnResume);
            window.removeEventListener("online", refreshOnResume);
            window.removeEventListener(FIELD_TRAIL_STATE_INVALIDATED_EVENT, onFieldTrailInvalidated);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [playerKey, missionKey]);

    return version;
}
