import { useCallback, useEffect, useState } from "react";
import {
    normalizeMasteryFocus,
    type ActivitySpine,
    type ActivitySpineItem,
    type MasteryFocus,
} from "../../../shared/activity-spine";

export type ActivitySpineStatus = "idle" | "loading" | "ready" | "offline" | "error";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { spine: ActivitySpine; cachedAt: number }>();
const pending = new Map<string, Promise<ActivitySpine>>();

function keyFor(playerName: string, focus: MasteryFocus): string {
    return `${playerName.trim().toLowerCase()}::${focus}`;
}

function cachedSpine(key: string, now = Date.now()): ActivitySpine | null {
    const entry = cache.get(key);
    if (!entry || now - entry.cachedAt >= CACHE_TTL_MS) return null;
    return entry.spine;
}

async function requestSpine(playerName: string, focus: MasteryFocus, force = false): Promise<ActivitySpine> {
    const key = keyFor(playerName, focus);
    if (!force) {
        const cached = cachedSpine(key);
        if (cached) return cached;
    }
    // A retry/TTL refresh skips cached data but still joins another live fetch.
    // The persistent pin, mobile profile, and Daily Briefing can all mount at
    // once; they must not turn one recommendation refresh into three requests.
    const activeRequest = pending.get(key);
    if (activeRequest) return activeRequest;

    const request = fetch(`/api/player/activity-spine?player=${encodeURIComponent(playerName)}&focus=${encodeURIComponent(focus)}`)
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json() as { spine?: ActivitySpine };
            if (!data.spine) throw new Error("Missing activity spine");
            cache.set(key, { spine: data.spine, cachedAt: Date.now() });
            return data.spine;
        })
        .finally(() => {
            if (pending.get(key) === request) pending.delete(key);
        });
    pending.set(key, request);
    return request;
}

export function preferredNowActivity(spine: ActivitySpine | null): ActivitySpineItem | null {
    if (!spine) return null;
    return spine.horizons.now.find((activity) => activity.eligibility !== "complete")
        ?? spine.horizons.now[0]
        ?? null;
}

export function useActivitySpine(
    playerName: string,
    focusValue: unknown,
    enabled = true,
): {
    spine: ActivitySpine | null;
    status: ActivitySpineStatus;
    retry: () => void;
} {
    const focus = normalizeMasteryFocus(focusValue);
    const key = keyFor(playerName, focus);
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState<{ key: string; spine: ActivitySpine | null; status: ActivitySpineStatus }>(() => {
        const initial = enabled ? cachedSpine(key) : null;
        return { key, spine: initial, status: !enabled ? "idle" : initial ? "ready" : "loading" };
    });

    useEffect(() => {
        if (!enabled || !playerName.trim()) return;
        let live = true;
        void requestSpine(playerName, focus, revision > 0)
            .then((spine) => {
                if (live) setState({ key, spine, status: "ready" });
            })
            .catch(() => {
                if (!live) return;
                const offline = typeof navigator !== "undefined" && navigator.onLine === false;
                setState({ key, spine: null, status: offline ? "offline" : "error" });
            });
        return () => { live = false; };
    }, [enabled, focus, key, playerName, revision]);

    useEffect(() => {
        if (!enabled || !playerName.trim()) return;
        // Server recommendations include timers, resumable runs, clan state,
        // and progression facts that may change without altering focus/name.
        // Refresh in place; the effect above keeps the last good plan visible
        // while the request is in flight instead of flashing an empty pin.
        const interval = window.setInterval(() => {
            if (!cachedSpine(key)) setRevision((value) => value + 1);
        }, CACHE_TTL_MS);
        return () => window.clearInterval(interval);
    }, [enabled, key, playerName]);

    const retry = useCallback(() => {
        cache.delete(key);
        setRevision((value) => value + 1);
    }, [key]);

    if (!enabled || !playerName.trim()) return { spine: null, status: "idle", retry };
    if (state.key !== key) {
        const cached = cachedSpine(key);
        return { spine: cached, status: cached ? "ready" : "loading", retry };
    }
    return state.status === "idle"
        ? { spine: null, status: "loading", retry }
        : { spine: state.spine, status: state.status, retry };
}

export const __activitySpineClientTest = {
    request: requestSpine,
    clear() {
        cache.clear();
        pending.clear();
    },
};
