import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { advanceStronghold, ANBU_RAID_MIN_LEVEL, strongholdRooms, strongholdTitle, isDeathsGateStronghold, STRONGHOLD_INTEL_ROOM_ID, STRONGHOLD_INTEL_TILE, STRONGHOLD_VAULT, STRONGHOLD_THREAT_PER_STEP, type StrongholdVisit } from '../../../../shared/sector-stronghold';
import type { Character, PlayerRecord } from '../../types/character';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { computeHollowGateVisible } from '../../lib/hollow-gate-visibility';
import { findHollowGatePath } from '../../lib/hollow-gate-path';
import { buildVaultInterior } from './vault-interior';
import { strongholdRequest, type StrongholdResponse } from './stronghold-api';
import { StrongholdDialog } from './StrongholdDialog';
import { resolveOwnAvatar } from '../../lib/own-avatar';
import { UndergroundSectorTerrain } from '../../components/UndergroundSectorTerrain';
import { undergroundCamera, undergroundRenderWindow, undergroundRooms, undergroundTileSize } from '../../lib/underground-sector-camera';
import { sectorContestLabel, sectorContestGarrisonReady, sectorEngagementFor, viewerSectorContest, type SectorWarContestView } from '../../lib/sector-war-engagement';
import './stronghold.css';
const strongholdVisibilityCache = new WeakMap<object, Map<number, Set<number>>>();
function visibilityForStrongholdTile(base: ReturnType<typeof buildVaultInterior>, tile: number): Set<number> {
    let byTile = strongholdVisibilityCache.get(base);
    if (!byTile) {
        byTile = new Map();
        strongholdVisibilityCache.set(base, byTile);
    }
    let visible = byTile.get(tile);
    if (!visible) {
        visible = computeHollowGateVisible({ ...base, playerX: tile % base.width, playerY: Math.floor(tile / base.width) });
        byTile.set(tile, visible);
    }
    return visible;
}

/**
 * One tile pace: the avatar and the camera glide over .16s (stronghold.css),
 * so a step leaves no sooner than the previous glide ends, or when the server
 * answers if that is later. It also keeps a held key well inside the
 * stronghold-walk request limit.
 */
const STEP_MS = 160;
/** Taps that can wait behind the step in flight: under a second of walking. */
const MAX_QUEUED_INPUTS = 4;
const sameTiles = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((tile, i) => tile === b[i]);

type TileCellProps = {
    idx: number; width: number; tileSize: number; avatarSize: number; overview: boolean;
    known: boolean; lit: boolean; walkable: boolean; movementBlocked: boolean;
    wall: boolean; boss: boolean; door: boolean; bloodAltar: boolean; intelCache: boolean; intelMarker: boolean;
    anbuAvatar: string | null; anbuName: string; anbuCaption: string;
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};
/**
 * One floor tile. Memoized on primitives, so a step re-renders the few dozen
 * tiles whose light or occupancy changed instead of all 851, and a presence
 * poll or a parent clock re-renders none. The handlers are shared: they read
 * the tile from data-tile, and walkability from the role it sets.
 */
const StrongholdTileCell = memo(function StrongholdTileCell({ idx, width, tileSize, avatarSize, overview, known, lit, walkable, movementBlocked,
    wall, boss, door, bloodAltar, intelCache, intelMarker, anbuAvatar, anbuName, anbuCaption, onClick, onKeyDown }: TileCellProps) {
    return <div data-tile={idx} role={walkable ? 'button' : undefined} aria-disabled={walkable && movementBlocked ? true : undefined} tabIndex={walkable && !movementBlocked ? 0 : -1} aria-label={walkable ? `${boss ? 'Anbu vault' : bloodAltar ? 'Blood Altar' : door ? 'Passage' : 'Dungeon floor'}, row ${Math.floor(idx / width) + 1}, column ${idx % width + 1}` : undefined}
        className={`stronghold-tile ${wall ? 'is-wall' : 'is-floor'}${bloodAltar ? ' is-blood-altar' : ''}${intelCache ? ' is-intel-cache' : ''}`} onClick={onClick}
        onKeyDown={onKeyDown}
        style={{ gridColumn: idx % width + 1, gridRow: Math.floor(idx / width) + 1, width: tileSize, height: tileSize, opacity: lit ? 1 : .42 }}>
        {known && bloodAltar && <span className="underground-marker" aria-hidden="true">⚔</span>}
        {known && intelMarker && <span className="underground-marker" aria-hidden="true">▤</span>}
        {known && boss && <span className="stronghold-anbu-station" style={{ width: avatarSize, height: avatarSize * 1.28 }}><i aria-hidden="true" />{anbuAvatar ? <img className="stronghold-anbu" src={anbuAvatar} alt={anbuName} /> : <span className="stronghold-anbu-fallback" aria-hidden="true">◆</span>}{!overview && <b>{anbuName}<small>{anbuCaption}</small></b>}</span>}
    </div>;
});

export function StrongholdExplore({ character, sector, targetVillage, sharedImages, anbuAvatar, anbuName, blocked,
    admissionPending = false, admissionError, onRetryAdmission,
    onChallenge, onPatrol, onAttackPlayer, onExit, defending = false, sectorContest, onOpenSectorContest, onFightSectorGarrison }: {
    character: Character; sector: number; targetVillage: string; sharedImages: Record<string, string>;
    anbuAvatar: string | null; anbuName: string; blocked: boolean;
    admissionPending?: boolean; admissionError?: string | null; onRetryAdmission?: () => void;
    onChallenge: () => void; onPatrol: (session: SoloPveSession) => void;
    onAttackPlayer: (player: PlayerRecord) => void | Promise<void>; onExit: () => void;
    defending?: boolean;
    sectorContest?: SectorWarContestView | null;
    onOpenSectorContest?: () => void;
    onFightSectorGarrison?: () => void;
}) {
    const [state, setState] = useState<(StrongholdResponse & { receivedAt: number }) | null>(null);
    // The step in flight, shown before the server confirms it. advanceStronghold
    // is the rule the server applies, so its answer replaces this unchanged; a
    // refusal clears it and the avatar returns to the confirmed tile.
    const [predicted, setPredicted] = useState<StrongholdVisit | null>(null);
    const predictedRef = useRef<StrongholdVisit | null>(null);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [overview, setOverview] = useState(false);
    const [playersOpen, setPlayersOpen] = useState(false);
    const [intelOpen, setIntelOpen] = useState(false);
    const [selectedPeer, setSelectedPeer] = useState<PlayerRecord | null>(null);
    const [pending, setPending] = useState<'attack' | 'leave' | null>(null);
    const [intelPending, setIntelPending] = useState(false);
    const [reconnect, setReconnect] = useState(0);
    const [metrics, setMetrics] = useState({ width: 0, height: 0 });
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
    // Deliberate inputs that arrived while a step was in flight or gliding (a
    // fresh key press, a D-pad tap, a tile click). They run in order, one glide
    // apart. Held-key repeats are never queued, so letting go cannot add a step;
    // a tile click replaces the queue, since it names a destination.
    const queued = useRef<Array<{ dx: number; dy: number } | { tile: number }>>([]);
    const lastStepAt = useRef(Number.NEGATIVE_INFINITY);
    const lastStepReplyAt = useRef(Number.NEGATIVE_INFINITY);
    const movementBlocked = blocked || !!state?.combatBlocked || overview || !!pending || playersOpen || intelOpen || !!selectedPeer || !!error || !!actionError;
    const callbacks = useRef({ onPatrol, blocked: movementBlocked });
    useLayoutEffect(() => { callbacks.current = { onPatrol, blocked: movementBlocked }; });
    const obsidian = isDeathsGateStronghold(sector);
    const rooms = strongholdRooms(sector);
    const title = strongholdTitle(sector);
    const ownAvatar = resolveOwnAvatar(character, sharedImages);
    const base = useMemo(() => buildVaultInterior(sector), [sector]);
    const chamberBounds = useMemo(() => undergroundRooms(base.tiles, base.width), [base]);
    const shownVisit = predicted ?? state?.visit;
    const playerTile = shownVisit?.tile ?? base.playerY * base.width + base.playerX;
    const run = useMemo(() => ({ ...base, playerX: playerTile % base.width,
        playerY: Math.floor(playerTile / base.width) }), [base, playerTile]);
    // Stronghold polls every two seconds, and its visit history can contain a
    // tile for every step. Reuse each tile's line-of-sight result across polls
    // and movement; the WeakMap naturally releases it when this floor unmounts.
    const visible = useMemo(() => visibilityForStrongholdTile(base, playerTile), [base, playerTile]);
    const seen = useMemo(() => {
        const known = new Set<number>();
        for (const tile of shownVisit?.visited ?? []) {
            visibilityForStrongholdTile(base, tile).forEach(i => known.add(i));
        }
        return known;
    }, [base, shownVisit?.visited]);
    const discovered = useMemo(() => new Set([...seen].map(i => base.tiles[i].roomId).filter(id => id != null)), [base, seen]);
    const intelKnown = discovered.has(STRONGHOLD_INTEL_ROOM_ID);
    const roomId = run.tiles[run.playerY * run.width + run.playerX].roomId;
    const roomName = roomId == null ? 'Connecting passage' : rooms[roomId].name;
    const atIntelCache = !obsidian && playerTile === STRONGHOLD_INTEL_TILE;
    const threat = shownVisit?.threat ?? 0;
    const remaining = Math.ceil((100 - threat) / STRONGHOLD_THREAT_PER_STEP);
    const presenceTime = state?.receivedAt ?? 0;
    const contest = viewerSectorContest(sectorContest, sector, character.village, presenceTime);
    const selectedEngagement = selectedPeer ? sectorEngagementFor({ contest, sector, myVillage: character.village, targetVillage: selectedPeer.village, now: presenceTime }) : null;

    function stopWalk() {
        path.current = [];
        queued.current = [];
        if (walkTimer.current) clearTimeout(walkTimer.current);
        walkTimer.current = null;
    }
    function showStep(visit: StrongholdVisit | null) {
        predictedRef.current = visit;
        setPredicted(visit);
    }
    function adopt(next: StrongholdResponse, context = lifetime.current) {
        if (!alive.current || stopped.current || context !== lifetime.current || context?.controller.signal.aborted) return;
        if (current.current && next.visit.id === current.current.id && next.visit.version < current.current.version) return;
        // Polls refresh presence, but unchanged exploration must retain its
        // identity so the full fog-of-war history is not recomputed every 2s.
        // A step's answer keeps the identity its shown prediction already used.
        const previous = [predictedRef.current?.visited, current.current?.visited].find(tiles => tiles && sameTiles(tiles, next.visit.visited));
        if (previous) next = { ...next, visit: { ...next.visit, visited: previous } };
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
        actionPending.current = false;
        current.current = null;
        const context = { controller: new AbortController(), presenceId: crypto.randomUUID() };
        lifetime.current = context;
        let timer: ReturnType<typeof setTimeout>;
        async function refresh(enter = false) {
            if (context.controller.signal.aborted) return;
            let ownsRequest = false;
            try {
                // Each step's answer carries the roster and renews the interior
                // lease, so a poll while steps are landing only adds a request
                // that the next step would wait on. It resumes once walking stops.
                const walking = !enter && performance.now() - lastStepReplyAt.current < 1500;
                if (!busy.current && !polling.current && !stopped.current && !walking) {
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
        if (!visit || document.hidden || busy.current || callbacks.current.blocked || stopped.current || visit.threat >= 100) return false;
        const target = base.tiles[tile];
        if (!target || target.kind === 'wall' || target.solid) return false;
        const distance = Math.abs(tile % base.width - visit.tile % base.width) + Math.abs(Math.floor(tile / base.width) - Math.floor(visit.tile / base.width));
        if (distance !== 1) return false;
        if (target.kind === 'boss') { stopWalk(); if (!defending) onChallenge(); return false; }
        busy.current = true;
        lastStepAt.current = performance.now();
        const context = lifetime.current;
        // Move now. The server applies the same rule, so its answer normally
        // replaces this with an identical visit; otherwise the avatar returns.
        const shown = advanceStronghold(visit, tile);
        showStep(shown);
        try {
            const next = await strongholdRequest(character.name, sector, 'step', { tile, version: visit.version, presenceId: context?.presenceId }, context?.controller.signal);
            if (context === lifetime.current) lastStepReplyAt.current = performance.now();
            adopt(next, context);
            return context === lifetime.current && !context?.controller.signal.aborted && next.visit.tile === tile && next.visit.threat < 100 && !next.patrol;
        } catch (e) {
            stopWalk();
            if (alive.current && context === lifetime.current && !context?.controller.signal.aborted) setError((e as Error).message);
            return false;
        } finally {
            if (context === lifetime.current) busy.current = false;
            if (alive.current && predictedRef.current === shown) showStep(null);
        }
    }
    /**
     * Once the last step's glide has ended, run the next queued input, else
     * the next tile of a walked path. Nothing is taken from the queue until it
     * runs, so rescheduling this never loses an input.
     */
    function continueWalk() {
        if (!queued.current.length && !path.current.length) return;
        if (walkTimer.current) clearTimeout(walkTimer.current);
        walkTimer.current = setTimeout(() => {
            walkTimer.current = null;
            if (!alive.current) return;
            const input = queued.current.shift();
            if (!input) void pump();
            else if ('tile' in input) startWalk(input.tile);
            else void stepToward(input.dx, input.dy);
        }, Math.max(0, STEP_MS - (performance.now() - lastStepAt.current)));
    }
    async function pump() {
        const next = path.current.shift();
        if (next == null || !await step(next)) { stopWalk(); return; }
        if (alive.current) continueWalk();
    }
    async function stepToward(dx: number, dy: number) {
        const visit = current.current;
        if (!visit) return;
        const x = visit.tile % base.width + dx, y = Math.floor(visit.tile / base.width) + dy;
        if (x < 0 || y < 0 || x >= base.width || y >= base.height) { stopWalk(); return; }
        if (await step(y * base.width + x)) { if (alive.current) continueWalk(); } else stopWalk();
    }
    function startWalk(tile: number) {
        if (!current.current) return;
        const route = findHollowGatePath({ ...base, playerX: current.current.tile % base.width, playerY: Math.floor(current.current.tile / base.width) }, tile, seen);
        if (!route?.length) return;
        stopWalk(); path.current = route; continueWalk();
    }
    function walkTo(tile: number) {
        if (document.hidden || movementBlocked || overview || !current.current || stopped.current) return;
        // A tap during a step re-targets the walk from where that step lands.
        if (busy.current) { stopWalk(); queued.current = [{ tile }]; return; }
        startWalk(tile);
    }
    function direction(dx: number, dy: number, repeat = false) {
        if (!current.current) return;
        const pacing = busy.current || performance.now() - lastStepAt.current < STEP_MS;
        // A held key walks at the glide's pace. Its repeats are never queued,
        // so letting go cannot add a step after the key is up.
        if (repeat && pacing) return;
        if (pacing) {
            // A deliberate press is never dropped: it waits its turn. Keys cancel
            // a tapped walk, and the queue is short so taps cannot run far ahead.
            path.current = [];
            if (queued.current.length < MAX_QUEUED_INPUTS) queued.current.push({ dx, dy });
            if (!busy.current) continueWalk();
            return;
        }
        stopWalk();
        void stepToward(dx, dy);
    }
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (document.hidden) return;
            const element = event.target as HTMLElement;
            if (element?.closest('input, textarea, select, dialog, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
            const delta = ({ arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] } as Record<string, number[]>)[event.key.toLowerCase()];
            // The controller layer re-sends a held stick as synthetic presses
            // (lib/gamepad-navigation.ts), which are a held key's repeats.
            if (delta) { event.preventDefault(); direction(delta[0], delta[1], event.repeat || !event.isTrusted); }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });
    // Shared tile handlers (see StrongholdTileCell), calling the latest walkTo.
    const walkToRef = useRef(walkTo);
    useLayoutEffect(() => { walkToRef.current = walkTo; });
    const onTileClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => walkToRef.current(Number(event.currentTarget.dataset.tile)), []);
    const onTileKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.currentTarget.getAttribute('role') !== 'button' || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        walkToRef.current(Number(event.currentTarget.dataset.tile));
    }, []);
    const anbuCaption = targetVillage === character.village ? 'Village vault · Protected' : (character.level ?? 0) < ANBU_RAID_MIN_LEVEL ? `Treasury raid · Level ${ANBU_RAID_MIN_LEVEL}` : 'Vault defender · Challenge to raid';
    useEffect(() => { if (movementBlocked || overview) stopWalk(); }, [movementBlocked, overview]);
    useEffect(() => {
        const onVisibility = () => { if (document.hidden) stopWalk(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', stopWalk);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', stopWalk);
        };
    }, []);

    const tileSize = overview ? Math.min(metrics.width / base.width, metrics.height / base.height) : undergroundTileSize(metrics, chamberBounds, true);
    const avatarSize = Math.min(56, tileSize * 0.64);
    const mapWidth = base.width * tileSize, mapHeight = base.height * tileSize;
    const camera = undergroundCamera({ view: metrics, width: base.width, height: base.height, tileSize,
        playerX: run.playerX, playerY: run.playerY, room: overview || roomId == null ? undefined : chamberBounds.get(roomId) });
    // Presence refreshes update actors. The unchanged raster window must retain
    // its identity so those heartbeats do not redraw the memoized floor SVG.
    const renderWindow = useMemo(() => overview ? undefined : undergroundRenderWindow({ view: metrics,
        width: base.width, height: base.height, tileSize, camera: { x: camera.x, y: camera.y } }),
    [overview, metrics, base.width, base.height, tileSize, camera.x, camera.y]);
    const peers = state?.peers ?? [];
    const peerTiles = new Map<number, PlayerRecord[]>();
    for (const peer of peers) {
        const tile = peer.stronghold?.tile;
        if (tile != null && visible.has(tile)) peerTiles.set(tile, [...(peerTiles.get(tile) ?? []), peer]);
    }
    const availablePeers = peers.filter(peer => !peer.inBattle && !(peer.travelingUntil && peer.travelingUntil > (state?.receivedAt ?? 0)));
    async function leave() {
        if (actionPending.current || admissionPending) return;
        actionPending.current = true; setPending('leave'); setError('');
        stopWalk(); stopped.current = true;
        const context = lifetime.current;
        const ownsAction = () => alive.current && context === lifetime.current && !context?.controller.signal.aborted;
        try {
            await strongholdRequest(character.name, sector, 'leave', { presenceId: context?.presenceId });
            if (ownsAction()) onExit();
        } catch (e) { if (ownsAction()) { stopped.current = false; setError((e as Error).message); } }
        finally { if (ownsAction()) { actionPending.current = false; setPending(null); } }
    }
    async function attack(peer: PlayerRecord) {
        if (actionPending.current || blocked || threat >= 100 || !availablePeers.some(p => p.name === peer.name)) return;
        actionPending.current = true; setPending('attack'); setActionError(''); setError(''); stopWalk(); stopped.current = true;
        const context = lifetime.current;
        const ownsAction = () => alive.current && context === lifetime.current && !context?.controller.signal.aborted;
        try { await onAttackPlayer(peer); if (ownsAction()) setSelectedPeer(null); }
        catch (e) { if (ownsAction()) setActionError((e as Error).message || 'Could not start the fight. Try again.'); }
        finally { if (ownsAction()) { actionPending.current = false; stopped.current = false; setPending(null); } }
    }
    function reconnectPresence() {
        // A reconnect replaces the presence owner. Keep submitted actions with
        // that owner until their response has been reconciled.
        if (actionPending.current || admissionPending) return;
        setActionError('');
        setReconnect(value => value + 1);
    }
    const playerList = <div className="stronghold-roster"><h3>Players inside <span>{peers.length + (state ? 1 : 0)}</span></h3>
        {peers.length === 0 && <p>No other shinobi inside yet.</p>}
        {peers.map(peer => <div className="stronghold-roster-row" key={peer.name}><div><b>{peer.name}</b><span>Lv {peer.level} · {peer.inBattle ? 'In battle' : peer.village}</span></div><button disabled={blocked || !!pending || threat >= 100 || !availablePeers.includes(peer)} onClick={() => { stopWalk(); setPlayersOpen(false); setIntelOpen(false); setSelectedPeer(peer); }}>Inspect</button></div>)}
    </div>;

    return <section className={`stronghold-shell underground-world${obsidian ? ' stronghold-obsidian underground-world--obsidian' : ''}`} aria-label={title} data-gamepad-mode="sector">
        <header className="stronghold-header">
            <div><span className="stronghold-eyebrow">Dungeon sector · {obsidian ? 'Death’s Gate · Open PvP' : `${targetVillage} territory`}</span><h2>{title}</h2><p>{obsidian ? 'Descend into the ember halls. Rival shinobi await at the Blood Altar.' : defending ? 'Guard duty · Use Players to confront enemy spies inside. Your Anbu stays on defense.' : 'Explore the buried fortress. Reach the Anbu vault through twelve connected chambers.'}</p></div>
            <div className={`stronghold-threat ${threat >= 80 ? 'is-danger' : ''}`}>
                <div><b>Threat</b><strong>{threat}%</strong></div>
                <div role="progressbar" aria-label="Stronghold threat" aria-valuemin={0} aria-valuemax={100} aria-valuenow={threat}><i style={{ width: `${threat}%` }} /></div>
                <span>{threat >= 100 ? 'Patrol closing in…' : `${remaining} steps until a patrol${threat >= 80 ? ' · Ambush imminent' : ''}`}</span>
            </div>
            <button className="stronghold-leave" onClick={() => void leave()} disabled={!!pending || admissionPending}>{pending === 'leave' ? 'Leaving…' : 'Leave stronghold'}</button>
        </header>
        {obsidian && <div className="stronghold-reward-banner"><strong>4× PvP rewards</strong><span>Ryo · Stat growth · Jutsu XP</span></div>}
        {contest && <div className="stronghold-war-banner" role="status"><span><b>Sector {sector} war · {sectorContestLabel(contest.winCondition)}</b><small>{contest.attackerVillage} vs {contest.defenderVillage} · Eligible battles inside count toward this sector.</small></span>
            {onOpenSectorContest && <button disabled={movementBlocked || !state || threat >= 100} onClick={() => { stopWalk(); onOpenSectorContest(); }}>Open {sectorContestLabel(contest.winCondition)}</button>}
            {onFightSectorGarrison && sectorContestGarrisonReady(contest, presenceTime) && <button disabled={movementBlocked || !state || threat >= 100} onClick={() => { stopWalk(); onFightSectorGarrison(); }}>Fight garrison</button>}
        </div>}
        <div className="stronghold-body">
            <div className="stronghold-viewport" ref={viewport}>
                <div className="stronghold-location"><b>{roomName}</b><span>{discovered.size} / {rooms.length} chambers discovered</span></div>
                <div key={overview ? 'overview' : 'follow'} className="stronghold-map" data-tile-size={tileSize} style={{ width: mapWidth, height: mapHeight, gridTemplateColumns: `repeat(${base.width}, ${tileSize}px)`, gridAutoRows: `${tileSize}px`, alignContent: 'start', transform: `translate(${camera.x}px, ${camera.y}px)` }}>
                    <UndergroundSectorTerrain tiles={base.tiles} width={base.width} height={base.height} known={seen} visible={visible} mode="stronghold" vault={!obsidian}
                        renderWindow={renderWindow} />
                    {run.tiles.map((tile, idx) => {
                        const known = seen.has(idx), lit = visible.has(idx);
                        if (!known && !lit) return null;
                        const walkable = known && tile.kind !== 'wall' && !tile.solid && idx !== playerTile;
                        return <StrongholdTileCell key={idx} idx={idx} width={base.width} tileSize={tileSize} avatarSize={avatarSize} overview={overview}
                            known={known} lit={lit} walkable={walkable} movementBlocked={movementBlocked}
                            wall={tile.kind === 'wall'} boss={tile.kind === 'boss'} door={tile.terrain === 'door'}
                            bloodAltar={obsidian && idx === STRONGHOLD_VAULT} intelCache={intelKnown && idx === STRONGHOLD_INTEL_TILE} intelMarker={!obsidian && idx === STRONGHOLD_INTEL_TILE}
                            anbuAvatar={anbuAvatar} anbuName={anbuName} anbuCaption={anbuCaption} onClick={onTileClick} onKeyDown={onTileKeyDown} />;
                    })}
                    {rooms.filter(room => seen.has((room.y + 2) * base.width + room.x + 3)).map(room => <span key={room.id} className="stronghold-room-label" style={{ left: (room.x + 3.5) * tileSize, top: (room.y + 0.3) * tileSize, fontSize: overview ? 9 : 12 }}>{room.name}</span>)}
                    <div className="stronghold-player stronghold-avatar" style={{ left: (run.playerX + 0.5) * tileSize, top: (run.playerY + 0.5) * tileSize, width: avatarSize, height: avatarSize }}>
                        {ownAvatar ? <img src={ownAvatar} alt="Your position" /> : <b>{character.name.slice(0, 2)}</b>}
                    </div>
                    {!overview && [...peerTiles].map(([tile, occupants]) => {
                        const peer = occupants[0];
                        const avatar = sharedImages[`avatar:${peer.name.toLowerCase()}`] || peer.character?.avatarImage;
                        return <button key={tile} className="stronghold-peer" data-tile={tile} aria-label={`Inspect ${occupants.length > 1 ? `${occupants.length} shinobi` : peer.name}`} title={`${peer.name} · Lv ${peer.level}${peer.inBattle ? ' · In battle' : ''}`}
                            disabled={blocked || !!pending || overview} onClick={() => { stopWalk(); if (occupants.length > 1) setPlayersOpen(true); else setSelectedPeer(peer); }}
                            style={{ left: (tile % base.width + 0.5 + (tile === playerTile ? .4 : 0)) * tileSize, top: (Math.floor(tile / base.width) + 0.5 - (tile === playerTile ? .28 : 0)) * tileSize, width: Math.max(44, avatarSize), height: Math.max(44, avatarSize) }}>
                            <span className="stronghold-avatar stronghold-peer-avatar" style={{ width: avatarSize, height: avatarSize }}>
                                {occupants.length > 1 ? <b>{occupants.length}</b> : avatar ? <img src={avatar} alt="" /> : <b>{peer.name.slice(0, 2)}</b>}
                            </span>
                            <span className="stronghold-peer-label">{occupants.length > 1 ? `${occupants.length} shinobi` : peer.name}</span>
                        </button>;
                    })}
                </div>
                {!state && <div className="stronghold-loading" role="status">{error || 'Entering the stronghold…'}{error && <button disabled={!!pending || admissionPending} onClick={reconnectPresence}>Reconnect</button>}</div>}
                <button className="stronghold-zoom" aria-pressed={overview} onClick={() => setOverview(value => !value)}>{overview ? 'Follow player' : 'View full map'}</button>
                <button className="stronghold-intel-toggle" onClick={() => { stopWalk(); setIntelOpen(true); }}>Dungeon intel</button>
            </div>
            {intelOpen && <StrongholdDialog title="Dungeon intel" onClose={() => setIntelOpen(false)}><aside className="stronghold-sidebar">
                <div className="stronghold-intel"><h3>Stronghold map</h3>
                    <svg className="stronghold-minimap" viewBox={`0 0 ${base.width} ${base.height}`} role="img" aria-label={`${discovered.size} of 12 chambers discovered. Your position is white; the ${obsidian ? 'Blood Altar' : 'vault'} is gold.`}>
                        {run.tiles.map((tile, idx) => tile.kind === 'wall' ? null : <rect key={idx} x={idx % base.width} y={Math.floor(idx / base.width)} width={1} height={1} fill={idx === STRONGHOLD_VAULT ? '#fbbf24' : seen.has(idx) ? (obsidian ? '#aa7865' : '#647c98') : '#1f2c3b'} />)}
                        {peers.filter(peer => peer.stronghold && visible.has(peer.stronghold.tile)).map(peer => <circle key={peer.name} cx={peer.stronghold!.tile % base.width + 0.5} cy={Math.floor(peer.stronghold!.tile / base.width) + 0.5} r={0.65} fill="#fb7185" />)}
                        <circle cx={run.playerX + 0.5} cy={run.playerY + 0.5} r={0.8} fill="white" />
                    </svg><p>White: you · Red: players · Gold: {obsidian ? 'Blood Altar' : 'vault'}</p>
                </div>
                {playerList}
                {atIntelCache && <div className="stronghold-intel-cache" aria-live="polite">
                    <h3>War Archives</h3>
                    {state?.visit.intelClaimed
                        ? <p>A patrol ledger marks the southeast vault and a quiet route through the central chambers. Patrol pressure is unchanged.</p>
                        : <><p>A sealed patrol ledger rests here. Inspect it for route intel; it does not affect patrol pressure.</p>
                            <button disabled={intelPending || !!pending || threat >= 100 || !!state?.patrol} onClick={() => void claimIntel()}>{intelPending ? 'Reading…' : 'Inspect patrol ledger'}</button></>}
                </div>}
                <p className="stronghold-hint">Each step adds 4% threat. Defeat the patrol to keep exploring. {obsidian ? 'Meet your rivals at the Blood Altar in the southeast. PvP wins anywhere inside earn double Death’s Gate’s rewards. Patrols do not earn this bonus. Normal reward limits apply.' : 'The Anbu guards the vault in the southeast.'}</p>
                <p className="stronghold-hint underground-field-note">Sector {sector} · Shared dungeon<br />Your sector, village allegiance and active war follow you inside. Rival battles use this sector’s combat rules. {obsidian ? 'Patrols keep their normal rewards.' : 'Patrols and the Anbu keep their own rewards and event credit.'}</p>
            </aside></StrongholdDialog>}
        </div>
        <footer className="stronghold-footer"><div className="stronghold-guidance"><span className={!admissionError && !actionError && !error && !admissionPending && pending !== 'attack' && !state?.combatBlocked && !overview ? 'stronghold-control-help' : undefined} role={admissionError || actionError ? 'alert' : 'status'}>{admissionError || actionError || error || (admissionPending ? 'Connecting to the Anbu fight… Closing the dialog does not cancel the challenge.' : pending === 'attack' ? 'Connecting to battle…' : state?.combatBlocked ? 'Resolve your PvP fight, then return to face the patrol.' : overview ? 'Map overview · Return to follow view to move.' : 'Tap a floor tile or use the on-screen arrows. Keyboard: WASD/arrow keys. Controller: left stick moves; D-pad navigates.')}</span>
            {onRetryAdmission && <button onClick={onRetryAdmission}>Reconnect to challenge</button>}
            {(error || actionError) && state && <button disabled={!!pending || admissionPending} onClick={reconnectPresence}>Reconnect</button>}
            <button className="stronghold-players-toggle" onClick={() => { stopWalk(); setPlayersOpen(true); }}>Players <b>{peers.length + (state ? 1 : 0)}</b></button>
            </div>
            <div className="stronghold-dpad" aria-label="Movement controls">{([['↑', 0, -1, 'Move up'], ['←', -1, 0, 'Move left'], ['↓', 0, 1, 'Move down'], ['→', 1, 0, 'Move right']] as const).map(([label, dx, dy, name]) => <button key={name} aria-label={name} disabled={movementBlocked || overview || !state || threat >= 100} onClick={() => direction(dx, dy)}>{label}</button>)}</div>
        </footer>
        {playersOpen && <StrongholdDialog title="Shinobi in the stronghold" onClose={() => setPlayersOpen(false)}>{playerList}</StrongholdDialog>}
        {selectedPeer && <StrongholdDialog title={selectedPeer.name} busy={!!pending} onClose={() => setSelectedPeer(null)}>
            <p>Level {selectedPeer.level} · {selectedPeer.village}</p>
            <p>{selectedEngagement?.kind === 'contest' ? `Challenge this shinobi to a ${sectorContestLabel(selectedEngagement.winCondition)}. The result counts toward the active sector war.` : 'Challenge this shinobi to a sector battle. Your current health and supplies carry into the fight.'}</p>
            {obsidian && <p className="stronghold-reward-detail"><b>4× normal rewards on a PvP win.</b> Both fighters must be inside when the battle starts. Ryo, stat growth and XP for jutsu you cast receive the bonus; normal limits and repeat-opponent reductions apply.</p>}
            <div className="stronghold-dialog-actions"><button className="stronghold-attack" disabled={blocked || !!pending || threat >= 100 || !availablePeers.some(p => p.name === selectedPeer.name)} onClick={() => void attack(selectedPeer)}>{pending === 'attack' ? 'Connecting…' : 'Attack player'}</button><button onClick={() => setSelectedPeer(null)}>Cancel</button></div>
        </StrongholdDialog>}
    </section>;

    async function claimIntel() {
        const context = lifetime.current;
        if (!context || busy.current || !current.current || current.current.tile !== STRONGHOLD_INTEL_TILE) return;
        busy.current = true;
        setIntelPending(true);
        setActionError('');
        try {
            const next = await strongholdRequest(character.name, sector, 'intel', { presenceId: context.presenceId });
            adopt(next, context);
        } catch (e) {
            if (alive.current && context === lifetime.current) setActionError((e as Error).message || 'The patrol ledger could not be read.');
        } finally {
            if (context === lifetime.current) busy.current = false;
            setIntelPending(false);
        }
    }
}
