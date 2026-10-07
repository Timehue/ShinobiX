import { createWorldWalker } from '../../../shared/continuous-world-navigation';
import { worldDistance, type WorldPoint } from '../../../shared/continuous-world-space';
import { nearestWalkableTile } from '../../../shared/sector-walk-mask';
import { createContinuousWorldRenderer } from './continuous-world-renderer';
import { loadContinuousWorld, worldMovementRequest, type WorldMovementReply } from './continuous-world-client';
import { bindContinuousWorldControl } from './continuous-world-control';
import { isRealtimePresenceLive } from './use-presence-socket';

type Host = { canvas: HTMLCanvasElement; chunk: HTMLDivElement; marker: HTMLDivElement;
    onPosition?: (sector: number, col: number, row: number) => void;
    blocked: () => boolean; onAuthority: (sector: number, tile: number) => void; onStatus: (status: string) => void; signal: AbortSignal };
const directions: Record<string, WorldPoint> = { w:{x:0,y:-1}, a:{x:-1,y:0}, s:{x:0,y:1}, d:{x:1,y:0}, arrowup:{x:0,y:-1}, arrowleft:{x:-1,y:0}, arrowdown:{x:0,y:1}, arrowright:{x:1,y:0} };
export async function mountContinuousWorld(host: Host) {
    const [world, initial] = await Promise.all([loadContinuousWorld(), worldMovementRequest(undefined, undefined, host.signal)]);
    const initialPosition = world.model.read(initial.worldPosition);
    if (!initial.ok || !initialPosition) throw new Error('World presence is not ready. Try again.');
    const walker = createWorldWalker(world.nodes, initialPosition.from);
    walker.restore(initialPosition);
    const renderer = createContinuousWorldRenderer(host.canvas, world.space);
    let sequence = initial.sequence ?? 0, sector = initial.sector!, tile = initial.tile!;
    let held: WorldPoint | null = null, frame = 0, last = 0, lastSend = 0, movingTime = 0, acknowledgedTime = 0;
    let inFlight = false, disposed = false, sentCursor = '', resyncing = false, drag: { x: number; y: number; moved: boolean } | null = null;
    let requestedSector = sector, retryAfter = 0;
    function accept(reply: WorldMovementReply, sampleTime: number) {
        const cursor = world.model.read(reply.worldPosition);
        if (!cursor || reply.sequence === undefined || reply.sector === undefined || reply.tile === undefined) return false;
        sequence = reply.sequence; sector = reply.sector; tile = reply.tile;
        if (reply.ok) acknowledgedTime = sampleTime;
        else { walker.stop(); walker.restore(cursor); movingTime = acknowledgedTime = 0; held = null; }
        host.onAuthority(sector, tile); return true;
    }
    async function send(force = false) {
        if (inFlight || resyncing || disposed || host.signal.aborted) return false;
        const cursor = walker.cursor(world.space.layoutVersion), signature = JSON.stringify(cursor);
        if (!force && signature === sentCursor) return true;
        inFlight = true; const sampleTime = movingTime, sentSector = sector;
        try {
            const reply = await worldMovementRequest(cursor, sequence, host.signal);
            if (disposed) return false;
            if (accept(reply, sampleTime)) { if (requestedSector === sentSector) requestedSector = sector; sentCursor = reply.ok ? signature : ''; host.onStatus(reply.ok ? '' : 'Movement paused. Choose a new destination.'); return true; }
            return false;
        } catch { if (!disposed) { walker.stop(); held = null; host.onStatus('Connection interrupted. Movement paused.'); } }
        finally { inFlight = false; }
    }
    // Adopt a stationary cursor first; this starts the server clock before prediction.
    if (!await send(true)) { renderer.dispose(); throw new Error('World presence is not ready. Try again.'); }
    if (host.signal.aborted) { renderer.dispose(); throw new DOMException('Aborted', 'AbortError'); }
    const go = (targetSector: number, targetTile: number) => {
        if (host.blocked()) return;
        held = null; walker.go(`${targetSector}:${nearestWalkableTile(targetSector, targetTile)}`);
    };
    const unbind = bindContinuousWorldControl(destination => go(destination.sector, destination.tile));
    function keydown(event: KeyboardEvent) {
        const target = event.target as HTMLElement, key = event.key.toLowerCase();
        if (host.blocked() || target.closest('input,textarea,select,[contenteditable],[data-sector-hud],[role=dialog]')) return;
        if (key.startsWith('arrow') && target.closest('button,a,[role=button],[tabindex]:not(canvas):not([tabindex="-1"])')) return;
        if (key === 'e' || key === 'escape') { held = null; walker.stop(); return; }
        const direction = directions[key]; if (!direction) return;
        event.preventDefault(); event.stopImmediatePropagation();
        held = direction; if (!event.repeat) walker.stop();
    }
    const keyup = (event: KeyboardEvent) => { if (directions[event.key.toLowerCase()]) held = null; };
    const blur = () => { held = null; walker.stop(); };
    const pointerdown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY, moved: false }; host.canvas.setPointerCapture(event.pointerId); };
    const pointermove = (event: PointerEvent) => {
        if (!drag || host.blocked()) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) < 10) return;
        if (!drag.moved) walker.stop(); drag.moved = true;
        held = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    };
    const pointerup = (event: PointerEvent) => {
        if (!drag) return;
        if (!drag.moved && !host.blocked()) {
            const rect = host.canvas.getBoundingClientRect(), scale = rect.width / 12;
            const point = { x: walker.position.x + (event.clientX - rect.left - rect.width / 2) / scale,
                y: walker.position.y + (event.clientY - rect.top - rect.height / 2) / scale };
            const candidates = [...world.nodes.values()].map(node => ({ node, distance: worldDistance(node, point) }))
                .filter(item => item.distance < 2).sort((a, b) => a.distance - b.distance);
            const cursor = walker.cursor(world.space.layoutVersion);
            const closest = candidates.find(({ node }) => world.model.distanceWithin(cursor,
                { layoutVersion: cursor.layoutVersion, from: node.id, to: node.id, progress: 0 }, 32) !== null);
            if (closest) walker.go(closest.node.id);
        }
        drag = null; held = null;
    };
    const pointercancel = () => { drag = null; held = null; };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    host.canvas.addEventListener('pointerdown', pointerdown); host.canvas.addEventListener('pointermove', pointermove);
    host.canvas.addEventListener('pointerup', pointerup); host.canvas.addEventListener('pointercancel', pointercancel);
    async function resync() {
        if (requestedSector === sector || inFlight || resyncing || disposed || host.blocked()) return;
        resyncing = true; walker.stop(); held = null;
        try {
            const reply = await worldMovementRequest(undefined, undefined, host.signal), cursor = world.model.read(reply.worldPosition);
            if (reply.ok && cursor && !disposed) {
                walker.restore(cursor); sequence = reply.sequence ?? 0; sector = reply.sector!; tile = reply.tile!;
                requestedSector = sector; movingTime = acknowledgedTime = 0; sentCursor = ''; host.onAuthority(sector, tile); host.onStatus('');
            } else retryAfter = performance.now() + 1000;
        } catch { if (!disposed) { retryAfter = performance.now() + 1000; host.onStatus('Connection interrupted. Movement paused.'); } }
        finally { resyncing = false; }
    }
    function tick(now: number) {
        const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
        if (requestedSector !== sector && now >= retryAfter) void resync();
        const blocked = host.blocked() || document.hidden || requestedSector !== sector;
        if (blocked) { held = null; walker.stop(); }
        if (held && !walker.moving && !blocked) {
            let best = '', score = .35;
            for (const id of walker.node.neighbors) {
                const n = world.nodes.get(id)!, distance = worldDistance(walker.node, n);
                const rank = ((n.x - walker.node.x) * held.x + (n.y - walker.node.y) * held.y) / distance;
                if (rank > score) { score = rank; best = id; }
            }
            if (best) walker.go(best);
        }
        walker.pause(blocked || resyncing || movingTime - acknowledgedTime > 1.4 / 6.5);
        const before = walker.travelled; walker.tick(dt);
        movingTime += (walker.travelled - before) / 6.5;
        if (!blocked && now - lastSend > (isRealtimePresenceLive() ? 100 : 250)) { lastSend = now; void send(); }
        const view = renderer.draw(walker.position, sector), size = view.tilePx * 12;
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
    return { go, externalSector(nextSector: number) { requestedSector = nextSector; void resync(); }, dispose() {
        disposed = true; walker.stop(); cancelAnimationFrame(frame); unbind(); renderer.dispose();
        window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
        host.canvas.removeEventListener('pointerdown', pointerdown); host.canvas.removeEventListener('pointermove', pointermove);
        host.canvas.removeEventListener('pointerup', pointerup); host.canvas.removeEventListener('pointercancel', pointercancel);
    } };
}
