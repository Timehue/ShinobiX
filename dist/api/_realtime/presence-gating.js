"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACADEMY_MIN_LEVEL = void 0;
exports.isAcademyProtectedLevel = isAcademyProtectedLevel;
exports.attackBlock = attackBlock;
exports.challengeBlock = challengeBlock;
// Shinobi below this level are under "Academy protection" — they can't be
// attacked in the sectors (or sign up for guard duty, which exposes them to
// sector attacks), so brand-new players aren't farmed before they learn the
// game. Level 0/unknown is NOT protected (a missing field can't break a
// legitimate fight).
exports.ACADEMY_MIN_LEVEL = 15;
/**
 * True when `level` is a real, sub-Genin level (1..14). Level 0 / unknown is
 * deliberately NOT protected so a missing field can't break a legitimate fight
 * or a guard-queue signup. Shared so the guard-queue handler gates on the exact
 * same threshold as combat.
 */
function isAcademyProtectedLevel(level) {
    return level > 0 && level < exports.ACADEMY_MIN_LEVEL;
}
// Spar (standard) and pet battles are CONSENSUAL: the challenge only lands in
// the target's inbox and they can always decline, so there's no grief vector to
// guard against. These modes are therefore exempt from Academy protection — a
// brand-new shinobi can practice-spar or pet-battle anyone at any level.
// Competitive PvP ladders (ranked, clan-war 1v1/2v2) keep the sub-Genin gate.
const ACADEMY_EXEMPT_CHALLENGE_MODES = new Set(['standard', 'clanWarPet', 'rankedPet']);
function academyBlock(target, verb) {
    const level = Number(target.character?.level ?? 0);
    if (isAcademyProtectedLevel(level)) {
        return {
            status: 403,
            error: `This shinobi is under Academy protection (cannot be ${verb} until they reach Genin, level ${exports.ACADEMY_MIN_LEVEL}).`,
        };
    }
    return null;
}
/**
 * Why an attack on `target` must be rejected, or null if it may proceed.
 * Order mirrors attack.ts: offline → 404; Academy → 403; traveling / already-
 * queued / in-battle → 409.
 */
function attackBlock(target, now = Date.now()) {
    if (!target)
        return { status: 404, error: 'Target not online.' };
    const academy = academyBlock(target, 'attacked');
    if (academy)
        return academy;
    if (target.travelingUntil && target.travelingUntil > now) {
        return { status: 409, error: 'Target is traveling and cannot be attacked.' };
    }
    if (target.pendingAttacker)
        return { status: 409, error: 'Target is already engaged in combat.' };
    if (target.inBattle)
        return { status: 409, error: 'Target is already in a battle.' };
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
function challengeBlock(target, mode, now = Date.now()) {
    if (!target)
        return null;
    if (target.travelingUntil && target.travelingUntil > now)
        return { status: 409, error: 'Target is traveling.' };
    if (target.inBattle)
        return { status: 409, error: 'Target is already in a battle.' };
    if (target.pendingAttacker)
        return { status: 409, error: 'Target is already engaged in combat.' };
    if (mode && ACADEMY_EXEMPT_CHALLENGE_MODES.has(mode))
        return null;
    return academyBlock(target, 'challenged');
}
