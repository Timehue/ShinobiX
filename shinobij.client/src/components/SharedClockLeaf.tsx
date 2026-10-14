import type { ReactNode } from "react";
import { useSharedNow } from "../lib/use-shared-now";

/**
 * Re-renders just `children()` on every tick of the shared one-second display
 * clock, and whenever its parent renders. A screen wraps the JSX that reads the
 * clock during render (the UTC day key behind a daily counter, an ISO week key,
 * a countdown label) in one of these, so that JSX is recomputed from the same
 * inputs on the same tick as before while the screen itself no longer has to
 * re-render every second. Wrap the whole conditional slot, not one branch of
 * it, so the elements inside keep reconciling exactly as they did inline.
 */
export function SharedClockLeaf({ children }: { children: () => ReactNode }) {
    useSharedNow();
    return children();
}
