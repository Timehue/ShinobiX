// Shared timer hook so all components tick in sync. Prevents mobile and
// desktop timers from drifting if their intervals initialize at different times.
// Extracted from App.tsx (drain) to keep the monolith under its line-budget
// ratchet; semantics are identical (one module-level singleton interval +
// listener set, started lazily on first subscriber).
import { useEffect, useState } from "react";

let sharedNowValue = Date.now();
const sharedNowListeners: Set<() => void> = new Set();
let sharedNowInterval: number | null = null;

function startSharedNowTicker() {
    if (sharedNowInterval) return; // already running
    sharedNowInterval = window.setInterval(() => {
        sharedNowValue = Date.now();
        sharedNowListeners.forEach(cb => cb());
    }, 1000);
}

// Returns the shared "now" timestamp as state — it ticks once a second, so
// reading it in render is pure (no Date.now() call during render, which the
// react-hooks/purity rule forbids). Callers that only need the re-render can
// ignore the return value (back-compat with the original void signature).
export function useSharedNow(): number {
    const [now, setNow] = useState(sharedNowValue);
    useEffect(() => {
        startSharedNowTicker();
        const callback = () => setNow(sharedNowValue);
        sharedNowListeners.add(callback);
        return () => { sharedNowListeners.delete(callback); };
    }, []);
    return now;
}
