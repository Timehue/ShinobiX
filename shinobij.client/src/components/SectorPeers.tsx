/*
 * SectorPeers — live "walking" overlay for OTHER players in your sector (2D).
 *
 * The sector grid used to draw peers as static dots pinned inside the grid cell
 * of a deterministic per-name tile. This overlay instead positions each peer at
 * their REAL transmitted tile (PlayerRecord.tile, falling back to the per-name
 * tile when a peer hasn't sent one) and lets CSS transition the marker between
 * tiles — so a peer who moves glides across the sector instead of teleporting.
 * Peers fade+scale in on arrival and fade out on departure.
 *
 * Renderer-only: pointer-events:none, never touches game logic / saves / the
 * attack flow (which lives in the separate "Players Here" panel). Matches the
 * grid's exact tile centres (padding + gap aware), mirroring <SectorAvatar>. The
 * whole overlay is gated by isSectorLivePeersEnabled() at the call site, so
 * turning the flag off restores the original dot rendering with zero code change.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveSectorPlayers } from "../lib/presence-store";
import { sameSector } from "../lib/utils";
import { playerNameTile } from "../lib/sector-tile";

const GRID = 12;
const PAD = 8;
const GAP = 1;
// Cap how many animated markers we draw at once so a packed hub sector stays
// smooth (each marker is a transform-transitioned, bobbing DOM node). The
// "Players Here" panel still lists EVERYONE for interaction — this caps only the
// cosmetic overlay; the rest are summarised by a "+N more" pill. Live peers are
// prioritised over sleepers.
const MAX_MARKERS = 48;

export type SectorPeer = {
    name: string;
    tile: number;
    level: number;
    sleeping: boolean;
    avatar?: string;
};

type Item = SectorPeer & { leaving: boolean };

function cellCentre(size: number, count: number, n: number, pad: number, gap: number): number {
    const tile = (size - 2 * pad - (count - 1) * gap) / count;
    return pad + n * (tile + gap) + tile / 2;
}

// Per-peer idle-bob phase offset (negative animation-delay, 0..-2.4s) derived from
// the name, so a crowd of peers bobs out of sync instead of breathing in lockstep.
function bobDelay(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return -((h % 2400) / 1000);
}

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function SectorPeers({ peers }: { peers: SectorPeer[] }) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [metrics, setMetrics] = useState({ w: 0, h: 0, padX: PAD, padY: PAD, gapX: GAP, gapY: GAP });
    // Render list = current peers plus any that just left (kept one fade cycle).
    const [items, setItems] = useState<Item[]>([]);

    // Measure the grid (our parent) so markers land on real tile centres.
    useLayoutEffect(() => {
        const grid = wrapRef.current?.parentElement;
        if (!grid) return;
        const measure = () => {
            const r = grid.getBoundingClientRect();
            const cs = getComputedStyle(grid);
            setMetrics({
                w: r.width,
                h: r.height,
                padX: parseFloat(cs.paddingLeft) || 0,
                padY: parseFloat(cs.paddingTop) || 0,
                gapX: parseFloat(cs.columnGap) || 0,
                gapY: parseFloat(cs.rowGap) || 0,
            });
        };
        const ro = new ResizeObserver(measure);
        ro.observe(grid);
        measure();
        return () => ro.disconnect();
    }, []);

    // Reconcile the incoming peer list into the render list, marking departures as
    // `leaving` so they fade out (dropped on animationend below). Deferred to the
    // next frame so it's not a synchronous setState inside the effect. With reduced
    // motion (no animationend fires) departures are dropped immediately.
    useEffect(() => {
        const id = requestAnimationFrame(() => {
            const reduce = prefersReducedMotion();
            setItems((prev) => {
                const incoming = new Map(peers.map((p) => [p.name, p]));
                const seen = new Set<string>();
                const next: Item[] = [];
                for (const it of prev) {
                    const fresh = incoming.get(it.name);
                    if (fresh) { next.push({ ...fresh, leaving: false }); seen.add(it.name); }
                    else if (!reduce) { next.push({ ...it, leaving: true }); seen.add(it.name); }
                    // reduced motion + gone → omit (instant removal)
                }
                for (const p of peers) if (!seen.has(p.name)) next.push({ ...p, leaving: false });
                return next;
            });
        });
        return () => cancelAnimationFrame(id);
    }, [peers]);

    const drop = (name: string) =>
        setItems((prev) => prev.filter((it) => !(it.name === name && it.leaving)));

    if (!metrics.w || !metrics.h) {
        // Not measured yet — render the empty overlay so the ResizeObserver's
        // parent lookup still resolves on the first layout pass.
        return <div className="sector-peers-overlay" ref={wrapRef} aria-hidden="true" />;
    }

    const tilePx = Math.max(0, (metrics.w - 2 * metrics.padX - (GRID - 1) * metrics.gapX) / GRID);
    const size = tilePx * 0.86;
    // Prioritise live peers over sleepers, and keep departing markers from
    // displacing a live one, then cap (overflow becomes a "+N more" pill).
    const ordered = [...items].sort((a, b) => {
        if (a.leaving !== b.leaving) return a.leaving ? 1 : -1;
        if (a.sleeping !== b.sleeping) return a.sleeping ? 1 : -1;
        return 0;
    });
    const shown = ordered.slice(0, MAX_MARKERS);
    const overflow = Math.max(0, peers.length - MAX_MARKERS);

    return (
        <div className="sector-peers-overlay" ref={wrapRef} aria-hidden="true">
            {shown.map((it) => {
                const col = it.tile % GRID;
                const row = Math.floor(it.tile / GRID);
                const cx = cellCentre(metrics.w, GRID, col, metrics.padX, metrics.gapX);
                const cy = cellCentre(metrics.h, GRID, row, metrics.padY, metrics.gapY);
                return (
                    <div
                        key={it.name}
                        className="sector-peer"
                        style={{ transform: `translate(${cx}px, ${cy}px) translate(-50%, -50%)` }}
                        title={`${it.name} (Lv ${it.level})`}
                    >
                        <div
                            className={`sector-peer-body ${it.leaving ? "is-leaving" : "is-entering"}`}
                            onAnimationEnd={() => { if (it.leaving) drop(it.name); }}
                        >
                            <span className="sector-peer-avatar" style={{ width: `${size}px`, height: `${size}px` }}>
                                {/* 2C grounded look: a static contact shadow under a gently
                                    bobbing figure, so peers read as planted + alive (not flat dots). */}
                                <span className="sector-peer-shadow" />
                                <span className="sector-peer-figure" style={{ animationDelay: `${bobDelay(it.name)}s` }}>
                                    {it.avatar
                                        ? <img className="tiny-map-avatar other-player-map-avatar" src={it.avatar} alt={it.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                        : <span className="other-player-map-emoji">🥷</span>}
                                </span>
                            </span>
                            <span className="other-player-map-name">{it.name}{it.sleeping ? " 💤" : ""}</span>
                        </div>
                    </div>
                );
            })}
            {overflow > 0 && (
                <div className="sector-peers-overflow">+{overflow} more here</div>
            )}
        </div>
    );
}

/**
 * SectorPeersLive — the overlay wired to the live presence store. It subscribes to
 * the FULL (tile-sensitive) snapshot itself, so a peer walking re-renders only this
 * subtree, NOT the whole WorldMap (which subscribes to the membership-only roster).
 * Live peers (with real tiles) are merged with the passed-in sleepers (name-tile
 * fallback). Render this only while the viewer is standing in the shown sector.
 */
export function SectorPeersLive({ selectedSector, selfName, sharedImages, sleepers }: {
    selectedSector: number;
    selfName: string;
    sharedImages: Record<string, string>;
    sleepers: SectorPeer[];
}) {
    const live = useLiveSectorPlayers();
    const selfLower = selfName.toLowerCase();
    const liveMarkers: SectorPeer[] = live
        .filter((p) => p.name.toLowerCase() !== selfLower)
        .filter((p) => sameSector(p.currentSector, selectedSector))
        .map((p) => ({
            name: p.name,
            tile: typeof p.tile === "number" ? p.tile : playerNameTile(p.name),
            level: p.level,
            sleeping: false,
            avatar: sharedImages["avatar:" + p.name.toLowerCase()] || ((p.character?.avatarImage as string) || ""),
        }));
    const liveNames = new Set(liveMarkers.map((m) => m.name.toLowerCase()));
    const peers = [...liveMarkers, ...sleepers.filter((s) => !liveNames.has(s.name.toLowerCase()))];
    return <SectorPeers peers={peers} />;
}
