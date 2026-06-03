/**
 * Pure anti-grief gating predicates over an online-player record.
 *
 * Extracted so the attack/challenge rules live in ONE tested place and can't
 * drift between handlers as presence moves from the DB into the in-memory
 * store. These are intentionally pure (no I/O) — the handler does the
 * `onlineStore.get(name)` and passes the result here.
 *
 * Behavior is identical to the previous DB-backed checks in attack.ts /
 * challenge.ts / heal.ts. A `null` target means "not online".
 */
import type { OnlinePlayer } from './types.js';

export type AttackBlock = { status: 404 | 409; error: string };

/**
 * Why an attack on `target` must be rejected, or null if it may proceed.
 * Mirrors attack.ts exactly: offline → 404; traveling / already-queued /
 * in-battle → 409.
 */
export function attackBlock(target: OnlinePlayer | null, now: number = Date.now()): AttackBlock | null {
    if (!target) return { status: 404, error: 'Target not online.' };
    if (target.travelingUntil && target.travelingUntil > now) {
        return { status: 409, error: 'Target is traveling and cannot be attacked.' };
    }
    if (target.pendingAttacker) return { status: 409, error: 'Target is already engaged in combat.' };
    if (target.inBattle) return { status: 409, error: 'Target is already in a battle.' };
    return null;
}

/**
 * Why a NEW challenge to `target` must be rejected, or null if it may proceed.
 * Mirrors challenge.ts: an OFFLINE target is NOT blocked (the challenge is
 * queued for later); only an online target's travel/battle/engaged state gates.
 * All challenge blocks are HTTP 409.
 */
export function challengeBlock(target: OnlinePlayer | null, now: number = Date.now()): string | null {
    if (!target) return null;
    if (target.travelingUntil && target.travelingUntil > now) return 'Target is traveling.';
    if (target.inBattle) return 'Target is already in a battle.';
    if (target.pendingAttacker) return 'Target is already engaged in combat.';
    return null;
}
