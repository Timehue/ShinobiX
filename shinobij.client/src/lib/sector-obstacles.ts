import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { isWalkableTile, nearestWalkableTile } from "../../../shared/sector-walk-mask";
import { visiblePoll } from "./poll";
import { createFastRetry } from "./fast-retry";

// The server answer is an environment flag (api/_release-flags.ts), so it can
// only change on a redeploy. Every open world view used to ask every 30s, hidden
// tabs included: 120 no-op requests an hour per player. Ask on first subscribe,
// every five minutes while visible, and again whenever the tab comes back.
const OBSTACLE_FLAG_POLL_MS = 5 * 60_000;

let enabled = true;
let modelArtBase: string | null = null;
let playerGaits = false;
let profileDetailUploads = false;
let worldModelCreationAvailable = false;
const listeners = new Set<() => void>();
let stopPoll: (() => void) | undefined;
let pending: Promise<void> | undefined;
// A failed answer leaves fitted figures off (the portrait pin stands in), so one
// dropped request must not wait the full five-minute poll: retry at 2 s, 5 s and
// 15 s while a view is listening, then fall back to the regular poll.
const quickRetry = createFastRetry(() => {
    if (listeners.size && !document.hidden) void refresh();
});
// A boot prefetch and the first world view both ask; one answer serves both.
const FRESH_MS = 15_000;
let answeredAt = -Infinity;
async function refresh() {
    if (pending) return pending;
    if (performance.now() - answeredAt < FRESH_MS) return;
    let answered = false;
    pending = fetch("/api/world/sector-layout", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(value => {
        if (typeof value?.obstaclesEnabled !== "boolean") return;
        answered = true;
        answeredAt = performance.now();
        const base = typeof value.modelArtBase === "string" ? value.modelArtBase : null;
        const gaits = value.playerGaitsEnabled === true;
        const detail = value.profileDetailUploads === true;
        const creationAvailable = value.worldModelCreationAvailable === true;
        if (value.obstaclesEnabled === enabled && base === modelArtBase && playerGaits === gaits &&
            detail === profileDetailUploads && creationAvailable === worldModelCreationAvailable) return;
        profileDetailUploads = detail;
        worldModelCreationAvailable = creationAvailable;
        playerGaits = gaits;
        enabled = value.obstaclesEnabled;
        modelArtBase = base;
        listeners.forEach(listener => listener());
    }).catch(() => {}).finally(() => {
        pending = undefined;
        if (answered) quickRetry.succeeded();
        else if (listeners.size) quickRetry.failed();
    });
    return pending;
}
/** Ask early (at boot) so the world's first figure need not wait on this round trip. */
export const prefetchSectorPresentation = () => refresh();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!stopPoll) stopPoll = visiblePoll(refresh, OBSTACLE_FLAG_POLL_MS, 0.1, { immediate: true });
    return () => {
        listeners.delete(listener);
        if (!listeners.size) { quickRetry.cancel(); if (stopPoll) { stopPoll(); stopPoll = undefined; } }
    };
};
/** For tests: the store's own subscription, as a world view's hook uses it. */
export const subscribeSectorPresentation = subscribe;
export const sectorPlayerGaitsOn = () => playerGaits;
export const sectorObstaclesOn = () => enabled;
export async function supportsProfileDetailUpload() {
    await refresh();
    return profileDetailUploads;
}
export const useSectorObstacles = () => useSyncExternalStore(subscribe, sectorObstaclesOn, () => true);
const noSubscription = () => () => {};
export const useSectorModelArtBase = (enabled = true) => useSyncExternalStore(enabled ? subscribe : noSubscription, () => enabled ? modelArtBase : null, () => null);
export const usePlayerGaits = () => useSyncExternalStore(subscribe, () => playerGaits, () => false);
export const useWorldModelCreationAvailable = () => useSyncExternalStore(subscribe, () => worldModelCreationAvailable, () => false);
export const safeSectorTile = (sector: number, tile: number) => nearestWalkableTile(sector, tile, enabled);
export function useSectorTileGrounding(sector: number | null, tile: number, setTile: Dispatch<SetStateAction<number>>) {
    const obstacles = useSectorObstacles();
    useEffect(() => {
        if (sector === null) return;
        const safe = nearestWalkableTile(sector, tile, obstacles);
        if (safe !== tile) setTile(safe);
    }, [sector, tile, obstacles, setTile]);
    return obstacles;
}
export function stepSectorTile(sector: number, tile: number, key: string): number {
    const col = tile % 12, row = Math.floor(tile / 12);
    const next = key === "w" && row > 0 ? tile - 12 : key === "s" && row < 11 ? tile + 12
        : key === "a" && col > 0 ? tile - 1 : key === "d" && col < 11 ? tile + 1 : tile;
    return isWalkableTile(sector, next, enabled) ? next : tile;
}
