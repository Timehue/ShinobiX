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

import {
    SECTOR_CONTROL_HP_MAX,
    SECTOR_CONTROL_HP_PER_WIN,
    SECTOR_CONTROL_HP_DEFENDER_REGEN,
    WIN_CONDITIONS,
    type WinCondition,
} from './_war-state.js';
import { SECTOR_WAR_WR, discountedWrCost } from './_war-economy.js';
import { isWarVillage, isWarSector } from './_war-map-sectors.js';

export interface SectorWarSession {
    /** stable id: `<sector>:<attackerSlug>-vs-<defenderSlug>` */
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    /** the defender's chosen contest type for this sector */
    winCondition: WinCondition;
    controlHp: number;
    controlHpMax: number;
    startedAt: number;
    updatedAt: number;
    /** true once the sector has been captured (Control HP hit 0) */
    flipped: boolean;
}

function clampInt(n: unknown, lo: number, hi: number): number {
    const v = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, v));
}
function asWinCondition(v: unknown): WinCondition {
    return (WIN_CONDITIONS as readonly string[]).includes(v as string) ? (v as WinCondition) : 'combat';
}
function slug(v: string): string {
    return String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Stable id for the contest of `sector` by `attacker` against `defender`. */
export function sectorWarId(sector: number, attacker: string, defender: string): string {
    return `${clampInt(sector, 1, 60)}:${slug(attacker)}-vs-${slug(defender)}`;
}

/** A fresh sector-war session at full Control HP. `controlHpMax` lets the caller
 *  pass the defender's Watchtower-boosted cap (api/_war-structures.sectorControlHpMax);
 *  defaults to the base. */
export function newSectorWarSession(args: {
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: WinCondition;
    now: number;
    controlHpMax?: number;
}): SectorWarSession {
    const max = clampInt(args.controlHpMax ?? SECTOR_CONTROL_HP_MAX, 1, SECTOR_CONTROL_HP_MAX * 4);
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
export function normalizeSectorWarSession(raw: Partial<SectorWarSession>): SectorWarSession | null {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.attackerVillage || !raw.defenderVillage || raw.attackerVillage === raw.defenderVillage) return null;
    const max = clampInt(raw.controlHpMax ?? SECTOR_CONTROL_HP_MAX, 1, SECTOR_CONTROL_HP_MAX * 4);
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

export interface SectorBattleOutcome {
    session: SectorWarSession;
    captured: boolean;    // the sector flipped THIS battle
    hpDealt: number;      // Control HP removed (attacker win) — 0 on a defended battle
    hpRegen: number;      // Control HP restored (defender win)
}

// A player who repels an AI MERCENARY attacker only regenerates this FRACTION of
// the normal Control-HP defender regen — a merc raid is a lower-stakes attack, so
// beating one barely shores the wall back up (Phase 5 spec). Tunable.
export const MERC_DEFENDER_REGEN_FRACTION = 0.25;

/** Apply one resolved win-condition battle to a sector-war session (§17.6).
 *  Attacker win → −`damage` Control HP (flip + freeze at 0). Defender win → hold
 *  the line, +DEFENDER_REGEN (capped) — or 25% of that when the attacker was a
 *  mercenary (opts.mercBattle). Already-flipped sessions are inert. `damage` lets
 *  the caller pass the attacker's War-Academy-boosted value
 *  (api/_war-structures.sectorWarDamageMultiplier); defaults to the base per-win. */
export function applySectorBattleResult(
    session: SectorWarSession,
    attackerWon: boolean,
    opts: { now: number; damage?: number; mercBattle?: boolean },
): SectorBattleOutcome {
    if (session.flipped) {
        return { session, captured: false, hpDealt: 0, hpRegen: 0 };
    }
    const next: SectorWarSession = { ...session, updatedAt: opts.now };
    if (attackerWon) {
        const dmg = Math.max(0, Math.floor(Number(opts.damage ?? SECTOR_CONTROL_HP_PER_WIN) || 0));
        const before = next.controlHp;
        next.controlHp = Math.max(0, before - dmg);
        const captured = next.controlHp <= 0;
        next.flipped = captured;
        return { session: next, captured, hpDealt: before - next.controlHp, hpRegen: 0 };
    }
    const before = next.controlHp;
    const regen = opts.mercBattle
        ? Math.floor(SECTOR_CONTROL_HP_DEFENDER_REGEN * MERC_DEFENDER_REGEN_FRACTION)
        : SECTOR_CONTROL_HP_DEFENDER_REGEN;
    next.controlHp = Math.min(next.controlHpMax, before + regen);
    return { session: next, captured: false, hpDealt: 0, hpRegen: next.controlHp - before };
}

// ── Storage keys ──
/** The persistent Control-HP siege record for an active contest. */
export function sectorWarKey(id: string): string {
    return `shared:sector-war:${id}`;
}

/** Map a finished win-condition battle by WINNER SIDE onto a contest, where p1 is
 *  the attacker side and p2 the defender side (the sector-card session enforces
 *  that): p1 win → attacker chip, p2 win → defender regen, draw → no Control-HP
 *  change (returns null). Combat resolves attacker-vs-defender by village instead
 *  and calls applySectorBattleResult directly; this is the by-side path Card uses. */
export function applyContestBattleByWinner(
    session: SectorWarSession,
    winner: 'p1' | 'p2' | 'draw',
    opts: { now: number; damage?: number },
): SectorBattleOutcome | null {
    if (winner !== 'p1' && winner !== 'p2') return null; // draw → neither chip nor regen
    return applySectorBattleResult(session, winner === 'p1', opts);
}

// ── Per-battle authorization token (mint-on-attack, single-use on resolve) ──
// The server mints this when a sector-war battle is launched, sealing the
// contest context (sector + the two villages + the win-condition) so the resolve
// step never trusts the client for who fought whom or for which sector. Deleting
// it on use makes a battle count exactly once — the single-use-token pattern from
// docs/auth-and-anti-cheat-patterns.md applied to territory captures.
export const SECTOR_WAR_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — a battle is short

export interface SectorWarBattleToken {
    battleId: string;          // the pvp:<battleId> (or card session id) this authorizes
    sectorWarId: string;       // the contest it feeds
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    registeredBy: string;    // safeName of whoever registered the battle (audit / future contribution)
    winCondition: WinCondition;
    createdAt: number;
    expiresAt: number;
}

export function sectorWarTokenKey(battleId: string): string {
    return `shared:sector-war-token:${battleId}`;
}

export function newSectorWarBattleToken(args: {
    battleId: string;
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    registeredBy: string;
    winCondition: WinCondition;
    now: number;
}): SectorWarBattleToken {
    return {
        battleId: String(args.battleId),
        sectorWarId: String(args.sectorWarId),
        sector: clampInt(args.sector, 1, 60),
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        registeredBy: args.registeredBy,
        winCondition: asWinCondition(args.winCondition),
        createdAt: args.now,
        expiresAt: args.now + SECTOR_WAR_TOKEN_TTL_MS,
    };
}

export function normalizeSectorWarBattleToken(raw: Partial<SectorWarBattleToken>): SectorWarBattleToken | null {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.battleId || !raw.sectorWarId) return null;
    if (!raw.attackerVillage || !raw.defenderVillage || raw.attackerVillage === raw.defenderVillage) return null;
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

// ── Declare eligibility (pure; the endpoint fetches the inputs) ── §17.1
export type SectorWarDeclineReason =
    | 'self'
    | 'not-war-village'
    | 'not-war-sector'
    | 'not-enemy-held'
    | 'mutual-exclusion-attacker'
    | 'mutual-exclusion-defender'
    | 'already-contested'
    | 'win-condition-unavailable'
    | 'insufficient-wr';

export interface SectorWarDeclareCheck {
    attackerVillage: string;
    defenderVillage: string;
    sector: number;
    /** current world:territory:<sector>.ownerVillage */
    sectorOwnerVillage: string;
    /** the defender's chosen win-condition for this sector */
    winCondition: WinCondition;
    attackerInActiveVillageWar: boolean;
    defenderInActiveVillageWar: boolean;
    /** an unflipped contest already exists for this sector */
    contestAlreadyActive: boolean;
    attackerWr: number;
    attackerSectorsHeld: number;
    /** which win-conditions are wired this build (v1 = Combat only). Defaults to ['combat']. */
    allowedWinConditions?: readonly WinCondition[];
}

export type SectorWarDeclareResult =
    | { ok: true; cost: number }
    | { ok: false; error: SectorWarDeclineReason; cost?: number };

/** Whether `attacker` may open a sector war on `sector` (currently held by
 *  `defender`), and the WR cost after the comeback discount. Pure — the endpoint
 *  resolves ownership / village-war status / the WR pool and passes them in
 *  (§17.1: 250 WR, mutual-exclusive with a village war, multiple only vs
 *  different villages). */
export function canDeclareSectorWar(c: SectorWarDeclareCheck): SectorWarDeclareResult {
    const attacker = String(c.attackerVillage);
    const defender = String(c.defenderVillage);
    if (!attacker || !defender || attacker === defender) return { ok: false, error: 'self' };
    if (!isWarVillage(attacker) || !isWarVillage(defender)) return { ok: false, error: 'not-war-village' };
    if (!isWarSector(c.sector)) return { ok: false, error: 'not-war-sector' };
    if (String(c.sectorOwnerVillage) !== defender) return { ok: false, error: 'not-enemy-held' };
    if (c.attackerInActiveVillageWar) return { ok: false, error: 'mutual-exclusion-attacker' };
    if (c.defenderInActiveVillageWar) return { ok: false, error: 'mutual-exclusion-defender' };
    if (c.contestAlreadyActive) return { ok: false, error: 'already-contested' };
    const allowed = c.allowedWinConditions ?? (['combat'] as readonly WinCondition[]);
    if (!allowed.includes(c.winCondition)) return { ok: false, error: 'win-condition-unavailable' };
    const cost = discountedWrCost(SECTOR_WAR_WR, c.attackerSectorsHeld);
    if (Math.floor(Number(c.attackerWr) || 0) < cost) return { ok: false, error: 'insufficient-wr', cost };
    return { ok: true, cost };
}
