import { useSyncExternalStore } from "react";
import { useSharedNow } from "./use-shared-now";
import { getSharedNow, subscribeSharedNow } from "./shared-now-store";
import { getActionDeadline, subscribeActionDeadlines } from "./action-deadline-store";

/** Display a server deadline that catches up immediately when a tab resumes. */
export function useActionDeadline(scope: string): number {
    const deadline = useSyncExternalStore(
        (listener) => subscribeActionDeadlines(listener),
        () => getActionDeadline(scope),
        () => 0,
    );
    const now = useSharedNow();
    return Math.max(0, deadline - now);
}

const noSubscription = () => () => undefined;

/**
 * The same value as useActionDeadline, but the caller only subscribes to the
 * one-second display clock while the deadline is still ahead. useActionDeadline
 * re-renders its caller every second even when there is no cooldown at all; for
 * the 5,000-line World Map that was a full reconcile (~16 ms on a mid-range
 * phone) every second the map was open. The stored clock is read without
 * subscribing to decide; a stale reading can only ever start one extra tick,
 * which refreshes it.
 */
export function useLiveActionDeadline(scope: string): number {
    const deadline = useSyncExternalStore(
        (listener) => subscribeActionDeadlines(listener),
        () => getActionDeadline(scope),
        () => 0,
    );
    const live = deadline > getSharedNow();
    const now = useSyncExternalStore(live ? subscribeSharedNow : noSubscription, getSharedNow, getSharedNow);
    return Math.max(0, deadline - now);
}
