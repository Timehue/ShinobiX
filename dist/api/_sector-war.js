"use strict";
/*
 * Village War Map — the sector-war contest model (Phase 4a, pure). §17.2 / §17.6
 *
 * A sector war is a short, win-condition-driven fight for ONE sector, separate
 * from the all-out village war (api/world-state.ts). The attacking village wins
 * battles of the sector's defender-chosen win-condition (Combat / Card [/ Pet]);
 * each attacker win chips the sector's Control HP, each defender win holds the
 * line (+regen), and at 0 the sector flips to the attacker. Persistent ownership
 * is `world:territory:<sector>.ownerVillage` (the field map-control reads); the
 * live flip + battle wiring lands in Phase 4b/4c.
 *
 * This module is the pure heart: the session shape, its normalizer, and the
 * Control-HP transform a resolved battle applies. IO-free.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTOR_WAR_TOKEN_TTL_MS = void 0;
exports.sectorWarId = sectorWarId;
exports.newSectorWarSession = newSectorWarSession;
exports.normalizeSectorWarSession = normalizeSectorWarSession;
exports.applySectorBattleResult = applySectorBattleResult;
exports.sectorWarKey = sectorWarKey;
exports.applyContestBattleByWinner = applyContestBattleByWinner;
exports.sectorWarTokenKey = sectorWarTokenKey;
exports.newSectorWarBattleToken = newSectorWarBattleToken;
exports.normalizeSectorWarBattleToken = normalizeSectorWarBattleToken;
exports.canDeclareSectorWar = canDeclareSectorWar;
const _war_state_js_1 = require("./_war-state.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
function clampInt(n, lo, hi) {
    const v = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, v));
}
function asWinCondition(v) {
    return _war_state_js_1.WIN_CONDITIONS.includes(v) ? v : 'combat';
}
function slug(v) {
    return String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** Stable id for the contest of `sector` by `attacker` against `defender`. */
function sectorWarId(sector, attacker, defender) {
    return `${clampInt(sector, 1, 60)}:${slug(attacker)}-vs-${slug(defender)}`;
}
/** A fresh sector-war session at full Control HP. `controlHpMax` lets the caller
 *  pass the defender's Watchtower-boosted cap (api/_war-structures.sectorControlHpMax);
 *  defaults to the base. */
function newSectorWarSession(args) {
    const max = clampInt(args.controlHpMax ?? _war_state_js_1.SECTOR_CONTROL_HP_MAX, 1, _war_state_js_1.SECTOR_CONTROL_HP_MAX * 4);
    return {
        id: sectorWarId(args.sector, args.attackerVillage, args.defenderVillage),
        sector: clampInt(args.sector, 1, 60),
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        winCondition: asWinCondition(args.winCondition),
        controlHp: max,
        controlHpMax: max,
        startedAt: args.now,
        updatedAt: args.now,
        flipped: false,
    };
}
/** Normalize a session loaded from storage — clamp HP, validate the win-condition. */
function normalizeSectorWarSession(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    if (!raw.attackerVillage || !raw.defenderVillage || raw.attackerVillage === raw.defenderVillage)
        return null;
    const max = clampInt(raw.controlHpMax ?? _war_state_js_1.SECTOR_CONTROL_HP_MAX, 1, _war_state_js_1.SECTOR_CONTROL_HP_MAX * 4);
    return {
        id: String(raw.id ?? sectorWarId(Number(raw.sector) || 0, raw.attackerVillage, raw.defenderVillage)),
        sector: clampInt(raw.sector, 1, 60),
        attackerVillage: String(raw.attackerVillage),
        defenderVillage: String(raw.defenderVillage),
        winCondition: asWinCondition(raw.winCondition),
        controlHp: clampInt(raw.controlHp ?? max, 0, max),
        controlHpMax: max,
        startedAt: Math.floor(Number(raw.startedAt) || 0),
        updatedAt: Math.floor(Number(raw.updatedAt) || 0),
        flipped: raw.flipped === true,
    };
}
/** Apply one resolved win-condition battle to a sector-war session (§17.6).
 *  Attacker win → −`damage` Control HP (flip + freeze at 0). Defender win → hold
 *  the line, +DEFENDER_REGEN (capped). Already-flipped sessions are inert.
 *  `damage` lets the caller pass the attacker's War-Academy-boosted value
 *  (api/_war-structures.sectorWarDamageMultiplier); defaults to the base per-win. */
function applySectorBattleResult(session, attackerWon, opts) {
    if (session.flipped) {
        return { session, captured: false, hpDealt: 0, hpRegen: 0 };
    }
    const next = { ...session, updatedAt: opts.now };
    if (attackerWon) {
        const dmg = Math.max(0, Math.floor(Number(opts.damage ?? _war_state_js_1.SECTOR_CONTROL_HP_PER_WIN) || 0));
        const before = next.controlHp;
        next.controlHp = Math.max(0, before - dmg);
        const captured = next.controlHp <= 0;
        next.flipped = captured;
        return { session: next, captured, hpDealt: before - next.controlHp, hpRegen: 0 };
    }
    const before = next.controlHp;
    next.controlHp = Math.min(next.controlHpMax, before + _war_state_js_1.SECTOR_CONTROL_HP_DEFENDER_REGEN);
    return { session: next, captured: false, hpDealt: 0, hpRegen: next.controlHp - before };
}
// ── Storage keys ──
/** The persistent Control-HP siege record for an active contest. */
function sectorWarKey(id) {
    return `shared:sector-war:${id}`;
}
/** Map a finished win-condition battle by WINNER SIDE onto a contest, where p1 is
 *  the attacker side and p2 the defender side (the sector-card session enforces
 *  that): p1 win → attacker chip, p2 win → defender regen, draw → no Control-HP
 *  change (returns null). Combat resolves attacker-vs-defender by village instead
 *  and calls applySectorBattleResult directly; this is the by-side path Card uses. */
function applyContestBattleByWinner(session, winner, opts) {
    if (winner !== 'p1' && winner !== 'p2')
        return null; // draw → neither chip nor regen
    return applySectorBattleResult(session, winner === 'p1', opts);
}
// ── Per-battle authorization token (mint-on-attack, single-use on resolve) ──
// The server mints this when a sector-war battle is launched, sealing the
// contest context (sector + the two villages + the win-condition) so the resolve
// step never trusts the client for who fought whom or for which sector. Deleting
// it on use makes a battle count exactly once — the single-use-token pattern from
// docs/auth-and-anti-cheat-patterns.md applied to territory captures.
exports.SECTOR_WAR_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — a battle is short
function sectorWarTokenKey(battleId) {
    return `shared:sector-war-token:${battleId}`;
}
function newSectorWarBattleToken(args) {
    return {
        battleId: String(args.battleId),
        sectorWarId: String(args.sectorWarId),
        sector: clampInt(args.sector, 1, 60),
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        registeredBy: args.registeredBy,
        winCondition: asWinCondition(args.winCondition),
        createdAt: args.now,
        expiresAt: args.now + exports.SECTOR_WAR_TOKEN_TTL_MS,
    };
}
function normalizeSectorWarBattleToken(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    if (!raw.battleId || !raw.sectorWarId)
        return null;
    if (!raw.attackerVillage || !raw.defenderVillage || raw.attackerVillage === raw.defenderVillage)
        return null;
    return {
        battleId: String(raw.battleId),
        sectorWarId: String(raw.sectorWarId),
        sector: clampInt(raw.sector, 1, 60),
        attackerVillage: String(raw.attackerVillage),
        defenderVillage: String(raw.defenderVillage),
        registeredBy: String(raw.registeredBy ?? ''),
        winCondition: asWinCondition(raw.winCondition),
        createdAt: Math.floor(Number(raw.createdAt) || 0),
        expiresAt: Math.floor(Number(raw.expiresAt) || 0),
    };
}
/** Whether `attacker` may open a sector war on `sector` (currently held by
 *  `defender`), and the WR cost after the comeback discount. Pure — the endpoint
 *  resolves ownership / village-war status / the WR pool and passes them in
 *  (§17.1: 250 WR, mutual-exclusive with a village war, multiple only vs
 *  different villages). */
function canDeclareSectorWar(c) {
    const attacker = String(c.attackerVillage);
    const defender = String(c.defenderVillage);
    if (!attacker || !defender || attacker === defender)
        return { ok: false, error: 'self' };
    if (!(0, _war_map_sectors_js_1.isWarVillage)(attacker) || !(0, _war_map_sectors_js_1.isWarVillage)(defender))
        return { ok: false, error: 'not-war-village' };
    if (!(0, _war_map_sectors_js_1.isWarSector)(c.sector))
        return { ok: false, error: 'not-war-sector' };
    if (String(c.sectorOwnerVillage) !== defender)
        return { ok: false, error: 'not-enemy-held' };
    if (c.attackerInActiveVillageWar)
        return { ok: false, error: 'mutual-exclusion-attacker' };
    if (c.defenderInActiveVillageWar)
        return { ok: false, error: 'mutual-exclusion-defender' };
    if (c.contestAlreadyActive)
        return { ok: false, error: 'already-contested' };
    const allowed = c.allowedWinConditions ?? ['combat'];
    if (!allowed.includes(c.winCondition))
        return { ok: false, error: 'win-condition-unavailable' };
    const cost = (0, _war_economy_js_1.discountedWrCost)(_war_economy_js_1.SECTOR_WAR_WR, c.attackerSectorsHeld);
    if (Math.floor(Number(c.attackerWr) || 0) < cost)
        return { ok: false, error: 'insufficient-wr', cost };
    return { ok: true, cost };
}
