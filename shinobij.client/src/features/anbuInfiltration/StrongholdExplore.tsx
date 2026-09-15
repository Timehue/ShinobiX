import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { strongholdRooms, strongholdTitle, isDeathsGateStronghold, STRONGHOLD_VAULT, STRONGHOLD_THREAT_PER_STEP, type StrongholdVisit } from '../../../../shared/sector-stronghold';
import type { Character, PlayerRecord } from '../../types/character';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { computeHollowGateVisible } from '../../lib/hollow-gate-visibility';
import { findHollowGatePath } from '../../lib/hollow-gate-path';
import { buildVaultInterior } from './vault-interior';
import { strongholdRequest, type StrongholdResponse } from './stronghold-api';
import { StrongholdDialog } from './StrongholdDialog';
import { resolveOwnAvatar } from '../../lib/own-avatar';
import './stronghold.css';

export function StrongholdExplore({ character, sector, targetVillage, sharedImages, anbuAvatar, anbuName, blocked,
    onChallenge, onPatrol, onAttackPlayer, onExit }: {
    character: Character; sector: number; targetVillage: string; sharedImages: Record<string, string>;
    anbuAvatar: string | null; anbuName: string; blocked: boolean;
    onChallenge: () => void; onPatrol: (session: SoloPveSession) => void;
    onAttackPlayer: (player: PlayerRecord) => void | Promise<void>; onExit: () => void;
}) {
    const [state, setState] = useState<(StrongholdResponse & { receivedAt: number }) | null>(null);
    const [error, setError] = useState('');
    const [overview, setOverview] = useState(false);
    const [playersOpen, setPlayersOpen] = useState(false);
    const [selectedPeer, setSelectedPeer] = useState<PlayerRecord | null>(null);
    const [pending, setPending] = useState<'attack' | 'leave' | null>(null);
    const [reconnect, setReconnect] = useState(0);
    const [metrics, setMetrics] = useState({ width: 800, height: 600 });
    const viewport = useRef<HTMLDivElement>(null);
    const current = useRef<StrongholdVisit | null>(null);
    const busy = useRef(false);
    const polling = useRef(false);
    const alive = useRef(false);
    const stopped = useRef(false);
    const lifetime = useRef<{ controller: AbortController; presenceId: string } | null>(null);
    const actionPending = useRef(false);
    const path = useRef<number[]>([]);
    const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const movementBlocked = blocked || overview || !!pending || playersOpen || !!selectedPeer || !!error;
    const callbacks = useRef({ onPatrol, blocked: movementBlocked });
    useLayoutEffect(() => { callbacks.current = { onPatrol, blocked: movementBlocked }; });
    const obsidian = isDeathsGateStronghold(sector);
    const rooms = strongholdRooms(sector);
    const title = strongholdTitle(sector);
    const ownAvatar = resolveOwnAvatar(character, sharedImages);
    const base = useMemo(() => buildVaultInterior(sector), [sector]);
    const playerTile = state?.visit.tile ?? base.playerY * base.width + base.playerX;
    const run = useMemo(() => ({ ...base, playerX: playerTile % base.width,
        playerY: Math.floor(playerTile / base.width) }), [base, playerTile]);
    const visible = useMemo(() => computeHollowGateVisible(run), [run]);
    const seen = useMemo(() => {
        const known = new Set<number>();
        for (const tile of state?.visit.visited ?? []) {
            computeHollowGateVisible({ ...base, playerX: tile % base.width, playerY: Math.floor(tile / base.width) }).forEach(i => known.add(i));
        }
        return known;
    }, [base, state?.visit.visited]);
    const discovered = useMemo(() => new Set([...seen].map(i => base.tiles[i].roomId).filter(id => id != null)), [base, seen]);
    const roomId = run.tiles[run.playerY * run.width + run.playerX].roomId;
    const roomName = roomId == null ? 'Connecting passage' : rooms[roomId].name;
    const threat = state?.visit.threat ?? 0;
    const remaining = Math.ceil((100 - threat) / STRONGHOLD_THREAT_PER_STEP);

    function stopWalk() {
        path.current = [];
        if (walkTimer.current) clearTimeout(walkTimer.current);
        walkTimer.current = null;
    }
    function adopt(next: StrongholdResponse, context = lifetime.current) {
        if (!alive.current || stopped.current || context !== lifetime.current || context?.controller.signal.aborted) return;
        if (current.current && next.visit.id === current.current.id && next.visit.version < current.current.version) return;
        // Polls refresh presence, but unchanged exploration must retain its
        // identity so the full fog-of-war history is not recomputed every 2s.
        const previous = current.current?.visited;
        if (previous && previous.length === next.visit.visited.length && previous.every((tile, i) => tile === next.visit.visited[i])) {
            next = { ...next, visit: { ...next.visit, visited: previous } };
        }
        current.current = next.visit;
        setState({ ...next, receivedAt: Date.now() });
        setError('');
        if (next.patrol) { stopWalk(); stopped.current = true; callbacks.current.onPatrol(next.patrol); }
    }
    useEffect(() => {
        alive.current = true;
        stopped.current = false;
        busy.current = false;
        polling.current = false;
        current.current = null;
        const context = { controller: new AbortController(), presenceId: crypto.randomUUID() };
        lifetime.current = context;
        let timer: ReturnType<typeof setTimeout>;
        async function refresh(enter = false) {
            if (context.controller.signal.aborted) return;
            let ownsRequest = false;
            try {
                if (!busy.current && !polling.current && !stopped.current) {
                    ownsRequest = true;
                    polling.current = true;
                    adopt(await strongholdRequest(character.name, sector, enter ? 'enter' : 'state', { presenceId: context.presenceId }, context.controller.signal), context);
                }
            } catch (e) { if (!context.controller.signal.aborted) setError((e as Error).message || 'Connection interrupted. Reconnect to continue.'); }
            finally { if (ownsRequest && context === lifetime.current) polling.current = false; }
            // Continue scheduling while exit/attack is pending: failed actions must
            // resume presence and patrol recovery without needing a page reload.
            if (!context.controller.signal.aborted) timer = setTimeout(() => void refresh(!current.current), 2000);
        }
        void refresh(true);
        return () => { alive.current = false; context.controller.abort(); clearTimeout(timer); stopWalk(); };
        // The visit belongs to this player/sector; live callbacks are mirrored above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.name, sector, reconnect]);
    useLayoutEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setMetrics(previous => previous.width === element.clientWidth && previous.height === element.clientHeight
            ? previous : { width: element.clientWidth, height: element.clientHeight }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    async function step(tile: number): Promise<boolean> {
        const visit = current.current;
        if (!visit || busy.current || callbacks.current.blocked || stopped.current || visit.threat >= 100) return false;
        const target = base.tiles[tile];
        if (!target || target.kind === 'wall') return false;
        const distance = Math.abs(tile % base.width - visit.tile % base.width) + Math.abs(Math.floor(tile / base.width) - Math.floor(visit.tile / base.width));
        if (distance !== 1) return false;
        if (target.kind === 'boss') { stopWalk(); onChallenge(); return false; }
        busy.current = true;
        const context = lifetime.current;
        try {
            const next = await strongholdRequest(character.name, sector, 'step', { tile, version: visit.version, presenceId: context?.presenceId }, context?.controller.signal);
            adopt(next, context);
            return context === lifetime.current && !context?.controller.signal.aborted && next.visit.tile === tile && next.visit.threat < 100 && !next.patrol;
        } catch (e) {
            stopWalk();
            if (alive.current && context === lifetime.current && !context?.controller.signal.aborted) setError((e as Error).message);
            return false;
        } finally { if (context === lifetime.current) busy.current = false; }
    }
    async function pump() {
        const next = path.current.shift();
        if (next == null || !await step(next)) { stopWalk(); return; }
        if (alive.current && path.current.length) walkTimer.current = setTimeout(() => void pump(), 90);
    }
    function walkTo(tile: number) {
        if (movementBlocked || overview || !current.current || busy.current || stopped.current) return;
        const route = findHollowGatePath({ ...base, playerX: current.current.tile % base.width, playerY: Math.floor(current.current.tile / base.width) }, tile, seen);
        if (!route?.length) return;
        stopWalk(); path.current = route; void pump();
    }
    function direction(dx: number, dy: number) {
        const visit = current.current;
        if (!visit) return;
        const x = visit.tile % base.width + dx, y = Math.floor(visit.tile / base.width) + dy;
        if (x < 0 || y < 0 || x >= base.width || y >= base.height) return;
        stopWalk(); void step(y * base.width + x);
    }
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const element = event.target as HTMLElement;
            if (element?.closest('input, textarea, select, dialog, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
            const delta = ({ arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] } as Record<string, number[]>)[event.key.toLowerCase()];
            if (delta) { event.preventDefault(); direction(delta[0], delta[1]); }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    useEffect(() => { if (movementBlocked || overview) stopWalk(); }, [movementBlocked, overview]);

    const tileSize = overview ? Math.min(metrics.width / base.width, metrics.height / base.height) : Math.max(44, Math.min(88, metrics.width / 13, metrics.height / 9));
    const avatarSize = tileSize * 0.72;
    const mapWidth = base.width * tileSize, mapHeight = base.height * tileSize;
    const camera = (player: number, view: number, size: number) => size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, view / 2 - (player + 0.5) * tileSize));
    const peers = state?.peers ?? [];
    const peerTiles = new Map<number, PlayerRecord[]>();
    for (const peer of peers) {
        const tile = peer.stronghold?.tile;
        if (tile != null && visible.has(tile)) peerTiles.set(tile, [...(peerTiles.get(tile) ?? []), peer]);
    }
    const availablePeers = peers.filter(peer => !peer.inBattle && !(peer.travelingUntil && peer.travelingUntil > (state?.receivedAt ?? 0)));
    const art = (role: string) => obsidian
        ? ({ 'deco-1': '/sector-props/volcano/obsidian-shard.webp', 'deco-2': '/sector-props/volcano/ember-vent.webp' } as Record<string, string>)[role]
        : sharedImages[`shrine:icon-theme-warvault-${role}`];
    async function leave() {
        if (actionPending.current) return;
        actionPending.current = true; setPending('leave');
        stopWalk(); stopped.current = true;
        try { await strongholdRequest(character.name, sector, 'leave', { presenceId: lifetime.current?.presenceId }); onExit(); }
        catch (e) { stopped.current = false; if (alive.current) setError((e as Error).message); }
        finally { actionPending.current = false; if (alive.current) setPending(null); }
    }
    async function attack(peer: PlayerRecord) {
        if (actionPending.current || blocked || threat >= 100 || !availablePeers.some(p => p.name === peer.name)) return;
        actionPending.current = true; setPending('attack'); stopWalk(); stopped.current = true;
        try { await onAttackPlayer(peer); if (alive.current) setSelectedPeer(null); }
        catch (e) { if (alive.current) setError((e as Error).message || 'Could not start the fight. Try again.'); }
        finally { actionPending.current = false; stopped.current = false; if (alive.current) setPending(null); }
    }
    const playerList = <div className="stronghold-roster"><h3>Players inside <span>{peers.length + (state ? 1 : 0)}</span></h3>
        {peers.length === 0 && <p>No other shinobi inside yet.</p>}
        {peers.map(peer => <div className="stronghold-roster-row" key={peer.name}><div><b>{peer.name}</b><span>Lv {peer.level} · {peer.inBattle ? 'In battle' : peer.village}</span></div><button disabled={blocked || !!pending || threat >= 100 || !availablePeers.includes(peer)} onClick={() => { stopWalk(); setPlayersOpen(false); setSelectedPeer(peer); }}>Inspect</button></div>)}
    </div>;

    return <section className={`stronghold-shell${obsidian ? ' stronghold-obsidian' : ''}`} aria-label={title}>
        <header className="stronghold-header">
            <div><span className="stronghold-eyebrow">{obsidian ? 'Death’s Gate · Open PvP' : `${targetVillage} territory`}</span><h2>{title}</h2><p>{obsidian ? 'Twelve chambers. Rival shinobi. No sanctuary.' : 'Reach the Anbu vault. Watch for patrols and rival shinobi.'}</p></div>
            <div className={`stronghold-threat ${threat >= 80 ? 'is-danger' : ''}`}>
                <div><b>Threat</b><strong>{threat}%</strong></div>
                <div role="progressbar" aria-label="Stronghold threat" aria-valuemin={0} aria-valuemax={100} aria-valuenow={threat}><i style={{ width: `${threat}%` }} /></div>
                <span>{threat >= 100 ? 'Patrol closing in…' : `${remaining} steps until a patrol${threat >= 80 ? ' · Ambush imminent' : ''}`}</span>
            </div>
            <button className="stronghold-leave" onClick={() => void leave()} disabled={!!pending}>{pending === 'leave' ? 'Leaving…' : 'Leave stronghold'}</button>
        </header>
        {obsidian && <div className="stronghold-reward-banner"><strong>4× PvP rewards</strong><span>Ryo · Stat growth · Jutsu XP</span></div>}
        <div className="stronghold-body">
            <div className="stronghold-viewport" ref={viewport}>
                <div className="stronghold-location"><b>{roomName}</b><span>{discovered.size} / {rooms.length} chambers discovered</span></div>
                <div className="stronghold-map" style={{ width: mapWidth, height: mapHeight, gridTemplateColumns: `repeat(${base.width}, ${tileSize}px)`, transform: `translate(${camera(run.playerX, metrics.width, mapWidth)}px, ${camera(run.playerY, metrics.height, mapHeight)}px)` }}>
                    {run.tiles.map((tile, idx) => {
                        const known = seen.has(idx), lit = visible.has(idx);
                        const role = tile.kind === 'wall' ? (run.tiles[idx + base.width]?.kind !== 'wall' ? 'wall-face' : 'wall') : tile.terrain === 'door' ? 'door' : tile.terrain === 'corridor_floor' ? 'corridor' : 'floor';
                        const url = art(role);
                        return <div key={idx} className={`stronghold-tile ${tile.kind === 'wall' ? 'is-wall' : 'is-floor'}${obsidian && idx === STRONGHOLD_VAULT ? ' is-blood-altar' : ''}`} onClick={() => walkTo(idx)}
                            style={{ width: tileSize, height: tileSize, backgroundImage: url && known ? `url(${url})` : undefined, opacity: lit ? 1 : known ? 0.42 : tile.kind === 'wall' ? 0.08 : 0.12 }}>
                            {known && tile.decoration != null && art(`deco-${tile.decoration + 1}`) && <img className="stronghold-decoration" src={art(`deco-${tile.decoration + 1}`)} alt="" />}
                            {known && tile.kind === 'boss' && <img className="stronghold-anbu" src={anbuAvatar ?? ''} alt={anbuName} />}
                        </div>;
                    })}
                    {rooms.filter(room => seen.has((room.y + 2) * base.width + room.x + 3)).map(room => <span key={room.id} className="stronghold-room-label" style={{ left: (room.x + 3.5) * tileSize, top: (room.y + 0.2) * tileSize, fontSize: overview ? 9 : 12 }}>{room.name}</span>)}
                    <div className="stronghold-player stronghold-avatar" style={{ left: (run.playerX + 0.5) * tileSize, top: (run.playerY + 0.5) * tileSize, width: avatarSize, height: avatarSize }}>
                        {ownAvatar ? <img src={ownAvatar} alt="Your position" /> : <b>{character.name.slice(0, 2)}</b>}
                    </div>
                    {!overview && [...peerTiles].map(([tile, occupants]) => {
                        const peer = occupants[0];
                        const avatar = sharedImages[`avatar:${peer.name.toLowerCase()}`] || peer.character?.avatarImage;
                        return <button key={tile} className="stronghold-peer" aria-label={`Inspect ${occupants.length > 1 ? `${occupants.length} shinobi` : peer.name}`} title={`${peer.name} · Lv ${peer.level}${peer.inBattle ? ' · In battle' : ''}`}
                            disabled={blocked || !!pending || overview} onClick={() => { stopWalk(); if (occupants.length > 1) setPlayersOpen(true); else setSelectedPeer(peer); }}
                            style={{ left: (tile % base.width + 0.5) * tileSize, top: (Math.floor(tile / base.width) + 0.5) * tileSize, width: Math.max(44, avatarSize), height: Math.max(44, avatarSize) }}>
                            <span className="stronghold-avatar stronghold-peer-avatar" style={{ width: avatarSize, height: avatarSize }}>
                                {occupants.length > 1 ? <b>{occupants.length}</b> : avatar ? <img src={avatar} alt="" /> : <b>{peer.name.slice(0, 2)}</b>}
                            </span>
                            <span className="stronghold-peer-label">{occupants.length > 1 ? `${occupants.length} shinobi` : peer.name}</span>
                        </button>;
                    })}
                </div>
                {!state && <div className="stronghold-loading" role="status">{error || 'Entering the stronghold…'}{error && <button onClick={() => setReconnect(value => value + 1)}>Reconnect</button>}</div>}
                <button className="stronghold-zoom" aria-pressed={overview} onClick={() => setOverview(value => !value)}>{overview ? 'Follow player' : 'View full map'}</button>
            </div>
            <aside className="stronghold-sidebar">
                <div className="stronghold-intel"><h3>Stronghold map</h3>
                    <svg className="stronghold-minimap" viewBox={`0 0 ${base.width} ${base.height}`} role="img" aria-label={`${discovered.size} of 12 chambers discovered. Your position is white; the ${obsidian ? 'Blood Altar' : 'vault'} is gold.`}>
                        {run.tiles.map((tile, idx) => tile.kind === 'wall' ? null : <rect key={idx} x={idx % base.width} y={Math.floor(idx / base.width)} width={1} height={1} fill={idx === STRONGHOLD_VAULT ? '#fbbf24' : seen.has(idx) ? (obsidian ? '#aa7865' : '#647c98') : '#1f2c3b'} />)}
                        {peers.filter(peer => peer.stronghold && visible.has(peer.stronghold.tile)).map(peer => <circle key={peer.name} cx={peer.stronghold!.tile % base.width + 0.5} cy={Math.floor(peer.stronghold!.tile / base.width) + 0.5} r={0.65} fill="#fb7185" />)}
                        <circle cx={run.playerX + 0.5} cy={run.playerY + 0.5} r={0.8} fill="white" />
                    </svg><p>White: you · Red: players · Gold: {obsidian ? 'Blood Altar' : 'vault'}</p>
                </div>
                {playerList}
                <p className="stronghold-hint">Each step adds 4% threat. Defeat the patrol to keep exploring. {obsidian ? 'Meet your rivals at the Blood Altar in the southeast. PvP wins anywhere inside earn double Death’s Gate’s rewards. Patrols do not earn this bonus. Normal reward limits apply.' : 'The Anbu guards the vault in the southeast.'}</p>
            </aside>
        </div>
        <footer className="stronghold-footer"><div className="stronghold-guidance"><span role="status">{error || (pending === 'attack' ? 'Connecting to battle…' : state?.combatBlocked ? 'Resolve your PvP fight, then return to face the patrol.' : overview ? 'Map overview · Return to follow view to move.' : 'Tap the floor or use the arrows to move.')}</span>
            {error && state && <button onClick={() => setReconnect(value => value + 1)}>Reconnect</button>}
            <button className="stronghold-players-toggle" onClick={() => { stopWalk(); setPlayersOpen(true); }}>Players <b>{peers.length + (state ? 1 : 0)}</b></button>
            </div>
            <div className="stronghold-dpad" aria-label="Movement controls">{([['↑', 0, -1, 'Move up'], ['←', -1, 0, 'Move left'], ['↓', 0, 1, 'Move down'], ['→', 1, 0, 'Move right']] as const).map(([label, dx, dy, name]) => <button key={name} aria-label={name} disabled={movementBlocked || overview || !state || threat >= 100} onClick={() => direction(dx, dy)}>{label}</button>)}</div>
        </footer>
        {playersOpen && <StrongholdDialog title="Shinobi in the stronghold" onClose={() => setPlayersOpen(false)}>{playerList}</StrongholdDialog>}
        {selectedPeer && <StrongholdDialog title={selectedPeer.name} onClose={() => setSelectedPeer(null)}>
            <p>Level {selectedPeer.level} · {selectedPeer.village}</p>
            <p>Challenge this shinobi to a sector battle. Your current health and supplies carry into the fight.</p>
            {obsidian && <p className="stronghold-reward-detail"><b>4× normal rewards on a PvP win.</b> Both fighters must be inside when the battle starts. Ryo, stat growth and XP for jutsu you cast receive the bonus; normal limits and repeat-opponent reductions apply.</p>}
            <div className="stronghold-dialog-actions"><button className="stronghold-attack" disabled={blocked || !!pending || threat >= 100 || !availablePeers.some(p => p.name === selectedPeer.name)} onClick={() => void attack(selectedPeer)}>{pending === 'attack' ? 'Connecting…' : 'Attack player'}</button><button onClick={() => setSelectedPeer(null)}>Cancel</button></div>
        </StrongholdDialog>}
    </section>;
}
