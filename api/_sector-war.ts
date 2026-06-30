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

/** Apply one resolved win-condition battle to a sector-war session (§17.6).
 *  Attacker win → −`damage` Control HP (flip + freeze at 0). Defender win → hold
 *  the line, +DEFENDER_REGEN (capped). Already-flipped sessions are inert.
 *  `damage` lets the caller pass the attacker's War-Academy-boosted value
 *  (api/_war-structures.sectorWarDamageMultiplier); defaults to the base per-win. */
export function applySectorBattleResult(
    session: SectorWarSession,
    attackerWon: boolean,
    opts: { now: number; damage?: number },
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
    next.controlHp = Math.min(next.controlHpMax, before + SECTOR_CONTROL_HP_DEFENDER_REGEN);
    return { session: next, captured: false, hpDealt: 0, hpRegen: next.controlHp - before };
}
