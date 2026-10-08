import layoutUrl from '../../../shared/continuous-world-layout.json?url';
import { buildWorldNavigation, worldGraphVersion } from '../../../shared/continuous-world-navigation';
import { createWorldPositionModel, type WorldPosition } from '../../../shared/world-position';
import type { ContinuousWorldSpace } from '../../../shared/continuous-world-space';
import type { PlayerRecord } from '../types/character';

export type WorldMovementReply = { ok: boolean; reason?: string; sector?: number; tile?: number; sequence?: number; worldPosition?: WorldPosition | null; players?: PlayerRecord[] };
let loaded: Promise<Awaited<ReturnType<typeof readLayout>>> | undefined;
async function readLayout() {
    const response = await fetch(layoutUrl);
    if (!response.ok) throw new Error('World layout unavailable');
    const raw = await response.json() as ContinuousWorldSpace & { layoutVersion: string };
    const space = { ...raw, layoutVersion: worldGraphVersion(raw.layoutVersion) };
    const navigation = buildWorldNavigation(space), nodes = new Map(navigation.nodes.map(n => [n.id, n]));
    return { space, nodes, navigation, model: createWorldPositionModel(space.layoutVersion, nodes, space.roads) };
}
export function loadContinuousWorld() {
    loaded ??= readLayout().catch(error => { loaded = undefined; throw error; });
    return loaded;
}
export async function worldMovementRequest(position?: WorldPosition, expectedSequence?: number, signal?: AbortSignal): Promise<WorldMovementReply> {
    if (position) {
        const socket = await import('./presence-socket');
        const request = socket.requestRealtime('world:move', { worldPosition: position, expectedSequence });
        if (request) { try { return await request as WorldMovementReply; } catch { /* Reconcile through HTTP if the acknowledgement was lost. */ } }
    }
    const response = await fetch('/api/player/world-move', { method: position ? 'POST' : 'GET', signal,
        ...(position ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worldPosition: position, expectedSequence }) } : {}) });
    return await response.json() as WorldMovementReply;
}
