import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { PublicCapabilityId } from "../../../shared/public-capabilities";
import {
    capabilityAvailability,
    capabilityMutationAvailability,
    capabilityViewAvailability,
    liveCapabilitiesStore,
    type CapabilityAvailability,
    type LiveCapabilitiesSnapshot,
    type LiveCapabilitiesStore,
} from "./live-capabilities";

export const LiveCapabilitiesContext = createContext<LiveCapabilitiesStore>(liveCapabilitiesStore);

export type LiveCapabilitiesContextValue = Readonly<{
    snapshot: LiveCapabilitiesSnapshot;
    refresh: () => Promise<LiveCapabilitiesSnapshot>;
    availability: (id: PublicCapabilityId) => CapabilityAvailability;
    viewAvailability: (id?: PublicCapabilityId) => CapabilityAvailability;
    mutationAvailability: (id?: PublicCapabilityId) => CapabilityAvailability;
}>;

export function useLiveCapabilities(): LiveCapabilitiesContextValue {
    const store = useContext(LiveCapabilitiesContext);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    // Keep command-boundary readers stable across ordinary snapshot
    // publications. Effects may safely depend on these functions without
    // restarting their own polling every time the capability lease refreshes,
    // while each invocation still reads the latest store state (and wall-clock
    // lease age) rather than the snapshot from the render that created it.
    const availability = useCallback(
        (id: PublicCapabilityId) => capabilityAvailability(store.getSnapshot(), id),
        [store],
    );
    const viewAvailability = useCallback(
        (id?: PublicCapabilityId) => capabilityViewAvailability(store.getSnapshot(), id),
        [store],
    );
    const mutationAvailability = useCallback(
        (id?: PublicCapabilityId) => capabilityMutationAvailability(store.getSnapshot(), id),
        [store],
    );
    return useMemo(() => ({
        snapshot,
        refresh: store.refresh,
        availability,
        viewAvailability,
        mutationAvailability,
    }), [availability, mutationAvailability, snapshot, store, viewAvailability]);
}

export function useCapabilityAvailability(id: PublicCapabilityId): CapabilityAvailability {
    return useLiveCapabilities().availability(id);
}

export function useCapabilityViewAvailability(id?: PublicCapabilityId): CapabilityAvailability {
    return useLiveCapabilities().viewAvailability(id);
}

export function useCapabilityMutationAvailability(id?: PublicCapabilityId): CapabilityAvailability {
    return useLiveCapabilities().mutationAvailability(id);
}
