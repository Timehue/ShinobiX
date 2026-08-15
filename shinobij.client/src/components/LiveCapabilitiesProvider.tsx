import { useEffect, type ReactNode } from "react";
import {
    liveCapabilitiesStore,
    startLiveCapabilitiesPolling,
    type LiveCapabilitiesStore,
} from "../lib/live-capabilities";
import { LiveCapabilitiesContext } from "../lib/live-capabilities-context";

export function LiveCapabilitiesProvider({
    children,
    store = liveCapabilitiesStore,
}: {
    children: ReactNode;
    store?: LiveCapabilitiesStore;
}) {
    useEffect(() => startLiveCapabilitiesPolling(store, {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (handle) => window.clearTimeout(handle as number),
        isVisible: () => document.visibilityState !== "hidden",
        onOnline: (listener) => {
            window.addEventListener("online", listener);
            return () => { window.removeEventListener("online", listener); };
        },
        onVisibilityChange: (listener) => {
            document.addEventListener("visibilitychange", listener);
            return () => { document.removeEventListener("visibilitychange", listener); };
        },
    }), [store]);

    return (
        <LiveCapabilitiesContext.Provider value={store}>
            {children}
        </LiveCapabilitiesContext.Provider>
    );
}
