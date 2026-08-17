import {
    PUBLIC_CAPABILITY_IDS,
    type PublicCapabilities,
    type PublicCapabilitiesResponse,
    type PublicCapability,
    type PublicCapabilityId,
} from "../../../shared/public-capabilities";

export type CapabilityAvailability = "available" | "unavailable" | "unknown";
export type CapabilityFreshness = "unknown" | "fresh" | "stale";
export const CAPABILITY_REFRESH_MS = 30_000;
export const CAPABILITY_MAX_AGE_MS = 90_000;
export const CAPABILITY_REQUEST_TIMEOUT_MS = 8_000;
export const CAPABILITY_MAX_BACKOFF_MS = 5 * 60_000;

export function nextCapabilityRefreshDelay(
    consecutiveFailures: number,
    random: () => number = Math.random,
): number {
    const failures = Math.max(0, Math.min(8, Math.floor(consecutiveFailures)));
    const backoff = Math.min(CAPABILITY_MAX_BACKOFF_MS, CAPABILITY_REFRESH_MS * (2 ** failures));
    const jitter = 0.85 + Math.max(0, Math.min(1, random())) * 0.3;
    return Math.round(backoff * jitter);
}

// (No module-level memoized `capabilityRequest` promise here. main carried one,
// with a fix so a failed request is not cached — one blip at boot otherwise
// disabled every capability-gated control for the life of the page, including
// the Google and guest buttons on the login screen. This branch had already
// retired that whole shape in favour of LiveCapabilitiesStore below, which
// coalesces only the in-flight request, tracks freshness, and can refresh with
// backoff. `loadPublicCapabilities` is defined at the bottom of this file as a
// thin delegate to that store, so the failure main was fixing cannot occur.)

export type LiveCapabilitiesSnapshot = Readonly<{
    capabilities: PublicCapabilities | null;
    freshness: CapabilityFreshness;
    lastUpdatedAt: number | null;
    error: string | null;
}>;

type CapabilityResponse = Pick<Response, "ok" | "status" | "json">;
export type CapabilityFetcher = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<CapabilityResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapability(value: unknown): value is PublicCapability {
    if (!isRecord(value)) return false;
    if (value.state === "available") return value.reason === "available";
    if (value.state === "actions-paused") return value.reason === "operations-paused";
    if (value.state === "temporarily-unavailable") {
        return value.reason === "maintenance"
            || value.reason === "temporarily-disabled"
            || value.reason === "configuration-unavailable";
    }
    return false;
}

/** Runtime validation is required because the public capability response is an
 * operational control plane, not trusted compile-time data. Missing fields are
 * rejected so a partial response cannot silently enable a new admission. */
export function parsePublicCapabilitiesResponse(value: unknown): PublicCapabilities | null {
    if (!isRecord(value) || value.ok !== true || !isRecord(value.capabilities)) return null;
    const capabilities = {} as PublicCapabilities;
    for (const id of PUBLIC_CAPABILITY_IDS) {
        const capability = value.capabilities[id];
        if (!isCapability(capability)) return null;
        capabilities[id] = Object.freeze({ state: capability.state, reason: capability.reason });
    }
    return Object.freeze(capabilities) as PublicCapabilitiesResponse["capabilities"];
}

export function capabilityAvailability(
    snapshot: LiveCapabilitiesSnapshot,
    id: PublicCapabilityId,
    now = Date.now(),
): CapabilityAvailability {
    if (snapshot.freshness !== "fresh" || snapshot.lastUpdatedAt === null) return "unknown";
    if (now - snapshot.lastUpdatedAt > CAPABILITY_MAX_AGE_MS) return "unknown";
    const capability = snapshot.capabilities?.[id];
    if (!capability) return "unknown";
    return capability.state === "available" ? "available" : "unavailable";
}

function composedCapabilityAvailability(
    snapshot: LiveCapabilitiesSnapshot,
    ids: readonly PublicCapabilityId[],
    now = Date.now(),
): CapabilityAvailability {
    let hasUnknown = false;
    for (const id of new Set(ids)) {
        const availability = capabilityAvailability(snapshot, id, now);
        if (availability === "unavailable") return "unavailable";
        if (availability === "unknown") hasUnknown = true;
    }
    return hasUnknown ? "unknown" : "available";
}

/** Read/view access composes global gameplay availability with the narrow
 * feature gate. It intentionally excludes `gameplayMutations`: an operations
 * freeze must not hide status, receipts, timers, or resumable sessions. */
export function capabilityViewAvailability(
    snapshot: LiveCapabilitiesSnapshot,
    id?: PublicCapabilityId,
    now = Date.now(),
): CapabilityAvailability {
    return composedCapabilityAvailability(snapshot, id ? ["gameplay", id] : ["gameplay"], now);
}

/** Admission for a new progress-changing request composes global gameplay,
 * the unsafe-method freeze, and the narrow feature gate. Cold/stale truth is
 * unknown and therefore fails closed at callers. */
export function capabilityMutationAvailability(
    snapshot: LiveCapabilitiesSnapshot,
    id?: PublicCapabilityId,
    now = Date.now(),
): CapabilityAvailability {
    return composedCapabilityAvailability(
        snapshot,
        id ? ["gameplay", "gameplayMutations", id] : ["gameplay", "gameplayMutations"],
        now,
    );
}

export function canViewCapability(
    snapshot: LiveCapabilitiesSnapshot,
    id?: PublicCapabilityId,
    now = Date.now(),
): boolean {
    return capabilityViewAvailability(snapshot, id, now) === "available";
}

/** New admissions fail closed while capability truth is cold or malformed.
 * Recovery/read-only surfaces decide separately whether they remain mounted. */
export function canStartCapability(
    snapshot: LiveCapabilitiesSnapshot,
    id?: PublicCapabilityId,
    now = Date.now(),
): boolean {
    return capabilityMutationAvailability(snapshot, id, now) === "available";
}

const INITIAL_SNAPSHOT: LiveCapabilitiesSnapshot = Object.freeze({
    capabilities: null,
    freshness: "unknown",
    lastUpdatedAt: null,
    error: null,
});

export class LiveCapabilitiesStore {
    readonly #fetcher: CapabilityFetcher;
    readonly #now: () => number;
    readonly #requestTimeoutMs: number;
    readonly #listeners = new Set<() => void>();
    #snapshot: LiveCapabilitiesSnapshot = INITIAL_SNAPSHOT;
    #inFlight: Promise<LiveCapabilitiesSnapshot> | null = null;
    #expiryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        fetcher: CapabilityFetcher = (input, init) => fetch(input, init),
        now: () => number = Date.now,
        requestTimeoutMs = CAPABILITY_REQUEST_TIMEOUT_MS,
    ) {
        this.#fetcher = fetcher;
        this.#now = now;
        this.#requestTimeoutMs = requestTimeoutMs;
    }

    getSnapshot = (): LiveCapabilitiesSnapshot => this.#snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    };

    refresh = (): Promise<LiveCapabilitiesSnapshot> => {
        this.expireIfAged();
        if (this.#inFlight) return this.#inFlight;
        this.#inFlight = this.#load().finally(() => { this.#inFlight = null; });
        return this.#inFlight;
    };

    /** Synchronously revoke a fresh snapshot once its admission lease expires.
     * Foreground/online handlers call this before their network refresh, so a
     * backgrounded tab cannot retain actionable controls during that request. */
    expireIfAged = (): boolean => {
        const current = this.#snapshot;
        if (current.freshness !== "fresh" || current.lastUpdatedAt === null) return false;
        if (this.#now() - current.lastUpdatedAt <= CAPABILITY_MAX_AGE_MS) return false;
        this.#publish(Object.freeze({
            capabilities: current.capabilities,
            freshness: current.capabilities ? "stale" : "unknown",
            lastUpdatedAt: current.lastUpdatedAt,
            error: "Capability snapshot expired",
        }));
        return true;
    };

    async #load(): Promise<LiveCapabilitiesSnapshot> {
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
            const timedOut = new Promise<never>((_resolve, reject) => {
                timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new Error("Capability refresh timed out"));
                }, this.#requestTimeoutMs);
            });
            const response = await Promise.race([
                this.#fetcher("/api/player/capabilities", {
                    headers: { Accept: "application/json" },
                    signal: controller.signal,
                }),
                timedOut,
            ]);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const capabilities = parsePublicCapabilitiesResponse(await response.json());
            if (!capabilities) throw new Error("Invalid capability response");
            this.#publish(Object.freeze({
                capabilities,
                freshness: "fresh",
                lastUpdatedAt: this.#now(),
                error: null,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Capability refresh failed";
            this.#publish(Object.freeze({
                capabilities: this.#snapshot.capabilities,
                freshness: this.#snapshot.capabilities ? "stale" : "unknown",
                lastUpdatedAt: this.#snapshot.lastUpdatedAt,
                error: message,
            }));
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
        return this.#snapshot;
    }

    #publish(next: LiveCapabilitiesSnapshot): void {
        if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
        this.#expiryTimer = null;
        this.#snapshot = next;
        if (next.freshness === "fresh" && next.lastUpdatedAt !== null) {
            const delay = Math.max(1, CAPABILITY_MAX_AGE_MS - (this.#now() - next.lastUpdatedAt) + 1);
            this.#expiryTimer = setTimeout(() => { this.expireIfAged(); }, delay);
            const nodeTimer = this.#expiryTimer as ReturnType<typeof setTimeout> & { unref?: () => void };
            nodeTimer.unref?.();
        }
        for (const listener of this.#listeners) listener();
    }
}

export type LiveCapabilitiesPollingEnvironment = Readonly<{
    schedule: (callback: () => void, delayMs: number) => unknown;
    cancel: (handle: unknown) => void;
    isVisible: () => boolean;
    onOnline: (listener: () => void) => () => void;
    onVisibilityChange: (listener: () => void) => () => void;
    random?: () => number;
}>;

/** One lifecycle coordinator owns initial load, visible polling, online/foreground
 * refresh, cleanup, jitter, and failure backoff. Keeping it outside React makes
 * StrictMode mount/unmount behavior independently testable. */
export function startLiveCapabilitiesPolling(
    store: LiveCapabilitiesStore,
    environment: LiveCapabilitiesPollingEnvironment,
): () => void {
    let disposed = false;
    let consecutiveFailures = 0;
    let timeoutHandle: unknown = null;
    let refreshCycle: Promise<void> | null = null;

    const clearSchedule = () => {
        if (timeoutHandle !== null) environment.cancel(timeoutHandle);
        timeoutHandle = null;
    };
    const schedule = () => {
        if (disposed || !environment.isVisible()) return;
        clearSchedule();
        timeoutHandle = environment.schedule(() => {
            timeoutHandle = null;
            if (!environment.isVisible()) return;
            void refreshAndSchedule();
        }, nextCapabilityRefreshDelay(consecutiveFailures, environment.random));
    };
    const refreshAndSchedule = async () => {
        clearSchedule();
        const next = await store.refresh();
        if (disposed) return;
        consecutiveFailures = next.freshness === "fresh"
            ? 0
            : Math.min(8, consecutiveFailures + 1);
        schedule();
    };
    const refreshNow = () => {
        // Revoke an aged admission lease synchronously even when a prior
        // refresh cycle is still in flight. Foreground/online signals are the
        // last point at which a backgrounded tab can otherwise retain stale
        // actionable controls while waiting for that request.
        store.expireIfAged();
        if (disposed || refreshCycle) return;
        refreshCycle = refreshAndSchedule().finally(() => { refreshCycle = null; });
    };
    const refreshWhenVisible = () => {
        if (environment.isVisible()) refreshNow();
        else clearSchedule();
    };

    const removeOnline = environment.onOnline(refreshNow);
    const removeVisibility = environment.onVisibilityChange(refreshWhenVisible);
    refreshNow();

    return () => {
        disposed = true;
        clearSchedule();
        removeOnline();
        removeVisibility();
    };
}

export const liveCapabilitiesStore = new LiveCapabilitiesStore();

/** Compatibility entry point for non-React callers. Unlike the retired
 * permanent promise, this coalesces only the current request and can refresh. */
export async function loadPublicCapabilities(): Promise<PublicCapabilities | null> {
    return (await liveCapabilitiesStore.refresh()).capabilities;
}
