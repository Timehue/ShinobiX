import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useLiveSectorPlayers } from '../lib/presence-store';
import { loadContinuousWorld, worldMovementRequest } from '../lib/continuous-world-client';
import { peerWorldPath, advanceTimedPeerPath, peerPoseInMotion, type PeerWaypoint } from '../lib/world-peer-motion';
import { playerNameTile } from '../lib/sector-tile';
import { SectorModelFigure, type SectorModelHandle } from './SectorModelFigure';
import { usePlayerGaits, useWorldModelArtBase } from '../lib/sector-obstacles';
import { isPlayerModel, starterModel, type PlayerModel } from '../lib/player-model';
import { SectorPortrait } from './SectorPortrait';
import type { WorldPosition } from '../../../shared/world-position';
import type { PlayerRecord } from '../types/character';
import { worldPeerRoster, sameContinuousWorldPeersProps, type ContinuousWorldPeersProps } from '../lib/world-peer-roster';
import { sharedAvatarFor } from '../lib/shared-avatar';
import { GameIcon } from './icons/GameIcon';
import { sectorGaitTilesPerSecond } from '../../../shared/sector-model-motion';

// `peer` is the record last reconciled; `element`/`x`/`y` the transform last written.
type Motion = { cursor: WorldPosition; point: PeerWaypoint; points: PeerWaypoint[]; sequence: number;
    peer: PlayerRecord; updated:number; lastMovementAt?: number; element?: HTMLDivElement; x?: number; y?: number };
type PeerFigure = { name: string; level: PlayerRecord['level']; src: string; sleeping: boolean; local: boolean; starter: ReturnType<typeof starterModel>;
    model?: PlayerModel; style?: NonNullable<PlayerRecord['gaitPresentation']>['style'] };
// A poll reply is plain JSON, so equal text means equal records.
const samePlayers = (a: PlayerRecord[], b: PlayerRecord[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
const sameFigures = (a: PeerFigure[], b: PeerFigure[]) => a.length === b.length
    && a.every((figure, i) => figure.name === b[i].name && Object.is(figure.level, b[i].level) && figure.src === b[i].src && figure.starter === b[i].starter && figure.local === b[i].local && figure.sleeping === b[i].sleeping && figure.style === b[i].style && figure.model?.assetId===b[i].model?.assetId && figure.model?.version===b[i].model?.version);
/** The figures alone: a peer walking changes none of their inputs, so a move message skips this subtree. */
const PeerFigures = memo(function PeerFigures({ figures, elements, models, artBase }: {
    figures: PeerFigure[]; elements: RefObject<Map<string, HTMLDivElement>>;
    models: RefObject<Map<string,SectorModelHandle>>; artBase: string;
}) {
    return <>{figures.map(({ name, level, src, sleeping, local, model, starter, style }) => <div key={name}
        ref={node => { if (node) elements.current.set(name, node); else elements.current.delete(name); }}
        className="sector-avatar-figure continuous-world-peer" title={`${name} (Lv ${level})${sleeping ? ' — Sleeping' : ''}`}>
        {artBase && local && !sleeping && <SectorModelFigure kind={starter} equipped={model} style={style} artBase={artBase}
            ref={figure=>{if(figure) models.current.set(name,figure);else models.current.delete(name);}} />}
        <span className="sector-avatar-shadow" /><span className="sector-avatar-sprite"><span className="sector-avatar-body">
            <SectorPortrait src={src} name={name} />
            <span className="sector-avatar-pin" /></span></span><span className="sector-peer-label">{name}{sleeping && <> <GameIcon name="moon" size={12} title="Sleeping" /></>}</span>
    </div>)}</>;
}, (a, b) => a.artBase === b.artBase && a.models === b.models && a.elements === b.elements && sameFigures(a.figures, b.figures));
/**
 * Bounded nearby presentation; actions remain in the current sector's HUD.
 * Memoized by content (sameContinuousWorldPeersProps) so a parent render that
 * changes nothing here — App's one-second idle-regen tick — skips it. Live peers
 * and the poll arrive through this component's own store subscription and
 * state, which re-render it regardless of the memo.
 */
export const ContinuousWorldPeers = memo(function ContinuousWorldPeers({ sector, selfName, sharedImages, sleepers }: ContinuousWorldPeersProps) {
    const live = useLiveSectorPlayers();
    const artBase=useWorldModelArtBase(), gaits=usePlayerGaits();
    const models=useRef(new Map<string,SectorModelHandle>());
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
    const allPeers = worldPeerRoster(sector, selfName, nearby, live, sleepers);
    const peers = allPeers.slice(0, 48);
    const figures = peers.map((peer): PeerFigure => ({ name: peer.name, level: peer.level,
        local: peer.currentSector===sector, style: peer.gaitPresentation?.style,
        starter: starterModel(peer.character?.avatarImage ?? '', peer.character?.starterWorldModel),
        model: isPlayerModel(peer.character?.playerModel) ? peer.character.playerModel : undefined,
        src: sharedAvatarFor(sharedImages, peer.name) || peer.character?.avatarImage || '', sleeping: peer.sleeping === true }));
    const latest = useRef(peers), elements = useRef(new Map<string, HTMLDivElement>()), root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { latest.current = peers; });
    useEffect(() => {
        let alive = true, frame = 0, last = 0;
        const motion = new Map<string, Motion>();
        const reduced=matchMedia('(prefers-reduced-motion: reduce)');
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
                // The buffered road ends at the last server position. A slow phone frame
                // can consume its elapsed time without predicting beyond that point.
                const dt = (now - (last || now)) / 1000; last = now;
                const scale = width / 12;
                const present = new Set<string>();
                for (const peer of latest.current) {
                    let item = motion.get(peer.name);
                    // The record reconciled last frame reads the same cursor and makes the same
                    // no-op decision again, so only a new record is read and compared.
                    if (item?.peer !== peer) {
                        const cursor = world.model.read(peer.worldPosition) ?? world.model.fallback(peer.currentSector ?? sector, peer.tile ?? playerNameTile(peer.name));
                        if (!cursor) continue;
                        // Camps have no live movement sequence. Reset on sleep/wake so
                        // a previous session's sequence cannot pin the marker offscreen.
                        if (!item || Boolean(item.peer.sleeping) !== Boolean(peer.sleeping)) { const point = world.model.point(cursor); item = { cursor, point, points: [point], sequence: peer.movementSequence ?? 0, peer, updated:now }; motion.set(peer.name, item); }
                        else if ((peer.movementSequence ?? 0) >= item.sequence && JSON.stringify(cursor) !== JSON.stringify(item.cursor)) {
                            // Finish the buffered graph path before adopting the next partial edge.
                            const path = peerWorldPath(world.nodes, item.cursor, cursor);
                            const previous=world.model.point(item.cursor), next=world.model.point(cursor);
                            const speed=Math.hypot(next.x-previous.x,next.y-previous.y)*1000/Math.max(1,now-item.updated);
                            const rate = peer.gaitPresentation ? sectorGaitTilesPerSecond[peer.gaitPresentation.gait]
                                : Math.min(sectorGaitTilesPerSecond.run, Math.max(sectorGaitTilesPerSecond.walk, speed));
                            if (path && item.points.length + path.length <= 64) {
                                for (const end of path.slice(1)) item.points.push({x:end.x, y:end.y, rate});
                            } else item.points = [next];
                            item.updated=now;
                            item.cursor = cursor;
                        }
                        item.sequence = Math.max(item.sequence, peer.movementSequence ?? 0);
                        item.peer = peer;
                    }
                    present.add(peer.name);
                    const sprite=models.current.get(peer.name), previous=item.point;
                    item.point = advanceTimedPeerPath(item.points, dt, sprite ? undefined : 8) ?? previous;
                    const element = elements.current.get(peer.name);
                    if (!element) continue;
                    element.classList.toggle('is-walking', item.points.length > 1);
                    const x = (item.point.x - chunk.x) * scale, y = (item.point.y - chunk.y) * scale;
                    if (sprite && (dt > 1 || (item.point.rate === undefined && previous !== item.point))) {
                        item.lastMovementAt=undefined;
                        sprite.snap(x,y,width);
                    } else {
                        if (previous.x!==item.point.x || previous.y!==item.point.y) item.lastMovementAt=now;
                        // A zero-distance moving update holds the painted foot. A brief
                        // missing packet must not restart the authored stop/start graph.
                        sprite?.place(x,y,width,!reduced.matches && peerPoseInMotion(item.lastMovementAt,now),
                            (item.point.rate ?? sectorGaitTilesPerSecond.walk)*90>78?'run':'walk',true);
                    }
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
    return <div className="continuous-world-peers" ref={root} aria-hidden="true"><PeerFigures figures={figures} elements={elements} models={models} artBase={gaits && artBase || ''} />
        {allPeers.length > peers.length && <div className="sector-peers-overflow">+{allPeers.length - peers.length} more here</div>}</div>;
}, sameContinuousWorldPeersProps);
