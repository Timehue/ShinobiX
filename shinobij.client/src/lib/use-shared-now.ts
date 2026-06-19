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

export function useSharedNow(): void {
    const [, setNow] = useState(sharedNowValue);
    useEffect(() => {
        startSharedNowTicker();
        const callback = () => setNow(sharedNowValue);
        sharedNowListeners.add(callback);
        return () => { sharedNowListeners.delete(callback); };
    }, []);
}
