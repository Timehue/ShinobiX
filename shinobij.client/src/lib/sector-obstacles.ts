import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { isWalkableTile, nearestWalkableTile } from "../../../shared/sector-walk-mask";
import { visiblePoll } from "./poll";

// The server answer is an environment flag (api/_release-flags.ts), so it can
// only change on a redeploy. Every open world view used to ask every 30s, hidden
// tabs included: 120 no-op requests an hour per player. Ask on first subscribe,
// every five minutes while visible, and again whenever the tab comes back.
const OBSTACLE_FLAG_POLL_MS = 5 * 60_000;

let enabled = true;
const listeners = new Set<() => void>();
let stopPoll: (() => void) | undefined;
let pending: Promise<void> | undefined;
async function refresh() {
    if (pending) return pending;
    pending = fetch("/api/world/sector-layout", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(value => {
        if (typeof value?.obstaclesEnabled !== "boolean" || value.obstaclesEnabled === enabled) return;
        enabled = value.obstaclesEnabled;
        listeners.forEach(listener => listener());
    }).catch(() => {}).finally(() => { pending = undefined; });
    return pending;
}
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!stopPoll) stopPoll = visiblePoll(refresh, OBSTACLE_FLAG_POLL_MS, 0.1, { immediate: true });
    return () => { listeners.delete(listener); if (!listeners.size && stopPoll) { stopPoll(); stopPoll = undefined; } };
};
export const sectorObstaclesOn = () => enabled;
export const useSectorObstacles = () => useSyncExternalStore(subscribe, sectorObstaclesOn, () => true);
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
