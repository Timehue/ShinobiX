import { useSyncExternalStore } from "react";
import { useSharedNow } from "./use-shared-now";
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
