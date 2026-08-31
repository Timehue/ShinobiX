/**
 * Pure anti-grief gating predicates over an online-player record.
 *
 * Extracted so the attack/challenge rules live in ONE tested place and can't
 * drift between handlers as presence moves from the DB into the in-memory
 * store. These are intentionally pure (no I/O) — the handler does the
 * `onlineStore.get(name)` and passes the result here.
 *
 * Behavior matches the previous DB-backed checks in attack.ts / challenge.ts,
 * with ONE deliberate divergence (2026-08-30): Academy protection now applies to
 * challenges only. A world raid gates on ATTACKABLE_MIN_LEVEL (10), per the
 * owner's ruling that a player is protected only until level 10.
 * A `null` target means "not online".
 */
import type { OnlinePlayer } from './types.js';
import { safeName } from '../_utils.js';

export type Block = { status: 403 | 404 | 409; error: string };

/*
 * ⚠ KNOWN GAP — `target.inBattle` is asserted by the client and nothing corroborates it.
 *
 * Every "is in a battle" 409 below reads a flag the target's own heartbeat set
 * (api/player/heartbeat.ts passes `inBattle` straight into onlineStore.upsert).
 * The identity check there stops you setting it on SOMEONE ELSE, but nothing
 * stops a tampered client asserting it about ITSELF forever: they stay visible
 * in their sector, keep full wild-field income (sectorPresenceBlock only checks
 * the sector), and are un-attackable — and, being online, they never convert to
 * a sleeper camp either. That is the same "PvE income, PvP immunity" trade
 * _sector-presence-gate.ts was written to close via `sector: 0`; this is the
 * other door.
 *
 * It is deliberately NOT patched here, because there is no honest corroboration
 * source yet:
 *   • `battle:lock:<slug>` (api/battle/lock.ts) does NOT cover current fights —
 *     "Current Solo PvE, PvP, and Tower hosts instead recover their sealed
 *     sessions from their own server stores". Gating on it would strip immunity
 *     from players genuinely mid-fight and pull them into a second battle.
 *   • the PvP pending-session pointer is authoritative but PvP-only, so it would
 *     do the same to anyone in a Solo PvE / Tower / dungeon / pet fight.
 * Closing this needs a server-side battle-state source that every fight-start
 * path writes — a design change, not a predicate tweak.
 *
 * Sibling fields, for contrast: `travelingUntil` looks equally client-supplied
 * and is NOT — upsert ignores `entry.travelingUntil` entirely and only a minted
 * travel lease can set it (pinned in online-store.test.ts). And an actor
 * blocking THEMSELVES with `inBattle` is harmless; only the target-side reads
 * below confer immunity.
 */

// "Academy protection". ⚠ This is NOT the attackability floor — per the owner's
// 2026-08-30 ruling, **a player is protected only until level 10**, and that
// floor is ATTACKABLE_MIN_LEVEL below. What this threshold still governs:
//   • signing up for guard duty (api/village-guard/queue.ts) — volunteering FOR
//     danger, which is a different question from being protected from it; and
//   • being pulled into a competitive CHALLENGE (ranked / clan-war) by someone
//     else, where a level-10 floor already applies via each queue's own gate.
// Level 0/unknown is NOT protected (a missing field can't break a legitimate
// fight). Do not reintroduce this into attackBlock: it made sector raids refuse
// levels 10-14, which is exactly the protection the owner ruled against.
export const ACADEMY_MIN_LEVEL = 15;

// Hard floor for NON-consensual / competitive PvP (sector raids + ranked).
// Shinobi below this level simply can't be pulled into those fights at all —
// enforced from the AUTHORITATIVE save level at the session-creation chokepoint
// and at ranked-queue join, so it can't be bypassed by a pre-created session or
// raced by an un-warmed online-store record (which can momentarily read level 0).
// Consensual spars stay open to everyone. Kept separate from ACADEMY_MIN_LEVEL
// so the two protections can be tuned independently.
export const ATTACKABLE_MIN_LEVEL = 10;

/** True when `level` is a real, known level below the attackable floor (1..9). */
export function isBelowAttackableFloor(level: number): boolean {
    return level > 0 && level < ATTACKABLE_MIN_LEVEL;
}

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

// Only CHALLENGES still consult this. attackBlock deliberately does not —
// world raids gate on ATTACKABLE_MIN_LEVEL (10) per the owner's ruling.
function academyBlock(target: OnlinePlayer, verb: 'challenged'): Block | null {
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
 * Order mirrors attack.ts: offline → 404; newcomer floor → 403; traveling /
 * already-queued / in-battle → 409.
 *
 * The floor is ATTACKABLE_MIN_LEVEL (10), matching the owner's ruling that a
 * player is protected only until level 10 — and matching the gate the session
 * chokepoint already applies from the authoritative save, so the two cannot
 * disagree and refuse a raid here that would have been allowed there. This
 * deliberately does NOT use ACADEMY_MIN_LEVEL (15); see its note above.
 *
 * Presence levels can momentarily read 0 on an un-warmed record, and
 * isBelowAttackableFloor treats 0 as "unknown, not protected", so this can pass
 * a target the session gate then refuses from their real save. That ordering is
 * correct: the save-backed gate is the authority, this one is the fast refusal.
 */
export function attackBlock(target: OnlinePlayer | null, now: number = Date.now()): Block | null {
    if (!target) return { status: 404, error: 'Target not online.' };
    const level = Number((target.character as Record<string, unknown> | null)?.level ?? 0);
    if (isBelowAttackableFloor(level)) {
        return {
            status: 403,
            error: `Shinobi below level ${ATTACKABLE_MIN_LEVEL} are under newcomer protection and cannot be attacked.`,
        };
    }
    if (target.travelingUntil && target.travelingUntil > now) {
        return { status: 409, error: 'Target is traveling and cannot be attacked.' };
    }
    if (target.pendingAttacker) return { status: 409, error: 'Target is already engaged in combat.' };
    if (target.inBattle) return { status: 409, error: 'Target is already in a battle.' };
    return null;
}

/** Server-authoritative co-location gate for non-consensual world actions. */
export function worldInteractionBlock(actor: OnlinePlayer | null, target: OnlinePlayer | null, now: number = Date.now()): Block | null {
    if (!actor) return { status: 409, error: 'Your world presence is not ready.' };
    if (!target) return { status: 404, error: 'Target not online.' };
    if (actor.travelingUntil && actor.travelingUntil > now) return { status: 409, error: 'You cannot attack while traveling.' };
    if (actor.inBattle) return { status: 409, error: 'You are already in a battle.' };
    if (actor.sector < 1 || target.sector < 1) {
        return { status: 409, error: 'World attacks are disabled in safe zones.' };
    }
    if (actor.sector !== target.sector) return { status: 409, error: 'Target is no longer in your sector.' };
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
