import { sharedAvatarFor } from "../lib/shared-avatar";
import { displayPlayerName } from "../../../shared/player-name";
import { WorldStandingFigure } from "./WorldStandingFigure";
import { starterModel } from "../lib/player-model";
import type { StarterWorldModel } from "../../../shared/player-model-ref";
import { GameIcon } from "./icons/GameIcon";
import { GameArtIcon } from "./GameArtIcon";
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
 * peer overlay hands hit testing to the grid. The simpler tile view uses the same standing figures.
 * Peers omit the biome aura to avoid stacking up to 48 blur filters.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveSectorPlayers } from "../lib/presence-store";
import { sameSector } from "../lib/utils";
import { playerNameTile } from "../lib/sector-tile";
import { safeSectorTile } from "../lib/sector-obstacles";
import { useSectorPeerWalking } from "../lib/sector-peer-walking";
import { SECTOR_MARKER_ANCHOR, SECTOR_RING_PEER, sectorMarkerBox } from "../lib/sector-marker";

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
    starterWorldModel?: StarterWorldModel;
};

export type ScoutedSectorPlayer = Pick<SectorPeer, 'name' | 'level' | 'sleeping' | 'starterWorldModel'> & { avatarImage: string };

export function ScoutedSectorPlayers({ players }: { players: readonly ScoutedSectorPlayer[] }) {
    return <span className="other-players-map-stack">
        {players.map(player => (
            <span key={player.name} className="other-player-map-dot" title={`${player.name} Lv ${player.level}`}>
                <WorldStandingFigure kind={starterModel(player.avatarImage, player.starterWorldModel)} name={player.name} />
                <span className="other-player-map-name">{player.name}{player.sleeping && <> <GameArtIcon kind="biomeShadow" size={12} title="Sleeping" /></>}</span>
            </span>
        ))}
    </span>;
}

type Item = SectorPeer & { leaving: boolean };

function cellCentre(size: number, count: number, n: number, pad: number, gap: number): number {
    const tile = (size - 2 * pad - (count - 1) * gap) / count;
    return pad + n * (tile + gap) + tile / 2;
}

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function SectorPeers({ peers, sector }: { peers: SectorPeer[]; sector?: number }) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [metrics, setMetrics] = useState({ w: 0, h: 0, padX: PAD, padY: PAD, gapX: GAP, gapY: GAP });
    // Render list = current peers plus any that just left (kept one fade cycle).
    const [items, setItems] = useState<Item[]>([]);
    const bindPeer = useSectorPeerWalking(items, metrics, sector);

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
        return <div className={`sector-peers-overlay${peers.length > 8 ? " is-crowded" : ""}`} ref={wrapRef} aria-hidden="true" />;
    }

    const tilePx = Math.max(0, (metrics.w - 2 * metrics.padX - (GRID - 1) * metrics.gapX) / GRID);
    const box = sectorMarkerBox(tilePx);
    // Prioritise live peers over sleepers, and keep departing markers from
    // displacing a live one, then cap (overflow becomes a "+N more" pill).
    const ordered = [...items].sort((a, b) => {
        if (a.leaving !== b.leaving) return a.leaving ? 1 : -1;
        if (a.sleeping !== b.sleeping) return a.sleeping ? 1 : -1;
        return 0;
    });
    const markerBudget = metrics.w < 260 ? 6 : metrics.w < 360 ? 12 : metrics.w < 500 ? 25 : MAX_MARKERS;
    // Drawn by name, then layered by row, so a peer leaving or waking never
    // pops in front of the one it shares a tile with.
    const shown = ordered.slice(0, markerBudget).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const overflow = Math.max(0, peers.length - markerBudget);

    return (
        <div className={`sector-peers-overlay${peers.length > 8 ? " is-crowded" : ""}`} ref={wrapRef} aria-hidden="true">
            {shown.map((it) => {
                const col = it.tile % GRID;
                const row = Math.floor(it.tile / GRID);
                const cx = cellCentre(metrics.w, GRID, col, metrics.padX, metrics.gapX);
                const cy = cellCentre(metrics.h, GRID, row, metrics.padY, metrics.gapY);
                return (
                    <div
                        key={it.name}
                        ref={node => bindPeer(it.name, node)}
                        // .sector-avatar-figure IS the shared pin box (the same class your
                        // own marker uses); .sector-peer only adds the glide transition.
                        className="sector-avatar-figure sector-peer"
                        style={{
                            width: `${box.w}px`,
                            height: `${box.h}px`,
                            zIndex: row + 1,
                            transform: `translate(var(--peer-x, ${cx}px), var(--peer-y, ${cy}px)) translate(-50%, -${SECTOR_MARKER_ANCHOR}%)`,
                            ["--marker-ring"]: SECTOR_RING_PEER,
                        } as CSSProperties}
                        title={`${displayPlayerName(it.name)} (Lv ${it.level})`}
                    >
                        <div
                            className={`sector-peer-body ${it.leaving ? "is-leaving" : "is-entering"}`}
                            onAnimationEnd={() => { if (it.leaving) drop(it.name); }}
                        >
                            <span className="sector-avatar-shadow" />
                            <span className="sector-avatar-sprite">
                                <span className="sector-avatar-body">
                                    <WorldStandingFigure kind={starterModel(it.avatar ?? '', it.starterWorldModel)} accountName={it.name} />
                                </span>
                            </span>
                            <span className="sector-peer-label">{displayPlayerName(it.name)}{it.sleeping && <> <GameIcon name="moon" size={12} title="Sleeping" /></>}</span>
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
        .filter((p) => p.name.toLowerCase() !== selfLower && !p.stronghold)
        .filter((p) => sameSector(p.currentSector, selectedSector))
        .map((p) => ({
            name: p.name,
            tile: safeSectorTile(selectedSector, typeof p.tile === "number" ? p.tile : playerNameTile(p.name)),
            level: p.level,
            sleeping: false,
            starterWorldModel: p.character?.starterWorldModel,
            avatar: sharedAvatarFor(sharedImages, p.name) || ((p.character?.avatarImage as string) || ""),
        }));
    const liveNames = new Set(liveMarkers.map((m) => m.name.toLowerCase()));
    const peers = [...liveMarkers, ...sleepers.filter((s) => !liveNames.has(s.name.toLowerCase())).map(s => ({ ...s, tile: safeSectorTile(selectedSector, s.tile) }))];
    return <SectorPeers peers={peers} sector={selectedSector} />;
}
