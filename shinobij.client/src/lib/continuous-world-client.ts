import layoutUrl from '../../../shared/continuous-world-layout.json?url';
import { buildWorldNavigationInSlices, worldGraphVersion } from '../../../shared/continuous-world-navigation';
import { createWorldPositionModel, type WorldPosition } from '../../../shared/world-position';
import type { VersionedWorldSpace } from '../../../shared/continuous-world-space';
import type { PlayerRecord } from '../types/character';
import type { WorldRunAction, WorldRunWindow } from '../../../shared/world-run';

export type WorldMovementReply = { ok: boolean; reason?: string; error?: string; sector?: number; tile?: number; sequence?: number; worldPosition?: WorldPosition | null; players?: PlayerRecord[]; run?: WorldRunWindow };
let loaded: Promise<Awaited<ReturnType<typeof readLayout>>> | undefined;
/** A fresh task: unlike setTimeout(0), a channel message is not clamped to 4 ms once nested. */
const nextTask = () => new Promise<void>(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
});
async function readLayout() {
    const response = await fetch(layoutUrl);
    if (!response.ok) throw new Error('World layout unavailable');
    const raw = await response.json() as VersionedWorldSpace;
    const space = { ...raw, layoutVersion: worldGraphVersion(raw.layoutVersion) };
    return prepareSpace(space);
}
async function prepareSpace(space: VersionedWorldSpace) {
    // About 33k walkable cells: built in short slices so a phone keeps painting meanwhile.
    const navigation = await buildWorldNavigationInSlices(space, nextTask), nodes = navigation.byId;
    return { space, nodes, navigation, model: createWorldPositionModel(space.layoutVersion, nodes, space.roads, space.chunks) };
}
const planes = new WeakMap<VersionedWorldSpace, ReturnType<typeof prepareSpace>>();
export function loadContinuousWorld(space?: VersionedWorldSpace) {
    if (space) {
        const world = planes.get(space) ?? prepareSpace(space).catch(error => { planes.delete(space); throw error; });
        planes.set(space, world);
        return world;
    }
    loaded ??= readLayout().catch(error => { loaded = undefined; throw error; });
    return loaded;
}
export async function worldMovementRequest(position?: WorldPosition, expectedSequence?: number, signal?: AbortSignal,
    gaitPresentation?: PlayerRecord['gaitPresentation']): Promise<WorldMovementReply> {
    const payload = { worldPosition: position, expectedSequence, gaitPresentation };
    if (position) {
        const socket = await import('./presence-socket');
        const request = socket.requestRealtime('world:move', payload);
        if (request) { try { return await request as WorldMovementReply; } catch { /* Reconcile through HTTP if the acknowledgement was lost. */ } }
    }
    const response = await fetch('/api/player/world-move', { method: position ? 'POST' : 'GET', signal,
        ...(position ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    return await response.json() as WorldMovementReply;
}

export async function worldRunRequest(action: WorldRunAction, signal: AbortSignal): Promise<{ ok: boolean; run?: WorldRunWindow }> {
    const response = await fetch('/api/player/world-move', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    });
    return await response.json();
}
