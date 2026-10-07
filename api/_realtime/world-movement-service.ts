import { randomUUID } from 'node:crypto';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { sectorExits } from '../../shared/sector-links.js';
import { onlineStore } from './online-store.js';
import { createWorldMovementGate } from './world-movement.js';
import { clearTravelLeaseIfSame, setTravelLease, type TravelLease } from './travel-lease.js';
import { kv } from '../_storage.js';
import { noteWalkedTile } from './walked-tile.js';
import type { OnlinePlayer } from './types.js';
import { pushWorldMovement } from './notify.js';
import { toPlayerRecord } from './presence-input.js';
import { worldDistance } from '../../shared/continuous-world-space.js';

const gate = createWorldMovementGate(), pending = new Set<string>();
export function worldMovementSnapshot(player: OnlinePlayer) {
    return { sector: player.sector, tile: player.tile, sequence: player.movementSeq ?? 0,
        worldPosition: worldPositionModel().read(player.worldPosition) ?? worldPositionModel().fallback(player.sector, player.tile ?? 78) };
}

/** Owner approved nearby presentation. Combat still uses authoritative sectors. */
export function nearbyWorldPlayers(viewer: OnlinePlayer) {
    const model = worldPositionModel(), cursor = worldMovementSnapshot(viewer).worldPosition;
    if (!cursor) return [];
    const origin = model.point(cursor), now = Date.now();
    return onlineStore.list().filter(p => p.name !== viewer.name && (p.travelingUntil ?? 0) <= now).flatMap(player => {
        const position = model.read(player.worldPosition) ?? model.fallback(player.sector, player.tile ?? 78);
        if (!position) return [];
        const distance = worldDistance(origin, model.point(position));
        return distance <= 10 ? [{ player, position, distance }] : [];
    }).sort((a, b) => a.distance - b.distance).slice(0, 24)
        .map(({ player, position }) => ({ ...toPlayerRecord(player), worldPosition: position, movementSequence: player.movementSeq ?? 0 }));
}

/** Both transports use this authority boundary. Only zone changes mint a durable lease. */
export async function applyWorldMovement(name: string, payload: unknown) {
    const player = onlineStore.get(name);
    if (!player) return { ok: false as const, reason: 'offline' };
    if (pending.has(player.name)) return { ok: false as const, reason: 'busy', ...worldMovementSnapshot(player) };
    pending.add(player.name);
    try {
        const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const now = Date.now(), sequence = player.movementSeq ?? 0;
        const admitted = gate.admit(player, body.worldPosition, body.expectedSequence, now);
        if (!admitted.ok) return { ...admitted, ...worldMovementSnapshot(player) };
        const origin = player.sector;
        let moved: OnlinePlayer | null;
        if (admitted.sector !== origin) {
            const exit = sectorExits(origin).find(e => e.destinationSector === admitted.sector);
            if (!exit) return { ok: false as const, reason: 'road', ...worldMovementSnapshot(player) };
            const lease: TravelLease = { originSector: origin, destinationSector: admitted.sector, arrivalAt: now,
                arrivalTile: admitted.tile, worldPosition: admitted.position, moveId: randomUUID().replace(/-/g, '') };
            await setTravelLease(name, lease, now);
            const current = onlineStore.get(name);
            if (!current || current.sector !== origin || (current.movementSeq ?? 0) !== sequence || current.inBattle) {
                await clearTravelLeaseIfSame(name, lease);
                return { ok: false as const, reason: 'superseded', ...(current ? worldMovementSnapshot(current) : {}) };
            }
            const crossed = onlineStore.startTravel(name, admitted.sector, now, origin, admitted.tile, admitted.position);
            if (!crossed) {
                await clearTravelLeaseIfSame(name, lease);
                return { ok: false as const, reason: 'locked', ...worldMovementSnapshot(current) };
            }
            moved = crossed;
        } else {
            moved = onlineStore.commitWorldPosition(name, admitted.position, sequence);
        }
        if (!moved) return { ok: false as const, reason: 'superseded', ...worldMovementSnapshot(onlineStore.get(name) ?? player) };
        void noteWalkedTile(kv, name, moved.sector, moved.tile, now, moved.worldPosition);
        pushWorldMovement(moved.sector, moved.displayName, moved.tile, moved.movementSeq ?? 0, admitted.position);
        return { ok: true as const, ...worldMovementSnapshot(moved), originSector: origin };
    } catch {
        return { ok: false as const, reason: 'unavailable', ...worldMovementSnapshot(onlineStore.get(name) ?? player) };
    } finally { pending.delete(player.name); }
}
