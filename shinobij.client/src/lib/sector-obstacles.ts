import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { isWalkableTile, nearestWalkableTile } from "../../../shared/sector-walk-mask";

let enabled = true;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
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
    if (!timer) { void refresh(); timer = setInterval(() => { void refresh(); }, 30_000); }
    return () => { listeners.delete(listener); if (!listeners.size && timer) { clearInterval(timer); timer = undefined; } };
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
