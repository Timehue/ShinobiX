import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import type { WorldPosition } from '../../shared/world-position.js';
import type { OnlinePlayer } from './types.js';

export const WORLD_WALK_SPEED = 6.5;
export const WORLD_WALK_MAX_CREDIT = 2;
export type WorldMoveResult = { ok: true; position: WorldPosition; sector: number; tile: number; distance: number }
    | { ok: false; reason: 'locked' | 'sequence' | 'position' | 'speed' };

/** One shared admission gate for HTTP and socket ingress; elapsed time is server-owned. */
export function createWorldMovementGate() {
    const clocks = new Map<string, { at: number; credit: number }>();
    let requests = 0;
    return {
        clear(name: string) { clocks.delete(name); },
        admit(player: OnlinePlayer, rawPosition: unknown, expectedSequence: unknown, now: number): WorldMoveResult {
            if (++requests % 256 === 0) for (const [name, clock] of clocks) if (now - clock.at > 90_000) clocks.delete(name);
            if (player.locationUnverified || player.inBattle
                || (player.travelingUntil !== undefined && player.travelingUntil > now)) return { ok: false, reason: 'locked' };
            if (!Number.isSafeInteger(expectedSequence) || expectedSequence !== (player.movementSeq ?? 0)) return { ok: false, reason: 'sequence' };
            const model = worldPositionModel(), position = model.read(rawPosition);
            const prior = model.read(player.worldPosition) ?? model.fallback(player.sector, player.tile ?? 78);
            if (!position || !prior || model.location(prior).sector !== player.sector) return { ok: false, reason: 'position' };
            // A missing clock means the player has rested at least since the idle sweep
            // (or just connected), so they hold the same capped credit as any rested
            // walker. A quarter tile here refused the first step after every rest and
            // snapped the player back. The cap still bounds the burst to two tiles.
            const clock = clocks.get(player.name) ?? { at: now, credit: WORLD_WALK_MAX_CREDIT };
            const credit = Math.min(WORLD_WALK_MAX_CREDIT, clock.credit + Math.max(0, now - clock.at) / 1000 * WORLD_WALK_SPEED);
            const distance = model.distanceWithin(prior, position, credit);
            if (distance === null) {
                // An initial rejected packet starts the clock, without granting a fresh burst per retry.
                if (!clocks.has(player.name)) clocks.set(player.name, clock);
                return { ok: false, reason: 'speed' };
            }
            const location = model.location(position);
            if (location.tile === undefined) return { ok: false, reason: 'position' };
            clocks.set(player.name, { at: now, credit: Math.max(0, credit - distance) });
            return { ok: true, position, ...location, tile: location.tile, distance };
        },
    };
}
