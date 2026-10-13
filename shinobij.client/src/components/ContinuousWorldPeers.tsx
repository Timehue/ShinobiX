import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useLiveSectorPlayers } from '../lib/presence-store';
import { loadContinuousWorld, worldMovementRequest } from '../lib/continuous-world-client';
import { peerWorldPath, advancePeerPath } from '../lib/world-peer-motion';
import { playerNameTile } from '../lib/sector-tile';
import { SectorPortrait } from './SectorPortrait';
import type { WorldPosition } from '../../../shared/world-position';
import type { WorldPoint } from '../../../shared/continuous-world-space';
import type { PlayerRecord } from '../types/character';

// `peer` is the record last reconciled; `element`/`x`/`y` the transform last written.
type Motion = { cursor: WorldPosition; point: WorldPoint; points: WorldPoint[]; sequence: number;
    peer: PlayerRecord; element?: HTMLDivElement; x?: number; y?: number };
type PeerFigure = { name: string; level: PlayerRecord['level']; src: string };
// A poll reply is plain JSON, so equal text means equal records.
const samePlayers = (a: PlayerRecord[], b: PlayerRecord[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
const sameFigures = (a: PeerFigure[], b: PeerFigure[]) => a.length === b.length
    && a.every((figure, i) => figure.name === b[i].name && Object.is(figure.level, b[i].level) && figure.src === b[i].src);
/** The figures alone: a peer walking changes none of their inputs, so a move message skips this subtree. */
const PeerFigures = memo(function PeerFigures({ figures, elements }: { figures: PeerFigure[]; elements: RefObject<Map<string, HTMLDivElement>> }) {
    return <>{figures.map(({ name, level, src }) => <div key={name}
        ref={node => { if (node) elements.current.set(name, node); else elements.current.delete(name); }}
        className="sector-avatar-figure continuous-world-peer" title={`${name} (Lv ${level})`}>
        <span className="sector-avatar-shadow" /><span className="sector-avatar-sprite"><span className="sector-avatar-body">
            <SectorPortrait src={src} name={name} />
            <span className="sector-avatar-pin" /></span></span><span className="sector-peer-label">{name}</span>
    </div>)}</>;
}, (a, b) => a.elements === b.elements && sameFigures(a.figures, b.figures));
/** Bounded nearby presentation; actions remain in the current sector's HUD. */
export function ContinuousWorldPeers({ sector, selfName, sharedImages }: { sector: number; selfName: string; sharedImages: Record<string, string> }) {
    const live = useLiveSectorPlayers();
    const [nearby, setNearby] = useState<PlayerRecord[]>([]);
    useEffect(() => {
        const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, acceptedAt = 0;
        const poll = async () => {
            try { if (!document.hidden) { const reply = await worldMovementRequest(undefined, undefined, abort.signal);
                if (!abort.signal.aborted && reply.ok) { acceptedAt = Date.now(); const players = reply.players ?? [];
                    setNearby(previous => samePlayers(previous, players) ? previous : players); } } }
            catch { /* Reconcile below, including expiry after a lost connection. */ }
            if (!abort.signal.aborted && Date.now() - acceptedAt > 6000) setNearby(previous => previous.length ? [] : previous);
            if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000);
        };
        void poll(); return () => { abort.abort(); clearTimeout(timer); };
    }, [selfName]);
    const byName = new Map<string, PlayerRecord>();
    for (const peer of [...nearby, ...live.filter(p => p.currentSector === sector)]) {
        const key = peer.name.toLowerCase(), previous = byName.get(key);
        if (!previous || (peer.movementSequence ?? 0) >= (previous.movementSequence ?? 0)) byName.set(key, peer);
    }
    const peers = [...byName.values()].filter(p => p.name.toLowerCase() !== selfName.toLowerCase() && !p.stronghold).slice(0, 48);
    const figures = peers.map((peer): PeerFigure => ({ name: peer.name, level: peer.level,
        src: sharedImages[`avatar:${peer.name.toLowerCase()}`] || peer.character?.avatarImage || '' }));
    const latest = useRef(peers), elements = useRef(new Map<string, HTMLDivElement>()), root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { latest.current = peers; });
    useEffect(() => {
        let alive = true, frame = 0, last = 0;
        const motion = new Map<string, Motion>();
        // Measured on resize, not per frame: a per-frame clientWidth, read just after the
        // world controller writes its styles, forced a layout every frame.
        const parent = root.current?.parentElement;
        let width = parent?.clientWidth ?? 0;
        const resize = parent && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { width = parent.clientWidth; }) : null;
        if (parent) resize?.observe(parent);
        void loadContinuousWorld().then(world => {
            if (!alive) return;
            const chunk = world.space.chunks.find(c => c.sector === sector)!;
            const tick = (now: number) => {
                const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
                const scale = width / 12;
                const present = new Set<string>();
                for (const peer of latest.current) {
                    let item = motion.get(peer.name);
                    // The record reconciled last frame reads the same cursor and makes the same
                    // no-op decision again, so only a new record is read and compared.
                    if (item?.peer !== peer) {
                        const cursor = world.model.read(peer.worldPosition) ?? world.model.fallback(peer.currentSector ?? sector, peer.tile ?? playerNameTile(peer.name));
                        if (!cursor) continue;
                        if (!item) { const point = world.model.point(cursor); item = { cursor, point, points: [point], sequence: peer.movementSequence ?? 0, peer }; motion.set(peer.name, item); }
                        else if ((peer.movementSequence ?? 0) >= item.sequence && JSON.stringify(cursor) !== JSON.stringify(item.cursor)) {
                            // Finish the buffered graph path before adopting the next partial edge.
                            const path = peerWorldPath(world.nodes, item.cursor, cursor);
                            if (path && item.points.length + path.length <= 64) item.points = [...item.points, ...path.slice(1)];
                            else item.points = [world.model.point(cursor)];
                            item.cursor = cursor; item.sequence = peer.movementSequence ?? 0;
                        }
                        item.peer = peer;
                    }
                    present.add(peer.name);
                    item.point = advancePeerPath(item.points, dt * 8) ?? item.point;
                    const element = elements.current.get(peer.name);
                    if (!element) continue;
                    const x = (item.point.x - chunk.x) * scale, y = (item.point.y - chunk.y) * scale;
                    // A standing peer would be handed the very same transform string again.
                    if (element === item.element && x === item.x && y === item.y) continue;
                    element.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
                    item.element = element; item.x = x; item.y = y;
                }
                for (const name of motion.keys()) if (!present.has(name)) motion.delete(name);
                frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
        }).catch(() => { /* The terrain connection shows its own retry state. */ });
        return () => { alive = false; cancelAnimationFrame(frame); resize?.disconnect(); };
    }, [sector]);
    return <div className="continuous-world-peers" ref={root} aria-hidden="true"><PeerFigures figures={figures} elements={elements} /></div>;
}
