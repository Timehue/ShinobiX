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
    SECTOR_CONTROL_HP_ABSOLUTE_MAX,
    SECTOR_CONTROL_MAX_SWING_FRACTION,
    WIN_CONDITIONS,
    type WinCondition,
} from './_war-state.js';
import { SECTOR_WAR_WR, discountedWrCost } from './_war-economy.js';
import { isWarVillage, isWarSector } from './_war-map-sectors.js';
import { MAX_WILD_SECTOR } from '../shared/sector-geo.js';

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
    /** Set when the siege ended WITHOUT a capture — the defender held. Once set the
     *  contest is inert: it accepts no battles and no longer occupies the sector. */
    expiredAt?: number;
    expiredReason?: SectorWarExpiryReason;
    /** Durable once receipts for combat/card/pet outcomes applied to Control HP. */
    appliedBattles?: SectorWarBattleReceipt[];
}

/** Why a siege ended without taking the sector. */
export type SectorWarExpiryReason =
    /** Nobody fought it for SECTOR_WAR_IDLE_TIMEOUT_MS — an abandoned siege. */
    | 'idle'
    /** Ran the full SECTOR_WAR_MAX_DURATION_MS without breaking the hold. */
    | 'timeout'
    /** The attacking Kage called it off. */
    | 'abandoned';

export interface SectorWarBattleReceipt {
    battleId: string;
    attackerWon: boolean;
    captured: boolean;
    hpDealt: number;
    hpRegen: number;
    controlHp: number;
    at: number;
}

export const SECTOR_WAR_BATTLE_RECEIPT_CAP = 200;

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

/** Stable id for the contest of `sector` by `attacker` against `defender`.
 *
 * The sector bound is MAX_WILD_SECTOR, never a literal. These clamps are purely
 * defensive today — `canDeclareSectorWar` rejects anything outside the 32 home
 * war sectors (all <= 33) before an id is ever minted — but the bound was
 * hardcoded `60` through the 61-66 expansion, so had the war map ever reached
 * the new ground a contest on 63 would have CLAMPED to 60 and silently collided
 * with sector 60's own war key. Clamping a sector id is lossy; keep it tied to
 * the shared registry. */
export function sectorWarId(sector: number, attacker: string, defender: string): string {
    return `${clampInt(sector, 1, MAX_WILD_SECTOR)}:${slug(attacker)}-vs-${slug(defender)}`;
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
        sector: clampInt(args.sector, 1, MAX_WILD_SECTOR),
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
    const max = clampInt(raw.controlHpMax ?? SECTOR_CONTROL_HP_MAX, 1, SECTOR_CONTROL_HP_ABSOLUTE_MAX);
    const appliedBattles = Array.isArray(raw.appliedBattles)
        ? raw.appliedBattles.filter((entry): entry is SectorWarBattleReceipt => !!entry && typeof entry.battleId === 'string')
            .slice(0, SECTOR_WAR_BATTLE_RECEIPT_CAP)
        : [];
    return {
        id: String(raw.id ?? sectorWarId(Number(raw.sector) || 0, raw.attackerVillage, raw.defenderVillage)),
        sector: clampInt(raw.sector, 1, MAX_WILD_SECTOR),
        attackerVillage: String(raw.attackerVillage),
        defenderVillage: String(raw.defenderVillage),
        winCondition: asWinCondition(raw.winCondition),
        controlHp: clampInt(raw.controlHp ?? max, 0, max),
        controlHpMax: max,
        startedAt: Math.floor(Number(raw.startedAt) || 0),
        updatedAt: Math.floor(Number(raw.updatedAt) || 0),
        flipped: raw.flipped === true,
        ...(Number(raw.expiredAt) > 0
            ? {
                expiredAt: Math.floor(Number(raw.expiredAt)),
                expiredReason: (raw.expiredReason === 'idle' || raw.expiredReason === 'abandoned'
                    ? raw.expiredReason
                    : 'timeout') as SectorWarExpiryReason,
            }
            : {}),
        ...(appliedBattles.length ? { appliedBattles } : {}),
    };
}

export interface SectorBattleOutcome {
    session: SectorWarSession;
    captured: boolean;    // the sector flipped THIS battle
    hpDealt: number;      // Control HP removed (attacker win) — 0 on a defended battle
    hpRegen: number;      // Control HP restored (defender win)
}

export function findSectorWarBattleReceipt(session: SectorWarSession, battleId: string): SectorWarBattleReceipt | null {
    return session.appliedBattles?.find((entry) => entry.battleId === battleId) ?? null;
}

export function recordSectorWarBattleOutcome(
    outcome: SectorBattleOutcome,
    args: { battleId: string; attackerWon: boolean; at: number },
): { session: SectorWarSession; receipt: SectorWarBattleReceipt } {
    const prior = findSectorWarBattleReceipt(outcome.session, args.battleId);
    if (prior) return { session: outcome.session, receipt: prior };
    const receipt: SectorWarBattleReceipt = {
        battleId: args.battleId,
        attackerWon: args.attackerWon,
        captured: outcome.captured,
        hpDealt: outcome.hpDealt,
        hpRegen: outcome.hpRegen,
        controlHp: outcome.session.controlHp,
        at: args.at,
    };
    return {
        session: {
            ...outcome.session,
            appliedBattles: [receipt, ...(outcome.session.appliedBattles ?? [])].slice(0, SECTOR_WAR_BATTLE_RECEIPT_CAP),
        },
        receipt,
    };
}

// A defender WIN heals the sector's hold by this fraction of the fight's role
// swing — HALF, so trading wins 1:1 still nets the attacker ground and a siege
// always converges, while an active defense roughly doubles what it costs (§17.6).
// A repelled AI MERCENARY heals only MERC_DEFENDER_REGEN_FRACTION (a lower-stakes
// attack). With the 2026-08-06 bar of 100, rank-and-file take a sector in 20 wins
// (~28 fights at an 80% win rate) — see SECTOR_CONTROL_HP_MAX for the full table.
export const DEFENDER_HEAL_FRACTION = 0.5;
export const MERC_DEFENDER_REGEN_FRACTION = 0.25;

/**
 * Clamp one fight's role-scaled swing to SECTOR_CONTROL_MAX_SWING_FRACTION of the
 * sector's bar, so the top of the role ladder stays decisive without letting a
 * single duel end a siege. A Kage felling a Kage swings 80 raw against a 100-HP
 * sector; capped at 20 it still takes a sector 4× faster than rank-and-file do,
 * but the siege is always at least 5 fights.
 *
 * The floor of 1 is kept from the uncapped path: a resolved fight is never a
 * no-op, however lopsided the ranks. Pure.
 */
export function cappedSectorSwing(rawSwing: number, controlHpMax: number): number {
    const swing = Math.max(0, Math.floor(Number(rawSwing) || 0));
    if (swing <= 0) return 0;
    const max = Math.max(1, Math.floor(Number(controlHpMax) || 0));
    const cap = Math.max(1, Math.floor(max * SECTOR_CONTROL_MAX_SWING_FRACTION));
    return Math.min(swing, cap);
}

/** Apply one resolved win-condition battle to a sector-war session (§17.6).
 *  Attacker win → −`swing` Control HP (flip + freeze at 0). Defender win → HEAL the
 *  hold by `swing` × DEFENDER_HEAL_FRACTION (capped at max), or × the smaller
 *  MERC_DEFENDER_REGEN_FRACTION when the attacker was a mercenary (opts.mercBattle).
 *  `swing` is the caller's role-scaled, War-Academy-boosted value
 *  (api/_war-role sectorControlSwing = winner.win + loser.loss). Already-flipped
 *  sessions are inert. Pure. */
export function applySectorBattleResult(
    session: SectorWarSession,
    attackerWon: boolean,
    opts: { now: number; swing: number; mercBattle?: boolean },
): SectorBattleOutcome {
    // A captured OR lapsed contest is inert — a battle registered before the siege
    // timed out must not still chip a sector the defender has already held.
    if (session.flipped || session.expiredAt) {
        return { session, captured: false, hpDealt: 0, hpRegen: 0 };
    }
    const swing = cappedSectorSwing(opts.swing, session.controlHpMax);
    const next: SectorWarSession = { ...session, updatedAt: opts.now };
    if (attackerWon) {
        const before = next.controlHp;
        next.controlHp = Math.max(0, before - swing);
        const captured = next.controlHp <= 0;
        next.flipped = captured;
        return { session: next, captured, hpDealt: before - next.controlHp, hpRegen: 0 };
    }
    const before = next.controlHp;
    const heal = Math.max(0, Math.floor(swing * (opts.mercBattle ? MERC_DEFENDER_REGEN_FRACTION : DEFENDER_HEAL_FRACTION)));
    next.controlHp = Math.min(next.controlHpMax, before + heal);
    return { session: next, captured: false, hpDealt: 0, hpRegen: next.controlHp - before };
}

// ── Expiry ─────────────────────────────────────────────────────────────────────
/*
 * A sector-war contest used to live forever. Nothing decayed it, no action called
 * it off, and `listActiveSectorWars` filtered only on `flipped` — so one declare
 * held its sector hostage permanently under the one-contest-per-sector rule, and
 * kept its village flagged "at war" in the daily pass, which meant the per-war
 * Ramparts/Watchtower never reset at peace. Both village wars and clan wars
 * already auto-finalize at 14 days; sector wars had no equivalent.
 *
 * Two clocks, mirroring the lazy-expiry pattern used by applyLazyClanWarExpiry:
 * an IDLE timeout that releases an abandoned siege quickly, and a hard cap so
 * even a contested one resolves. Expiry is a DEFENDER HOLD — the sector does not
 * change hands, and the attacker does not get their WR back (a failed siege is
 * meant to cost something, which is also what stops declare-spam).
 */

/** No battle applied for this long → the siege is abandoned and the sector frees up. */
export const SECTOR_WAR_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
/** Hard cap on a single siege, well inside the village war's 14 days (§17.6 sizes
 *  a sector war as the SHORTER conflict). */
export const SECTOR_WAR_MAX_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether a contest has run out of time, and why. Pure. `updatedAt` advances on
 *  every applied battle, so it doubles as the last-activity stamp. */
export function sectorWarExpiry(
    session: Pick<SectorWarSession, 'startedAt' | 'updatedAt' | 'flipped' | 'expiredAt'>,
    now: number,
): { expired: boolean; reason?: SectorWarExpiryReason } {
    if (session.flipped) return { expired: false };
    if (session.expiredAt) return { expired: true, reason: 'timeout' };
    const startedAt = Math.floor(Number(session.startedAt) || 0);
    const lastActivity = Math.max(startedAt, Math.floor(Number(session.updatedAt) || 0));
    if (startedAt > 0 && now - startedAt >= SECTOR_WAR_MAX_DURATION_MS) return { expired: true, reason: 'timeout' };
    if (lastActivity > 0 && now - lastActivity >= SECTOR_WAR_IDLE_TIMEOUT_MS) return { expired: true, reason: 'idle' };
    return { expired: false };
}

/** True while a contest still holds its sector and can take battles. */
export function isSectorWarActive(
    session: Pick<SectorWarSession, 'startedAt' | 'updatedAt' | 'flipped' | 'expiredAt'> | null | undefined,
    now: number,
): boolean {
    if (!session || session.flipped || session.expiredAt) return false;
    return !sectorWarExpiry(session, now).expired;
}

/** Stamp a lapsed contest so the record itself records the hold. Idempotent, pure —
 *  mirrors applyLazyClanWarExpiry, so the caller persists only when `changed`. */
export function applyLazySectorWarExpiry(
    session: SectorWarSession,
    now: number,
): { session: SectorWarSession; changed: boolean } {
    if (session.flipped || session.expiredAt) return { session, changed: false };
    const { expired, reason } = sectorWarExpiry(session, now);
    if (!expired) return { session, changed: false };
    return { session: { ...session, expiredAt: now, expiredReason: reason ?? 'timeout' }, changed: true };
}

/** End a siege on the attacking Kage's own order. Pure; idempotent. */
export function abandonSectorWar(session: SectorWarSession, now: number): { session: SectorWarSession; changed: boolean } {
    if (session.flipped || session.expiredAt) return { session, changed: false };
    return { session: { ...session, expiredAt: now, expiredReason: 'abandoned' }, changed: true };
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
    opts: { now: number; swing: number },
): SectorBattleOutcome | null {
    if (winner !== 'p1' && winner !== 'p2') return null; // draw → neither chip nor heal
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
    p1Name?: string;
    p2Name?: string;
    p1Village?: string;
    p2Village?: string;
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
    p1Name?: string;
    p2Name?: string;
    p1Village?: string;
    p2Village?: string;
    now: number;
}): SectorWarBattleToken {
    return {
        battleId: String(args.battleId),
        sectorWarId: String(args.sectorWarId),
        sector: clampInt(args.sector, 1, MAX_WILD_SECTOR),
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        registeredBy: args.registeredBy,
        winCondition: asWinCondition(args.winCondition),
        ...(args.p1Name ? { p1Name: args.p1Name } : {}),
        ...(args.p2Name ? { p2Name: args.p2Name } : {}),
        ...(args.p1Village ? { p1Village: args.p1Village } : {}),
        ...(args.p2Village ? { p2Village: args.p2Village } : {}),
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
        sector: clampInt(raw.sector, 1, MAX_WILD_SECTOR),
        attackerVillage: String(raw.attackerVillage),
        defenderVillage: String(raw.defenderVillage),
        registeredBy: String(raw.registeredBy ?? ''),
        winCondition: asWinCondition(raw.winCondition),
        ...(raw.p1Name ? { p1Name: String(raw.p1Name) } : {}),
        ...(raw.p2Name ? { p2Name: String(raw.p2Name) } : {}),
        ...(raw.p1Village ? { p1Village: String(raw.p1Village) } : {}),
        ...(raw.p2Village ? { p2Village: String(raw.p2Village) } : {}),
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
