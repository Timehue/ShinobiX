import { createWorldWalker } from '../../../shared/continuous-world-navigation';
import type { WorldPoint } from '../../../shared/continuous-world-space';
import { nearestWalkableTile } from '../../../shared/sector-walk-mask';
import { createContinuousWorldRenderer, worldTilesAcross } from './continuous-world-renderer';
import { loadContinuousWorld, worldMovementRequest, type WorldMovementReply } from './continuous-world-client';
import { bindContinuousWorldControl } from './continuous-world-control';
import { isRealtimePresenceLive } from './use-presence-socket';
import { worldRoadCrossings } from '../../../shared/world-road-crossings';
import { createTapIndex } from './world-tap';
import { createWorldMovePacer } from './world-move-pacing';
import { playerGaitPace, playerGaitTilesPerSecond, type GroundStride } from '../../../shared/sector-model-motion';
import { createGaitBrake } from './world-gait-brake';
import { MOVEMENT_KEYS, heldDirection } from './held-direction';
import type { WorldRunWindow } from '../../../shared/world-run';

type Host = { canvas: HTMLCanvasElement; chunk: HTMLDivElement; marker: HTMLDivElement;
    groundStride?: GroundStride;
    sprintStyle?: () => import('../../../shared/player-model-ref').SprintStyle;
    gait?: () => 'walk' | 'run' | undefined;
    onRunWindow?: (run: WorldRunWindow) => void;
    onFigure?: (x: number, y: number, width: number, moving: boolean, gait?: 'walk' | 'run') => void;
    onPosition?: (sector: number, col: number, row: number) => void;
    /** A tap on painted ground of the current sector; true when a landmark there took it. */
    onTapTile?: (tile: number) => boolean;
    blocked: () => boolean;
    /** A fullscreen interior covers the world: stop drawing and sending until it closes. */
    paused?: () => boolean;
    onAuthority: (sector: number, tile: number) => void; onStatus: (status: string) => void; signal: AbortSignal };
/** The server walks a newer world graph than this tab loaded; only a reload can follow it. */
export const STALE_WORLD_STATUS = 'The world map was updated. Reload to keep exploring.';
const staleReply = (reply: WorldMovementReply, version: string) => Boolean(reply.worldPosition && reply.worldPosition.layoutVersion !== version);
const directions = MOVEMENT_KEYS;
export async function mountContinuousWorld(host: Host) {
    const [world, initial] = await Promise.all([loadContinuousWorld(), worldMovementRequest(undefined, undefined, host.signal)]);
    host.signal.throwIfAborted();
    if (staleReply(initial, world.space.layoutVersion)) throw new Error(STALE_WORLD_STATUS);
    const initialPosition = world.model.read(initial.worldPosition);
    if (!initial.ok || !initialPosition) throw new Error('World presence is not ready. Try again.');
    if (initial.run) host.onRunWindow?.(initial.run);
    const walker = createWorldWalker(world.nodes, initialPosition.from);
    walker.restore(initialPosition);
    const renderer = createContinuousWorldRenderer(host.canvas, world.space, world.navigation);
    const crossings = worldRoadCrossings(world.space.roads);
    // Built at the first tap, so a tap measures only the nodes near it, not the whole world.
    let tapIndex: ReturnType<typeof createTapIndex> | null = null;
    let sequence = initial.sequence ?? 0, sector = initial.sector!, tile = initial.tile!;
    let held: WorldPoint | null = null, frame = 0, last = 0, lastSend = 0;
    const scene = host.canvas.parentElement;
    let slowFrames = 0;
    let releaseDirection: WorldPoint | null = null, fittedActive = false;
    let playingGait: 'walk' | 'run' | undefined;
    let fittedHeading: WorldPoint | null = null;
    let lastSpeed = 0;
    // Every movement key still down, oldest first. Releasing the newest key
    // returns to the one under it instead of stopping (hold W, tap D, keep W).
    const heldKeys: string[] = [];
    const forgetKey = (key: string) => { const at = heldKeys.indexOf(key); if (at >= 0) heldKeys.splice(at, 1); };
    let brake: ReturnType<typeof createGaitBrake> | null = null;
    let inFlight = false, disposed = false, stale = false, sentCursor = '', resyncing = false, drag: { x: number; y: number; moved: boolean } | null = null;
    let requestedSector = sector, retryAfter = 0, refusedInRow = 0, resumed = false;
    let pendingDestination: string | null = null;
    let startupThrottled = false;
    const pace = createWorldMovePacer(6.5);
    const resumable = (reply: WorldMovementReply) => refusedInRow === 1 && (reply.reason === 'speed' || reply.reason === 'busy');
    function accept(reply: WorldMovementReply) {
        if (staleReply(reply, world.space.layoutVersion)) { stale = true; walker.stop(); held = null; host.onStatus(STALE_WORLD_STATUS); return false; }
        const cursor = world.model.read(reply.worldPosition);
        if (!cursor || reply.sequence === undefined || reply.sector === undefined || reply.tile === undefined) return false;
        sequence = reply.sequence; sector = reply.sector; tile = reply.tile;
        refusedInRow = reply.ok ? 0 : refusedInRow + 1;
        if (!reply.ok) {
            // A refused step puts the walker back on the server's cursor. A pace refusal
            // (network jitter ate the speed budget, or a step was still settling) clears on
            // the next update, so the walk goes on from there instead of dropping the
            // destination. Anything else (a fight, a lock, a stale sequence), or a second
            // refusal in a row, stops it.
            if (!resumable(reply)) { walker.stop(); held = null; }
            walker.restore(cursor); pace.reset();
        }
        host.onAuthority(sector, tile); return true;
    }
    async function send(force = false, gait = host.gait?.()) {
        if (inFlight || resyncing || disposed || stale || host.signal.aborted) return false;
        const cursor = walker.cursor(world.space.layoutVersion);
        if (!force && !pace.retrying && JSON.stringify(cursor) === sentCursor) return true;
        inFlight = true; const update = pace.next(cursor, performance.now() / 1000), signature = JSON.stringify(update.cursor), sentSector = sector;
        try {
            const presentation = gait ? { gait, style: host.sprintStyle?.() ?? 'A' } : undefined;
            const reply = await worldMovementRequest(update.cursor, sequence, host.signal, presentation);
            if (disposed || host.signal.aborted) return false;
            startupThrottled = reply.reason === 'throttled';
            if (accept(reply)) { if (reply.ok) pace.accepted(update, performance.now() / 1000); if (requestedSector === sentSector) requestedSector = sector; sentCursor = reply.ok ? signature : ''; host.onStatus(reply.ok || resumable(reply) ? '' : 'Movement paused. Choose a new destination.'); return true; }
            if (!stale) pace.dropped(update);
            return false;
        } catch { if (!disposed) { pace.dropped(update); walker.stop(); held = null; host.onStatus('Connection interrupted. Movement paused.'); } }
        finally { inFlight = false; }
    }
    // Adopt a stationary cursor first; this starts the server clock before prediction.
    let adopted = await send(true);
    // A remount can land inside the previous controller's socket throttle window.
    // Retry only that transient refusal, once, after its 80 ms admission window.
    if (!adopted && startupThrottled && !host.signal.aborted) {
        await new Promise<void>(resolve => {
            const timer = setTimeout(done, 125);
            function done() { clearTimeout(timer); host.signal.removeEventListener('abort', done); resolve(); }
            host.signal.addEventListener('abort', done, { once: true });
        });
        adopted = await send(true);
    }
    if (!adopted) { renderer.dispose(); throw new Error('World presence is not ready. Try again.'); }
    if (host.signal.aborted) { renderer.dispose(); throw new DOMException('Aborted', 'AbortError'); }
    const chooseDestination = (destination: string) => {
        if (host.blocked()) return;
        held = null; brake = null;
        // Closing a modal refreshes authority. Keep an input received during
        // that refresh instead of letting it discard the chosen route.
        if (resumed || resyncing || requestedSector !== sector) { pendingDestination = destination; return; }
        pendingDestination = null; walker.go(destination);
    };
    const go = (targetSector: number, targetTile: number) => chooseDestination(`${targetSector}:${nearestWalkableTile(targetSector, targetTile)}`);
    const unbind = bindContinuousWorldControl(destination => go(destination.sector, destination.tile));
    function steer(direction: WorldPoint, replace: boolean) {
        const gait=host.gait?.();
        // Only a reversal brakes to a stop and restarts. A 90-degree turn keeps the
        // stride: the walker finishes the tile it is on (walker.step re-routes to
        // that segment's end) and the figure changes facing on the same foot phase.
        const along = fittedHeading ? fittedHeading.x*direction.x+fittedHeading.y*direction.y : 0;
        if (fittedHeading && gait && !brake && along < -.5) {
            releaseDirection=fittedHeading;
            brake=createGaitBrake(lastSpeed,gait,playerGaitPace[gait]);
        } else if (brake && fittedActive && along > .9) {
            // Back to the heading still being travelled (a reverse tap let go, or a
            // key re-pressed while braking): carry on instead of stopping first.
            brake=null; releaseDirection=null;
        } else if (!fittedActive || !brake) {
            brake=null;
            if (replace) walker.stop();
        }
        held=direction; pendingDestination=null;
    }
    function keydown(event: KeyboardEvent) {
        const target = event.target as HTMLElement, key = event.key.toLowerCase();
        if (host.blocked() || target.closest('input,textarea,select,[contenteditable],[data-sector-hud],[role=dialog]')) return;
        if (key.startsWith('arrow') && target.closest('button,a,[role=button],[tabindex]:not(canvas):not([tabindex="-1"])')) return;
        if (key === 'e' || key === 'escape') { heldKeys.length = 0; held = null; brake = null; pendingDestination = null; walker.stop(); return; }
        const direction = directions[key]; if (!direction) return;
        // Cmd+D, Ctrl+Arrow and the like are shortcuts, not steps. macOS also sends
        // no keyup for a key let go while Cmd is down, so it would stay "held".
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault(); event.stopImmediatePropagation();
        forgetKey(key); heldKeys.push(key);
        if (!event.repeat || !held) steer(heldDirection(heldKeys)!,true);
    }
    function releaseHeld() {
        if (!held) return;
        const gait = host.gait?.();
        if (!brake && gait && (walker.moving || fittedActive)) {
            releaseDirection = held;
            brake = createGaitBrake(lastSpeed, gait, playerGaitPace[gait]);
        }
        held = null;
    }
    const keyup = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        // Any key released during the modifier may never report its keyup (macOS
        // Cmd), so nothing in the stack can be trusted afterwards: stop cleanly.
        if (key === 'meta' || key === 'control' || key === 'alt') { heldKeys.length = 0; releaseHeld(); return; }
        if (!directions[key]) return;
        forgetKey(key);
        // Letting go of either key of a diagonal straightens it; of the last key, stops.
        const next = heldDirection(heldKeys);
        if (!next || !held || host.blocked()) { if (!next) releaseHeld(); return; }
        if (next.x !== held.x || next.y !== held.y) steer(next, true);
    };
    const blur = () => { heldKeys.length = 0; held = null; brake = null; pendingDestination = null; walker.stop(); };
    const pointerdown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY, moved: false }; host.canvas.setPointerCapture(event.pointerId); };
    const pointermove = (event: PointerEvent) => {
        if (!drag || host.blocked()) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) < 10) return;
        // Snap the drag to the nearest of eight headings, so a drag can walk diagonally too.
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        if (!drag.moved || held?.x!==direction.x || held?.y!==direction.y) steer(direction,!drag.moved);
        heldKeys.length=0; drag.moved=true;
    };
    const pointerup = (event: PointerEvent) => {
        if (!drag) return;
        if (!drag.moved && !host.blocked()) {
            const rect = host.canvas.getBoundingClientRect(), scale = rect.width / worldTilesAcross(rect.width);
            const point = { x: walker.position.x + (event.clientX - rect.left - rect.width / 2) / scale,
                y: walker.position.y + (event.clientY - rect.top - rect.height / 2) / scale };
            const chunk = renderer.chunks.get(sector)!, col = Math.floor(point.x - chunk.x), row = Math.floor(point.y - chunk.y);
            if (col >= 0 && col < 12 && row >= 0 && row < 12 && host.onTapTile?.(row * 12 + col)) { drag = null; held = null; return; }
            const candidates = (tapIndex ??= createTapIndex(world.nodes.values()))(point, crossings);
            const cursor = walker.cursor(world.space.layoutVersion);
            const closest = candidates.find(({ node }) => world.model.distanceWithin(cursor,
                { layoutVersion: cursor.layoutVersion, from: node.id, to: node.id, progress: 0 }, 32) !== null);
            if (closest) chooseDestination(closest.node.id);
        }
        if (drag.moved) releaseHeld();
        drag = null;
    };
    const pointercancel = () => { if (drag?.moved) releaseHeld(); drag = null; };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    host.canvas.addEventListener('pointerdown', pointerdown); host.canvas.addEventListener('pointermove', pointermove);
    host.canvas.addEventListener('pointerup', pointerup); host.canvas.addEventListener('pointercancel', pointercancel);
    /** `force` re-reads the server position in the same sector: the world may have moved this player while paused.
     *  A failed re-read keeps `resumed` set, so the tick retries it after `retryAfter`. */
    async function resync(force = false) {
        if ((!force && requestedSector === sector) || inFlight || resyncing || disposed || host.blocked()) return;
        resyncing = true; walker.stop(); held = null;
        try {
            const reply = await worldMovementRequest(undefined, undefined, host.signal), cursor = world.model.read(reply.worldPosition);
            if (staleReply(reply, world.space.layoutVersion)) { stale = true; resumed = false; host.onStatus(STALE_WORLD_STATUS); }
            else if (reply.ok && cursor && !disposed) {
                if (reply.run) host.onRunWindow?.(reply.run);
                walker.restore(cursor); sequence = reply.sequence ?? 0; sector = reply.sector!; tile = reply.tile!; resumed = false;
                requestedSector = sector; pace.reset(); sentCursor = ''; host.onAuthority(sector, tile); host.onStatus('');
                const destination = pendingDestination; pendingDestination = null;
                if (destination && !host.blocked()) walker.go(destination);
            } else retryAfter = performance.now() + 1000;
        } catch { if (!disposed) { retryAfter = performance.now() + 1000; host.onStatus('Connection interrupted. Movement paused.'); } }
        finally { resyncing = false; }
    }
    function tick(now: number) {
        // A fullscreen interior covers the world: draw and send nothing, but keep
        // the renderer and its decoded maps, so leaving costs one position read
        // (the forced resync below), not a reconnect and a rebuilt renderer.
        if (host.paused?.()) { last = 0; resumed = true; frame = requestAnimationFrame(tick); return; }
        const gait = host.gait?.();
        // Measure this view on the player's device. A single image decode or a
        // background-tab pause shouldn't change the presentation for the visit.
        if (slowFrames < 5) {
            const intervalMs = now-last;
            slowFrames = last && !document.hidden && intervalMs > 80 && intervalMs < 750 ? slowFrames+1 : 0;
            if (slowFrames === 5) scene?.classList.add('world-light-effects');
        }
        // A lower travel rate can safely integrate a longer phone frame. The walker
        // still bounds distance per update and discards long background pauses.
        const dt = Math.min(gait ? .5 : .05, (now - (last || now)) / 1000); last = now;
        if ((resumed || requestedSector !== sector) && now >= retryAfter) void resync(resumed);
        // Each update must cover less ground than WORLD_UPDATE_TILES, or walking
        // waits between replies even on a fast connection (125 ms = 0.8 tile). The
        // socket drops a world:move that lands within 80 ms of the last one, and
        // phone uplink jitter bunched 100 ms sends under it; 150 ms keeps most clear.
        const interval = isRealtimePresenceLive() ? 150 : 125;
        // host.blocked() scans the whole document for an open modal. Standing idle
        // with no key held and no send due, nothing below acts on `blocked`, so the
        // scan runs only when it can matter (~7/s idle instead of every frame).
        const due = now - lastSend > interval;
        const blocked = stale || document.hidden || requestedSector !== sector
            || ((held !== null || walker.moving || due) && host.blocked());
        if (blocked) { held = null; brake = null; walker.stop(); }
        walker.pause(blocked || resyncing);
        // The fitted sheets are authored at 1080 pixels for a 12-tile sector.
        // Express their ground speed in walker seconds before applying the network allowance.
        const strideRate = gait ? playerGaitTilesPerSecond[gait] / 6.5 : 1;
        const before = walker.travelled;
        const figureGait = brake?.gait ?? gait;
        // A slow foreground frame can span several foot contacts or graph segments.
        // Advance in walker-sized steps against one network allowance and paint once.
        const steps = Math.max(1,Math.ceil(dt/.05));
        const slice = dt/steps;
        for (let step=0; step<steps; step++) {
            // Players play their clips faster than authored, at the pace of the clip
            // on screen: a run still changing down to a walk keeps the run's pace.
            // The network allowance can still shorten a step; the fit then trims the
            // clip clock to the ground admitted, so the feet stay planted.
            const clipGait = playingGait ?? figureGait;
            const clipRate = clipGait ? playerGaitPace[clipGait] : 1;
            const direction = brake && fittedActive ? releaseDirection : held;
            if (direction && !walker.moving && !blocked && !resyncing) walker.step(direction,!!gait);
            const budget = Math.max(0, Math.min(slice * pace.rate(interval / 1000), pace.room));
            const road = gait && !resyncing && !blocked ? walker.nextSegment() : null;
            // A pivot steps back up to half a tile to turn at the node just left. The
            // figure faces the turn's heading for that step instead of about-facing.
            const turn = road && walker.pivot;
            const segment = road && turn ? { dx: turn.x, dy: turn.y, distance: road.distance } : road;
            const fitted = gait && host.groundStride?.(segment, segment && !brake ? gait : null, slice * clipRate,
                Math.min((segment?.distance ?? 0)*90,budget*585),
                brake && held ? {dx:held.x,dy:held.y} : undefined);
            fittedActive = Boolean(fitted && !fitted.idle);
            playingGait = fittedActive && fitted ? fitted.gait : undefined;
            const travelTime = fitted ? fitted.distance/585 : brake ? brake.advance(slice)/585 : slice*strideRate;
            const start = walker.travelled;
            walker.tick(Math.min(travelTime,budget));
            // The next segment can be empty between road nodes, and a network
            // allowance can hold the actor still for a frame mid-stride.
            if (!fittedActive) fittedHeading=null;
            else if (segment && walker.travelled>start) fittedHeading={x:segment.dx,y:segment.dy};
            pace.advance((walker.travelled-start)/6.5);
            if (brake && (fitted ? fitted.idle : brake.done)) {
                brake = null; walker.stop(); break;
            }
        }
        lastSpeed = dt > 0 ? (walker.travelled - before) * 90 / dt : 0;
        if (!blocked && due) { lastSend = now; void send(false, figureGait); }
        const view = renderer.draw(walker.position, sector), size = view.tilePx * 12;
        host.onFigure?.(walker.position.x * view.tilePx, walker.position.y * view.tilePx, size, walker.travelled > before, figureGait);
        host.onPosition?.(sector, walker.position.x - view.chunk.x - .5, walker.position.y - view.chunk.y - .5);
        host.chunk.style.width = host.chunk.style.height = `${size}px`;
        host.chunk.style.setProperty('--world-tile-px', `${view.tilePx}px`);
        host.chunk.style.transform = `translate3d(${view.x}px,${view.y}px,0)`;
        host.marker.style.setProperty('--world-tile-px', `${view.tilePx}px`);
        const under = view.crossings.some(c => walker.node.road === c.under && Math.abs(walker.position.x - c.x) < .7 && Math.abs(walker.position.y - c.y) < .7);
        host.marker.style.opacity = under ? '.25' : '1';
        host.marker.classList.toggle('is-walking', walker.moving && !blocked);
        host.canvas.dataset.worldX = String(walker.position.x); host.canvas.dataset.worldY = String(walker.position.y);
        host.canvas.dataset.worldSector = String(sector); host.canvas.dataset.decodedMaps = String(renderer.imageCount);
        frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return { go, externalSector(nextSector: number) { requestedSector = nextSector; pendingDestination = null; void resync(); }, dispose() {
        disposed = true; walker.stop(); cancelAnimationFrame(frame); unbind(); renderer.dispose();
        scene?.classList.remove('world-light-effects');
        window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
        host.canvas.removeEventListener('pointerdown', pointerdown); host.canvas.removeEventListener('pointermove', pointermove);
        host.canvas.removeEventListener('pointerup', pointerup); host.canvas.removeEventListener('pointercancel', pointercancel);
    } };
}
