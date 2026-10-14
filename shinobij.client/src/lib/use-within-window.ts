import { useCallback, useSyncExternalStore } from "react";

// setTimeout clamps longer delays to 1 ms; an earlier wake simply re-arms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Whether the wall clock is inside [startsAt, endsAt). The answer only changes
 * at those two instants, so the caller re-renders exactly there (and when a
 * hidden tab returns, since background timers can run late) instead of on the
 * shared one-second clock, which re-rendered a whole stronghold every second
 * to decide one boolean. Missing bounds read as outside the window.
 */
export function useWithinWindow(startsAt: number | null | undefined, endsAt: number | null | undefined): boolean {
    const subscribe = useCallback((notify: () => void) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
            const now = Date.now();
            const next = [startsAt, endsAt].filter((at): at is number => typeof at === "number" && at > now).sort((a, b) => a - b)[0];
            if (next === undefined) return;
            timer = setTimeout(() => { notify(); arm(); }, Math.min(next - now + 1, MAX_TIMEOUT_MS));
        };
        const onVisible = () => { if (!document.hidden) notify(); };
        arm();
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            if (timer !== undefined) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [startsAt, endsAt]);
    const inside = useCallback(() => {
        const now = Date.now();
        return typeof startsAt === "number" && typeof endsAt === "number" && now >= startsAt && now < endsAt;
    }, [startsAt, endsAt]);
    return useSyncExternalStore(subscribe, inside, inside);
}
