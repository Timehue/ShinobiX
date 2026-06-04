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
import { safeName } from '../_utils.js';

export type Block = { status: 403 | 404 | 409; error: string };

// Shinobi below this level are under "Academy protection" — they can't be
// attacked in the sectors (or sign up for guard duty, which exposes them to
// sector attacks), so brand-new players aren't farmed before they learn the
// game. Level 0/unknown is NOT protected (a missing field can't break a
// legitimate fight).
export const ACADEMY_MIN_LEVEL = 15;

/**
 * True when `level` is a real, sub-Genin level (1..14). Level 0 / unknown is
 * deliberately NOT protected so a missing field can't break a legitimate fight
 * or a guard-queue signup. Shared so the guard-queue handler gates on the exact
 * same threshold as combat.
 */
export function isAcademyProtectedLevel(level: number): boolean {
    return level > 0 && level < ACADEMY_MIN_LEVEL;
}

// Spar (standard) and pet battles are CONSENSUAL: the challenge only lands in
// the target's inbox and they can always decline, so there's no grief vector to
// guard against. These modes are therefore exempt from Academy protection — a
// brand-new shinobi can practice-spar or pet-battle anyone at any level.
// Competitive PvP ladders (ranked, clan-war 1v1/2v2) keep the sub-Genin gate.
const ACADEMY_EXEMPT_CHALLENGE_MODES = new Set<string>(['standard', 'clanWarPet', 'rankedPet']);

function academyBlock(target: OnlinePlayer, verb: 'attacked' | 'challenged'): Block | null {
    const level = Number((target.character as Record<string, unknown> | null)?.level ?? 0);
    if (isAcademyProtectedLevel(level)) {
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
 *
 * `mode` is the challenge's mode (e.g. 'standard', 'clanWarPet', 'ranked'). Spar
 * and pet-battle modes (ACADEMY_EXEMPT_CHALLENGE_MODES) skip the Academy gate so
 * sub-Genin players can still be spar/pet-challenged; every other mode keeps it.
 * The traveling / in-battle / engaged 409s apply to ALL modes regardless.
 */
export function challengeBlock(target: OnlinePlayer | null, mode?: string, now: number = Date.now()): Block | null {
    if (!target) return null;
    if (target.travelingUntil && target.travelingUntil > now) return { status: 409, error: 'Target is traveling.' };
    if (target.inBattle) return { status: 409, error: 'Target is already in a battle.' };
    if (target.pendingAttacker) return { status: 409, error: 'Target is already engaged in combat.' };
    if (mode && ACADEMY_EXEMPT_CHALLENGE_MODES.has(mode)) return null;
    return academyBlock(target, 'challenged');
}

/**
 * Why a player-vs-player SESSION against `target` must be rejected, or null if
 * it may proceed. Enforced at /api/pvp/session creation (audit #4) so a client
 * that pre-creates the session — before /api/player/challenge (which skips its
 * own gate once a battleId exists) or /api/player/attack — can't bypass the
 * traveling / in-battle / engaged presence gate and fight an unavailable target.
 *
 * Differences from attack/challengeBlock, by design:
 *   • No Academy gate — it's mode-specific and the challenge/attack handlers
 *     already own it; re-applying it here (session has no mode) would wrongly
 *     block legitimate sub-Genin spars.
 *   • An engagement set by the CALLER themselves (`byName`, a safeName slug) is
 *     exempt — that's the legit attack→create-session flow, where the caller's
 *     own /api/player/attack just stamped the target's pendingAttacker.
 *   • An OFFLINE target is NOT blocked (challenges queue for later; the session
 *     is created optimistically, matching today's behaviour).
 */
export function sessionOpponentBlock(target: OnlinePlayer | null, byName: string, now: number = Date.now()): Block | null {
    if (!target) return null;
    if (target.travelingUntil && target.travelingUntil > now) {
        return { status: 409, error: 'Opponent is traveling and cannot be fought right now.' };
    }
    if (target.inBattle) return { status: 409, error: 'Opponent is already in a battle.' };
    // pendingAttacker is stored loosely (the attacker's character or {}), so
    // read its name defensively before canonicalizing.
    const pendingName = (target.pendingAttacker as { name?: unknown } | null)?.name;
    const engagedBy = pendingName ? safeName(String(pendingName)) : '';
    if (engagedBy && engagedBy !== byName) {
        return { status: 409, error: 'Opponent is already engaged in combat.' };
    }
    return null;
}
