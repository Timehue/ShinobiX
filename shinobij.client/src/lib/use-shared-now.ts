// Shared timer hook so all components tick in sync. Prevents mobile and
// desktop timers from drifting if their intervals initialize at different times.
// One ticker runs while a visible countdown is subscribed. The store catches
// up from wall time on remount/foreground and releases its last timer/listener.
import { useSyncExternalStore } from "react";
import { getSharedNow, subscribeSharedNow } from "./shared-now-store";

// Returns the shared "now" timestamp as state — it ticks once a second, so
// reading it in render is pure (no Date.now() call during render, which the
// react-hooks/purity rule forbids). Callers that only need the re-render can
// ignore the return value (back-compat with the original void signature).
export function useSharedNow(): number {
    return useSyncExternalStore(subscribeSharedNow, getSharedNow);
}
