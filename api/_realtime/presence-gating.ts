/**
 * Pure anti-grief gating predicates over an online-player record.
 *
 * Extracted so the attack/challenge rules live in ONE tested place and can't
 * drift between handlers as presence moves from the DB into the in-memory
 * store. These are intentionally pure (no I/O) — the handler does the
 * `onlineStore.get(name)` and passes the result here.
 *
 * Behavior matches the previous DB-backed checks in attack.ts / challenge.ts,
 * including the Academy-Student protection (sub-Genin players can't be
 * attacked/challenged). A `null` target means "not online".
 */
import type { OnlinePlayer } from './types.js';

export type Block = { status: 403 | 404 | 409; error: string };

// Shinobi below this level are under "Academy protection" — they can't be
// attacked or challenged, so brand-new players aren't farmed before they learn
// the game. Level 0/unknown is NOT protected (a missing field can't break a
// legitimate fight).
const ACADEMY_MIN_LEVEL = 15;

function academyBlock(target: OnlinePlayer, verb: 'attacked' | 'challenged'): Block | null {
    const level = Number((target.character as Record<string, unknown> | null)?.level ?? 0);
    if (level > 0 && level < ACADEMY_MIN_LEVEL) {
        return {
            status: 403,
            error: `This shinobi is under Academy protection (cannot be ${verb} until they reach Genin, level ${ACADEMY_MIN_LEVEL}).`,
        };
    }
    return null;
}

/**
 * Why an attack on `target` must be rejected, or null if it may proceed.
 * Order mirrors attack.ts: offline → 404; Academy → 403; traveling / already-
 * queued / in-battle → 409.
 */
export function attackBlock(target: OnlinePlayer | null, now: number = Date.now()): Block | null {
    if (!target) return { status: 404, error: 'Target not online.' };
    const academy = academyBlock(target, 'attacked');
    if (academy) return academy;
    if (target.travelingUntil && target.travelingUntil > now) {
        return { status: 409, error: 'Target is traveling and cannot be attacked.' };
    }
    if (target.pendingAttacker) return { status: 409, error: 'Target is already engaged in combat.' };
    if (target.inBattle) return { status: 409, error: 'Target is already in a battle.' };
    return null;
}

/**
 * Why a NEW challenge to `target` must be rejected, or null if it may proceed.
 * An OFFLINE target is NOT blocked (the challenge is queued for later). Order
 * mirrors challenge.ts: traveling / in-battle / engaged → 409; Academy → 403.
 */
export function challengeBlock(target: OnlinePlayer | null, now: number = Date.now()): Block | null {
    if (!target) return null;
    if (target.travelingUntil && target.travelingUntil > now) return { status: 409, error: 'Target is traveling.' };
    if (target.inBattle) return { status: 409, error: 'Target is already in a battle.' };
    if (target.pendingAttacker) return { status: 409, error: 'Target is already engaged in combat.' };
    return academyBlock(target, 'challenged');
}
