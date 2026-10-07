import { useLayoutEffect, useRef } from "react";
import { nearestWalkableTile, sectorWalkMask, walkPath } from "../../../shared/sector-walk-mask";
import { useSectorObstacles } from "./sector-obstacles";
type Metrics = { w: number; h: number; padX: number; padY: number; gapX: number; gapY: number };
type Walker = { col: number; row: number; sector?: number };
const centre = (size: number, n: number, pad: number, gap: number) => pad + n * ((size - 2 * pad - 11 * gap) / 12 + gap) + (size - 2 * pad - 11 * gap) / 24;

/** One animation frame loop for the entire visible peer overlay. */
export function useSectorPeerWalking(peers: readonly { name: string; tile: number }[], metrics: Metrics, sector?: number) {
    const nodes = useRef(new Map<string, HTMLDivElement>());
    const positions = useRef(new Map<string, Walker>());
    const obstacles = useSectorObstacles();
    useLayoutEffect(() => {
        if (sector === undefined || !sectorWalkMask(sector, obstacles) || !metrics.w) {
            for (const node of nodes.current.values()) { node.style.removeProperty('--peer-x'); node.style.removeProperty('--peer-y'); node.style.transition = ''; }
            positions.current.clear();
            return;
        }
        const routes = new Map<string, number[]>();
        for (const peer of peers) {
            const destination = nearestWalkableTile(sector, peer.tile, obstacles);
            const previous = positions.current.get(peer.name);
            const p = previous?.sector === sector ? previous : { col: destination % 12, row: Math.floor(destination / 12), sector };
            const raw = Math.round(p.row) * 12 + Math.round(p.col), safe = nearestWalkableTile(sector, raw, obstacles);
            if (safe !== raw) { p.col = safe % 12; p.row = Math.floor(safe / 12); }
            positions.current.set(peer.name, p);
            routes.set(peer.name, walkPath(sector, safe, destination, obstacles) ?? [safe]);
        }
        const reduce = document.documentElement.classList.contains('lite-fx') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let frame = 0, last = 0;
        const tick = (now: number) => {
            const distance = last ? Math.min(.05, (now - last) / 1000) * 6.5 : 0;
            last = now; let moving = false;
            for (const [name, route] of routes) {
                const p = positions.current.get(name)!, node = nodes.current.get(name);
                if (!node || !route.length) continue;
                if (reduce) { p.col = route.at(-1)! % 12; p.row = Math.floor(route.at(-1)! / 12); route.length = 0; }
                else {
                    const next = route[0]!, dx = next % 12 - p.col, dy = Math.floor(next / 12) - p.row, length = Math.hypot(dx, dy);
                    if (length <= distance || length < .02) { p.col = next % 12; p.row = Math.floor(next / 12); route.shift(); }
                    else { p.col += dx / length * distance; p.row += dy / length * distance; }
                    moving ||= route.length > 0;
                }
                node.style.setProperty('--peer-x', centre(metrics.w, p.col, metrics.padX, metrics.gapX) + 'px');
                node.style.setProperty('--peer-y', centre(metrics.h, p.row, metrics.padY, metrics.gapY) + 'px');
                node.style.transition = 'none';
            }
            if (moving) frame = requestAnimationFrame(tick);
        };
        tick(0);
        const present = new Set(peers.map(p => p.name));
        for (const name of positions.current.keys()) if (!present.has(name)) positions.current.delete(name);
        return () => cancelAnimationFrame(frame);
    }, [peers, metrics, sector, obstacles]);
    return (name: string, node: HTMLDivElement | null) => {
        if (node) nodes.current.set(name, node); else nodes.current.delete(name);
    };
}
