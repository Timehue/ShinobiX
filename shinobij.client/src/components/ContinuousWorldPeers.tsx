import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveSectorPlayers } from '../lib/presence-store';
import { loadContinuousWorld, worldMovementRequest } from '../lib/continuous-world-client';
import { peerWorldPath, advancePeerPath } from '../lib/world-peer-motion';
import { playerNameTile } from '../lib/sector-tile';
import { SectorPortrait } from './SectorPortrait';
import type { WorldPosition } from '../../../shared/world-position';
import type { WorldPoint } from '../../../shared/continuous-world-space';
import type { PlayerRecord } from '../types/character';

type Motion = { cursor: WorldPosition; point: WorldPoint; points: WorldPoint[]; sequence: number };
/** Bounded nearby presentation; actions remain in the current sector's HUD. */
export function ContinuousWorldPeers({ sector, selfName, sharedImages }: { sector: number; selfName: string; sharedImages: Record<string, string> }) {
    const live = useLiveSectorPlayers();
    const [nearby, setNearby] = useState<PlayerRecord[]>([]);
    useEffect(() => {
        const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, acceptedAt = 0;
        const poll = async () => {
            try { if (!document.hidden) { const reply = await worldMovementRequest(undefined, undefined, abort.signal);
                if (!abort.signal.aborted && reply.ok) { acceptedAt = Date.now(); setNearby(reply.players ?? []); } } }
            catch { /* Reconcile below, including expiry after a lost connection. */ }
            if (!abort.signal.aborted && Date.now() - acceptedAt > 6000) setNearby([]);
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
    const latest = useRef(peers), elements = useRef(new Map<string, HTMLDivElement>()), root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { latest.current = peers; });
    useEffect(() => {
        let alive = true, frame = 0, last = 0;
        const motion = new Map<string, Motion>();
        void loadContinuousWorld().then(world => {
            if (!alive) return;
            const chunk = world.space.chunks.find(c => c.sector === sector)!;
            const tick = (now: number) => {
                const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
                const width = root.current?.parentElement?.clientWidth ?? 0, scale = width / 12;
                const present = new Set<string>();
                for (const peer of latest.current) {
                    const cursor = world.model.read(peer.worldPosition) ?? world.model.fallback(peer.currentSector ?? sector, peer.tile ?? playerNameTile(peer.name));
                    if (!cursor) continue;
                    present.add(peer.name); let item = motion.get(peer.name);
                    if (!item) { const point = world.model.point(cursor); item = { cursor, point, points: [point], sequence: peer.movementSequence ?? 0 }; motion.set(peer.name, item); }
                    else if ((peer.movementSequence ?? 0) >= item.sequence && JSON.stringify(cursor) !== JSON.stringify(item.cursor)) {
                        // Finish the buffered graph path before adopting the next partial edge.
                        const path = peerWorldPath(world.nodes, item.cursor, cursor);
                        if (path && item.points.length + path.length <= 64) item.points = [...item.points, ...path.slice(1)];
                        else item.points = [world.model.point(cursor)];
                        item.cursor = cursor; item.sequence = peer.movementSequence ?? 0;
                    }
                    item.point = advancePeerPath(item.points, dt * 8) ?? item.point;
                    const element = elements.current.get(peer.name);
                    if (element) element.style.transform = `translate(${(item.point.x - chunk.x) * scale}px,${(item.point.y - chunk.y) * scale}px) translate(-50%,-100%)`;
                }
                for (const name of motion.keys()) if (!present.has(name)) motion.delete(name);
                frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
        }).catch(() => { /* The terrain connection shows its own retry state. */ });
        return () => { alive = false; cancelAnimationFrame(frame); };
    }, [sector]);
    return <div className="continuous-world-peers" ref={root} aria-hidden="true">{peers.map(peer => <div key={peer.name}
        ref={node => { if (node) elements.current.set(peer.name, node); else elements.current.delete(peer.name); }}
        className="sector-avatar-figure continuous-world-peer" title={`${peer.name} (Lv ${peer.level})`}>
        <span className="sector-avatar-shadow" /><span className="sector-avatar-sprite"><span className="sector-avatar-body">
            <SectorPortrait src={sharedImages[`avatar:${peer.name.toLowerCase()}`] || peer.character?.avatarImage || ''} name={peer.name} />
            <span className="sector-avatar-pin" /></span></span><span className="sector-peer-label">{peer.name}</span>
    </div>)}</div>;
}
