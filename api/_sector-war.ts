/*
 * Village War Map — the sector-war contest model (pure). §17.2 / §17.6
 *
 * A sector war is a fixed **72-hour scored war** for ONE sector, separate from
 * the all-out village war (api/world-state.ts). The attacking Kage declares (WR
 * cost), and for the next 72 hours every resolved battle of the sector's
 * win-condition adds ROLE-WEIGHTED KILL POINTS to the winner's side — the tally
 * counts UP, unlike the village war's count-down HP. When the window closes, the
 * higher tally takes the sector: attacker ahead → the sector flips; defender
 * ahead OR TIED → the defence holds (holding ground must beat matching it).
 *
 * This replaced the Control-HP count-down siege (2026-08-06, owner decision).
 * The scheduled window is what fixes the old model's real flaw at a small
 * population: a continuous siege could open at 3am against nobody, needed
 * garrison/expiry/idle machinery to stay playable, and could resolve before the
 * defence ever logged in. A 72h window everyone can see turns a war into an
 * event both villages can actually show up to.
 *
 * Persistent ownership is `world:territory:<sector>.ownerVillage` (the field
 * map-control and the WR faucet read); the flip happens at SETTLEMENT
 * (api/_sector-war-settle.ts), never mid-war.
 *
 * This module is the pure heart: the session shape, its normalizer, the scoring
 * transform a resolved battle applies, and settlement. IO-free.
 */

import { WIN_CONDITIONS, type WinCondition } from './_war-state.js';
import { SECTOR_WAR_WR, discountedWrCost } from './_war-economy.js';
import { homeVillageForSector, isWarVillage, isWarSector, isProtectedWarSector } from './_war-map-sectors.js';
import { MAX_WILD_SECTOR } from '../shared/sector-geo.js';
import { PVP_TERMINAL_REPLAY_TTL, SESSION_TTL } from './combat-core/constants.js';
import {
    warDeclarationFundingMarkerFromRow,
    type WarDeclarationFundingMarker,
} from './_war-declaration-funding.js';

/** How long a sector war runs. Fixed and visible to both sides from declare. */
export const SECTOR_WAR_DURATION_MS = 72 * 60 * 60 * 1000;

export interface SectorWarSession {
    /** stable id: `<sector>:<attackerSlug>-vs-<defenderSlug>` */
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    /** the defender's chosen contest type for this sector */
    winCondition: WinCondition;
    /** Kill-point tallies. Count UP; compared at settlement. */
    attackerPoints: number;
    defenderPoints: number;
    startedAt: number;
    /** startedAt + SECTOR_WAR_DURATION_MS — battles after this score nothing. */
    endsAt: number;
    updatedAt: number;
    /** Monotonic per contest identity. Keeps permanent debit receipts distinct
     * across re-sieges after an earlier record's cooldown has elapsed. */
    declarationGeneration?: number;
    /** Server-owned row-first declaration funding state. Rows carrying this
     * field are not playable until its strict marker is `active`. */
    declarationFunding?: WarDeclarationFundingMarker;
    /** true once SETTLEMENT awarded the sector to the attacker. */
    flipped: boolean;
    /** Set when the war ended WITHOUT a flip — the defender held (or the attacker
     *  conceded). Once set the contest is inert. */
    expiredAt?: number;
    expiredReason?: SectorWarExpiryReason;
    /** When a LIVE-player battle last resolved. Drives the garrison fallback:
     *  distinct from `updatedAt`, which AI battles refresh too. */
    lastLiveBattleAt?: number;
    /** Durable receipts for every scored battle (idempotence, the garrison cap,
     *  and the settlement capture credit). */
    appliedBattles?: SectorWarBattleReceipt[];
}

/** Why a war ended without the attacker taking the sector. */
export type SectorWarExpiryReason =
    /** The 72h window closed with the defender ahead or tied. */
    | 'defended'
    /** The attacking Kage called it off. */
    | 'abandoned';

export interface SectorWarBattleReceipt {
    battleId: string;
    attackerWon: boolean;
    /** Points this battle awarded (after fractions and caps). */
    points: number;
    /** Winner's canonical name — feeds the settlement capture credit. '' for AI. */
    by: string;
    /** True when the points came from a garrison assault (feeds the garrison cap). */
    garrison?: boolean;
    at: number;
}

export const SECTOR_WAR_BATTLE_RECEIPT_CAP = 200;

function parseSectorWarBattleReceipts(raw: unknown): SectorWarBattleReceipt[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > SECTOR_WAR_BATTLE_RECEIPT_CAP) {
        throw new Error('sector-war-battle-receipt-ledger-invalid');
    }
    const out: SectorWarBattleReceipt[] = [];
    const ids = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('sector-war-battle-receipt-ledger-invalid');
        }
        const value = entry as Record<string, unknown>;
        const allowed = new Set([
            'battleId', 'attackerWon', 'points', 'by', 'garrison', 'at',
            // Pre-scored-model receipt fields retained for bounded migration.
            'hpDealt', 'hpRegen',
        ]);
        if (Object.keys(value).some((key) => !allowed.has(key))) {
            throw new Error('sector-war-battle-receipt-ledger-invalid');
        }
        const battleId = typeof value.battleId === 'string' ? value.battleId.trim() : '';
        const currentShape = value.points !== undefined;
        const legacyShape = !currentShape && (value.hpDealt !== undefined || value.hpRegen !== undefined);
        const points = currentShape
            ? Number(value.points)
            : Number(value.hpDealt ?? 0) + Number(value.hpRegen ?? 0);
        if (!battleId
            || ids.has(battleId)
            || typeof value.attackerWon !== 'boolean'
            || (!currentShape && !legacyShape)
            || !Number.isSafeInteger(points)
            || points < 0
            || (currentShape && (value.hpDealt !== undefined || value.hpRegen !== undefined))
            || (value.by !== undefined && typeof value.by !== 'string')
            || (value.garrison !== undefined && value.garrison !== true)
            || !Number.isSafeInteger(value.at)
            || Number(value.at) <= 0) {
            throw new Error('sector-war-battle-receipt-ledger-invalid');
        }
        ids.add(battleId);
        out.push({
            battleId,
            attackerWon: value.attackerWon,
            points,
            by: typeof value.by === 'string' ? value.by : '',
            ...(value.garrison === true ? { garrison: true } : {}),
            at: Number(value.at),
        });
    }
    return out;
}

// ── Score caps (anti-farm) ─────────────────────────────────────────────────────
// Player scoring is deliberately UNCAPPED (owner ruling 2026-08-07 — a
// per-player cap benched Kage/Elder duels, the fights that should matter most).
// A colluding pair trading real kills for 72 hours is the accepted trade-off;
// the receipts still make every battle single-count, and each fight needs a
// real cross-village session behind the rate limits. Only the AI is capped:
/** Max points the GARRISON may yield an attacker across the whole war. Enough
 *  that a defence which never shows up loses decisively (defender 0 < garrison
 *  lead) — ~30 villager kills' worth (raised 50 → 150, owner tuning 2026-08-07).
 *  A defence that shows up can still outscore it: repelled attackers and merc
 *  repels pay the defender full/quarter weight with no cap. */
export const GARRISON_POINTS_CAP = 150;
/** Garrison kills score at half weight — live defence stays the better target. */
export const GARRISON_POINTS_FRACTION = 0.5;
/** Repelling an AI mercenary scores the defender a quarter weight (lower stakes
 *  than beating a real raider). */
export const MERC_REPEL_POINTS_FRACTION = 0.25;

function clampInt(n: unknown, lo: number, hi: number): number {
    const v = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, v));
}
function nonNeg(n: unknown): number {
    return Math.max(0, Math.floor(Number(n) || 0));
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

/** A fresh 72-hour war at 0 : 0. */
export function newSectorWarSession(args: {
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: WinCondition;
    now: number;
}): SectorWarSession {
    return {
        id: sectorWarId(args.sector, args.attackerVillage, args.defenderVillage),
        sector: clampInt(args.sector, 1, MAX_WILD_SECTOR),
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        winCondition: asWinCondition(args.winCondition),
        attackerPoints: 0,
        defenderPoints: 0,
        startedAt: args.now,
        endsAt: args.now + SECTOR_WAR_DURATION_MS,
        updatedAt: args.now,
        flipped: false,
    };
}

/** Normalize a session loaded from storage.
 *
 * MIGRATION: a record written under the retired Control-HP model (has
 * `controlHp`/`controlHpMax`, no `endsAt`) converts in place — the damage the
 * attacker had already dealt becomes their score, the defender starts at 0, and
 * the 72h clock runs from the original start. Its legacy receipts keep their
 * battleIds (replay-idempotence) with points mapped from the old hp fields and
 * an empty `by` (attribution wasn't recorded under the old model). */
export function normalizeSectorWarSession(raw: Partial<SectorWarSession> & {
    controlHp?: unknown; controlHpMax?: unknown;
}): SectorWarSession | null {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.attackerVillage || !raw.defenderVillage || raw.attackerVillage === raw.defenderVillage) return null;
    const hasFundingMarker = Object.prototype.hasOwnProperty.call(raw, 'declarationFunding');
    const declarationFunding = hasFundingMarker ? warDeclarationFundingMarkerFromRow(raw) : null;
    // A malformed server-owned funding marker must never be normalized back
    // into a playable legacy contest.
    if (hasFundingMarker && !declarationFunding) return null;
    const startedAt = Math.floor(Number(raw.startedAt) || 0);
    const legacy = raw.endsAt === undefined && raw.controlHpMax !== undefined;
    const legacyDamage = legacy
        ? Math.max(0, nonNeg(raw.controlHpMax) - nonNeg(raw.controlHp))
        : 0;
    const appliedBattles = parseSectorWarBattleReceipts(raw.appliedBattles);
    const legacyReason = raw.expiredReason as unknown;
    return {
        id: String(raw.id ?? sectorWarId(Number(raw.sector) || 0, raw.attackerVillage, raw.defenderVillage)),
        sector: clampInt(raw.sector, 1, MAX_WILD_SECTOR),
        attackerVillage: String(raw.attackerVillage),
        defenderVillage: String(raw.defenderVillage),
        winCondition: asWinCondition(raw.winCondition),
        attackerPoints: legacy ? legacyDamage : nonNeg(raw.attackerPoints),
        defenderPoints: nonNeg(raw.defenderPoints),
        startedAt,
        endsAt: raw.endsAt !== undefined ? Math.floor(Number(raw.endsAt) || 0) : startedAt + SECTOR_WAR_DURATION_MS,
        updatedAt: Math.floor(Number(raw.updatedAt) || 0),
        ...(Number.isSafeInteger(Number(raw.declarationGeneration)) && Number(raw.declarationGeneration) > 0
            ? { declarationGeneration: Math.floor(Number(raw.declarationGeneration)) }
            : {}),
        ...(declarationFunding ? { declarationFunding } : {}),
        flipped: raw.flipped === true,
        ...(Number(raw.expiredAt) > 0
            ? {
                expiredAt: Math.floor(Number(raw.expiredAt)),
                // Legacy 'idle'/'timeout' records read as defended holds.
                expiredReason: (legacyReason === 'abandoned' ? 'abandoned' : 'defended') as SectorWarExpiryReason,
            }
            : {}),
        ...(Number(raw.lastLiveBattleAt) > 0 ? { lastLiveBattleAt: Math.floor(Number(raw.lastLiveBattleAt)) } : {}),
        ...(appliedBattles.length ? { appliedBattles } : {}),
    };
}

/** True while the war is running and battles can still score. */
export function isSectorWarActive(
    session: Pick<SectorWarSession, 'flipped' | 'expiredAt' | 'startedAt' | 'endsAt' | 'declarationFunding'> | null | undefined,
    now: number,
): boolean {
    if (!session || session.flipped || session.expiredAt) return false;
    if (session.declarationFunding && session.declarationFunding.status !== 'active') return false;
    return now >= Math.floor(Number(session.startedAt) || 0)
        && now < Math.floor(Number(session.endsAt) || 0);
}

// ── Scoring ────────────────────────────────────────────────────────────────────

export interface SectorBattleOutcome {
    session: SectorWarSession;
    /** Points actually awarded (after fractions and caps; 0 when fully capped). */
    awarded: number;
    /** Which tally the points landed on. */
    side: 'attacker' | 'defender' | 'none';
}

export function findSectorWarBattleReceipt(session: SectorWarSession, battleId: string): SectorWarBattleReceipt | null {
    return session.appliedBattles?.find((entry) => entry.battleId === battleId) ?? null;
}

/** Points the garrison has already yielded in this war (garrison cap input). */
export function garrisonPointsInWar(session: SectorWarSession): number {
    return (session.appliedBattles ?? [])
        .filter((r) => r.garrison)
        .reduce((sum, r) => sum + nonNeg(r.points), 0);
}

/**
 * Score one resolved battle. §17.6 (72h scored model)
 *
 * `roleSwing` is the raw kill value from the rank ladder (api/_war-role
 * sectorControlSwing with NO structure multiplier — winner.win + loser.loss).
 * Structure multipliers ride per SIDE: the attacker's War Academy boosts attacker
 * points, the defender's Watchtower boosts defender points. UNCAPPED per fight —
 * with no HP bar to one-shot, a villager felling the enemy Kage scoring the full
 * 55 is the point (leadership kills are bounties, fielding leadership is a risk).
 *
 * Fractions and caps (AI only — player scoring is uncapped, see the Score caps
 * note above):
 *   · garrisonBattle → GARRISON_POINTS_FRACTION, then the war-wide GARRISON cap.
 *   · mercBattle + defender win → MERC_REPEL_POINTS_FRACTION.
 *
 * A terminal or past-end session scores nothing. A live-player battle refreshes
 * `lastLiveBattleAt` (re-locks the garrison); AI battles refresh `updatedAt` only.
 * Pure — the caller persists.
 */
export function applySectorWarBattle(
    session: SectorWarSession,
    attackerWon: boolean,
    opts: {
        now: number;
        roleSwing: number;
        attackerMult?: number;
        defenderMult?: number;
        by?: string;
        garrisonBattle?: boolean;
        mercBattle?: boolean;
    },
): SectorBattleOutcome {
    if (session.flipped || session.expiredAt || opts.now >= session.endsAt) {
        return { session, awarded: 0, side: 'none' };
    }
    const aiBattle = !!opts.mercBattle || !!opts.garrisonBattle;
    const next: SectorWarSession = {
        ...session,
        updatedAt: opts.now,
        ...(aiBattle ? {} : { lastLiveBattleAt: opts.now }),
    };

    const sideMult = attackerWon
        ? Math.max(0, Number(opts.attackerMult ?? 1) || 1)
        : Math.max(0, Number(opts.defenderMult ?? 1) || 1);
    let points = Math.round(nonNeg(opts.roleSwing) * sideMult);
    if (opts.garrisonBattle && attackerWon) {
        points = Math.floor(points * GARRISON_POINTS_FRACTION);
        points = Math.min(points, Math.max(0, GARRISON_POINTS_CAP - garrisonPointsInWar(session)));
    }
    if (opts.mercBattle && !attackerWon) {
        points = Math.floor(points * MERC_REPEL_POINTS_FRACTION);
    }
    if (points <= 0) return { session: next, awarded: 0, side: 'none' };

    if (attackerWon) next.attackerPoints = session.attackerPoints + points;
    else next.defenderPoints = session.defenderPoints + points;
    return { session: next, awarded: points, side: attackerWon ? 'attacker' : 'defender' };
}

/** Map a finished win-condition battle by WINNER SIDE onto the war, where p1 is
 *  the attacker side and p2 the defender side (the card/pet sessions enforce
 *  that). Draw → nothing scores (returns null). */
export function applyContestBattleByWinner(
    session: SectorWarSession,
    winner: 'p1' | 'p2' | 'draw',
    opts: { now: number; roleSwing: number; attackerMult?: number; defenderMult?: number; by?: string },
): SectorBattleOutcome | null {
    if (winner !== 'p1' && winner !== 'p2') return null;
    return applySectorWarBattle(session, winner === 'p1', opts);
}

export function recordSectorWarBattleOutcome(
    outcome: SectorBattleOutcome,
    args: { battleId: string; attackerWon: boolean; by?: string; garrison?: boolean; at: number },
): { session: SectorWarSession; receipt: SectorWarBattleReceipt } {
    const prior = findSectorWarBattleReceipt(outcome.session, args.battleId);
    if (prior) return { session: outcome.session, receipt: prior };
    const receipts = outcome.session.appliedBattles ?? [];
    if (receipts.length >= SECTOR_WAR_BATTLE_RECEIPT_CAP) {
        // This ledger is settlement authority, not presentation history. Never
        // evict an unacknowledged battle proof: a crash before the external
        // receipt would otherwise allow that battle to score again after churn.
        throw new Error('sector-war-battle-receipt-ledger-full');
    }
    const receipt: SectorWarBattleReceipt = {
        battleId: args.battleId,
        attackerWon: args.attackerWon,
        points: outcome.awarded,
        by: String(args.by ?? '').trim(),
        ...(args.garrison ? { garrison: true } : {}),
        at: args.at,
    };
    return {
        session: {
            ...outcome.session,
            appliedBattles: [receipt, ...receipts],
        },
        receipt,
    };
}

/** The session as the CLIENT sees it: everything except `appliedBattles`. The
 *  receipt ledger is server bookkeeping (idempotence + the score caps) — up to
 *  200 rows the war-map's 15s poll would otherwise ship to every viewer, with
 *  per-player attribution nobody renders. Keep responses on this projection;
 *  never return a raw session. Pure. */
export function projectSectorWarForClient(session: SectorWarSession): Omit<SectorWarSession, 'appliedBattles' | 'declarationFunding'> {
    const { appliedBattles: _receipts, declarationFunding: _funding, ...view } = session;
    return view;
}

// ── Settlement ─────────────────────────────────────────────────────────────────

/**
 * Settle a war whose 72 hours are up. Attacker STRICTLY ahead → the sector flips;
 * defender ahead OR TIED → the defence held (holding ground beats matching it).
 * The territory flip itself is IO and lives in api/_sector-war-settle.ts — this
 * only stamps the verdict. Idempotent; a still-running war is untouched. Pure.
 */
export function settleSectorWar(
    session: SectorWarSession,
    now: number,
): { session: SectorWarSession; changed: boolean; attackerWon: boolean } {
    if (session.flipped) return { session, changed: false, attackerWon: true };
    if (session.expiredAt) return { session, changed: false, attackerWon: false };
    if (now < session.endsAt) return { session, changed: false, attackerWon: false };
    // The declaration guard prevents new attacks on another village's gate, but
    // a contest created before that rule shipped can still be due for settlement.
    // Re-assert the permanent-gate invariant here so a legacy/live row cannot
    // capture a protected core after deployment.
    const protectedFromAttacker = isProtectedWarSector(session.sector)
        && homeVillageForSector(session.sector) !== session.attackerVillage;
    const attackerWon = !protectedFromAttacker && session.attackerPoints > session.defenderPoints;
    const next: SectorWarSession = attackerWon
        ? { ...session, flipped: true, updatedAt: now }
        : { ...session, expiredAt: now, expiredReason: 'defended', updatedAt: now };
    return { session: next, changed: true, attackerWon };
}

/** End a war early on the attacking Kage's own order — a concession; the
 *  defender holds regardless of the score. Pure; idempotent. */
export function abandonSectorWar(session: SectorWarSession, now: number): { session: SectorWarSession; changed: boolean } {
    if (session.flipped || session.expiredAt) return { session, changed: false };
    return { session: { ...session, expiredAt: now, expiredReason: 'abandoned', updatedAt: now }, changed: true };
}

// ── Garrison fallback (the liveness gap) ──────────────────────────────────────
/*
 * Every win-condition needs a live ONLINE enemy: Combat needs a real two-fighter
 * PvP session, Card is interactive, Pet needs the defender to answer, and even a
 * mercenary may only be aimed at a defending-village member. If the defence never
 * logs in during the 72 hours, the attacker would be unable to score AT ALL — and
 * a 0:0 tie is a defender hold, so a wholly absent defence would keep its sector.
 *
 * So when the defence stops turning up, what remains is the sector's GARRISON — a
 * server-built AI defence the attacker can beat for (capped, half-weight) points.
 * The unlock keys off `lastLiveBattleAt`, NOT `updatedAt`: a garrison assault is
 * still a battle and refreshes `updatedAt`, but it must not refresh the LIVE
 * clock, or one assault would re-lock the garrison for another two hours. The
 * moment a real defender fights, the live clock moves and the garrison locks —
 * a village that shows up to defend never faces the fallback at all.
 */

/** How long a war must go without a LIVE-player battle before the defending
 *  sector's garrison can be assaulted. */
export const GARRISON_UNLOCK_IDLE_MS = 2 * 60 * 60 * 1000;

/** Whether the sector's garrison is currently assaultable. Pure. */
export function isGarrisonAssaultable(
    session: Pick<SectorWarSession, 'startedAt' | 'flipped' | 'expiredAt' | 'endsAt' | 'lastLiveBattleAt' | 'winCondition'>,
    now: number,
): boolean {
    // Only the Combat win-condition has a garrison — Card and Pet are contests of
    // decks and standing orders, which an AI holding ground does not field.
    if (session.winCondition !== 'combat') return false;
    if (!isSectorWarActive(session, now)) return false;
    const lastLive = Math.max(
        Math.floor(Number(session.lastLiveBattleAt) || 0),
        Math.floor(Number(session.startedAt) || 0),
    );
    return lastLive > 0 && now - lastLive >= GARRISON_UNLOCK_IDLE_MS;
}

// ── Storage keys ──
/** The persistent scored-war record for a contest. */
export function sectorWarKey(id: string): string {
    return `shared:sector-war:${id}`;
}

/**
 * Lock scope for OPENING a contest on a sector.
 *
 * Keyed on the SECTOR, deliberately — not on the contest id. A contest id embeds
 * the attacker slug (`<sector>:<attacker>-vs-<defender>`), so two different
 * villages declaring on the same sector take two DIFFERENT contest locks and both
 * pass the one-contest-per-sector check, which is only a pre-check outside any
 * lock. This key is what makes every would-be attacker on a sector serialize.
 */
export function sectorDeclareLockKey(sector: number): string {
    return `sector-war-declare:${clampInt(sector, 1, MAX_WILD_SECTOR)}`;
}

// ── Single-use battle token (Combat) ──────────────────────────────────────────

// Match the terminal PvP recovery horizon: either participant may be the first
// one to help-forward the sector continuation after a long offline period.
// A token is minted at session registration but first resolution may happen at
// the very end of the active-session horizon, followed by the full terminal
// recovery window. Never expire the sealed contest binding before that point.
export const SECTOR_WAR_TOKEN_TTL_MS = (SESSION_TTL + PVP_TERMINAL_REPLAY_TTL) * 1000;

export interface SectorWarBattleToken {
    version: 2;
    battleId: string;
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    registeredBy: string;
    winCondition: WinCondition;
    p1Name: string;
    p2Name: string;
    p1Village: string;
    p2Village: string;
    /** Defender terrain sealed at the first exact registration. */
    biome: string;
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
    p1Name: string;
    p2Name: string;
    p1Village: string;
    p2Village: string;
    biome: string;
    now: number;
}): SectorWarBattleToken {
    return {
        version: 2,
        battleId: args.battleId,
        sectorWarId: args.sectorWarId,
        sector: args.sector,
        attackerVillage: args.attackerVillage,
        defenderVillage: args.defenderVillage,
        registeredBy: args.registeredBy,
        winCondition: asWinCondition(args.winCondition),
        p1Name: args.p1Name,
        p2Name: args.p2Name,
        p1Village: args.p1Village,
        p2Village: args.p2Village,
        biome: args.biome,
        createdAt: args.now,
        expiresAt: args.now + SECTOR_WAR_TOKEN_TTL_MS,
    };
}

export function normalizeSectorWarBattleToken(raw: Partial<SectorWarBattleToken>): SectorWarBattleToken | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const currentKeys = [
        'version', 'battleId', 'sectorWarId', 'sector', 'attackerVillage',
        'defenderVillage', 'registeredBy', 'winCondition', 'p1Name', 'p2Name',
        'p1Village', 'p2Village', 'biome', 'createdAt', 'expiresAt',
    ].sort().join('|');
    // Rolling-deploy compatibility: legacy tokens remain bound to their
    // immutable PvP row, whose existing session biome is the sealed terrain.
    const legacyKeys = [
        'battleId', 'sectorWarId', 'sector', 'attackerVillage', 'defenderVillage',
        'registeredBy', 'winCondition', 'p1Name', 'p2Name', 'p1Village',
        'p2Village', 'createdAt', 'expiresAt',
    ].sort().join('|');
    const keys = Object.keys(value).sort().join('|');
    const current = value.version === 2 && keys === currentKeys;
    const legacy = value.version === undefined && keys === legacyKeys;
    const sector = Number(value.sector);
    const createdAt = Number(value.createdAt);
    const expiresAt = Number(value.expiresAt);
    if ((!current && !legacy)
        || typeof value.battleId !== 'string' || !value.battleId.trim()
        || typeof value.sectorWarId !== 'string' || !value.sectorWarId.trim()
        || !Number.isSafeInteger(sector) || sector < 1 || sector > MAX_WILD_SECTOR
        || typeof value.attackerVillage !== 'string' || !value.attackerVillage.trim()
        || typeof value.defenderVillage !== 'string' || !value.defenderVillage.trim()
        || value.attackerVillage === value.defenderVillage
        || typeof value.registeredBy !== 'string' || !value.registeredBy.trim()
        || value.winCondition !== 'combat'
        || typeof value.p1Name !== 'string' || !value.p1Name.trim()
        || typeof value.p2Name !== 'string' || !value.p2Name.trim()
        || typeof value.p1Village !== 'string' || !value.p1Village.trim()
        || typeof value.p2Village !== 'string' || !value.p2Village.trim()
        || value.p1Village === value.p2Village
        || (current && (typeof value.biome !== 'string' || !value.biome.trim()))
        || !Number.isSafeInteger(createdAt) || createdAt <= 0
        || !Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) return null;
    return {
        version: 2,
        battleId: value.battleId.trim(),
        sectorWarId: value.sectorWarId.trim(),
        sector,
        attackerVillage: value.attackerVillage.trim(),
        defenderVillage: value.defenderVillage.trim(),
        registeredBy: value.registeredBy.trim(),
        winCondition: 'combat',
        p1Name: value.p1Name.trim(),
        p2Name: value.p2Name.trim(),
        p1Village: value.p1Village.trim(),
        p2Village: value.p2Village.trim(),
        biome: current ? String(value.biome).trim() : '',
        createdAt,
        expiresAt,
    };
}

// ── The declare gate ──────────────────────────────────────────────────────────

export type SectorWarDeclineReason =
    | 'self'
    | 'not-war-village'
    | 'not-war-sector'
    | 'protected-core'
    | 'not-enemy-held'
    | 'mutual-exclusion-attacker'
    | 'mutual-exclusion-defender'
    | 'already-contested'
    | 'siege-limit'
    | 'siege-cooldown'
    | 'win-condition-unavailable'
    | 'insufficient-wr';

/**
 * How many wars one village may be ATTACKING at once.
 *
 * Without this cap the total cost of conquest collapsed: the WR pool banks to
 * 5,000, a declare is 250, so a village could open wars on ALL 8 enemy home
 * sectors at once. Two concurrent fronts keeps multi-sector pressure a real
 * strategy while making full conquest a CAMPAIGN of sequential wars the defence
 * can wake up to, not a single burst.
 */
export const MAX_ACTIVE_ATTACK_SIEGES = 2;

/** After a FAILED war (defended or called off — not a capture), the same
 *  attacker cannot re-declare on that sector until the stamped record ages out.
 *  This is also the TTL those terminal records carry, so the lingering record IS
 *  the cooldown clock — no extra key. Mirrors the village war's rematch
 *  cooldown, scaled to the sector war's shorter rhythm. */
export const SECTOR_RESIEGE_COOLDOWN_SEC = 24 * 60 * 60;

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
    /** an active contest already exists for this sector */
    contestAlreadyActive: boolean;
    attackerWr: number;
    attackerSectorsHeld: number;
    /** Wars this village is ALREADY attacking (MAX_ACTIVE_ATTACK_SIEGES cap). */
    attackerActiveSieges?: number;
    /** A prior FAILED war by this attacker on this sector is still in cooldown. */
    priorFailedSiegeActive?: boolean;
    allowedWinConditions?: readonly WinCondition[];
}

export type SectorWarDeclareResult =
    | { ok: true; cost: number }
    | { ok: false; error: SectorWarDeclineReason; cost?: number };

export function canDeclareSectorWar(c: SectorWarDeclareCheck): SectorWarDeclareResult {
    const attacker = String(c.attackerVillage);
    const defender = String(c.defenderVillage);
    if (!attacker || !defender || attacker === defender) return { ok: false, error: 'self' };
    if (!isWarVillage(attacker) || !isWarVillage(defender)) return { ok: false, error: 'not-war-village' };
    if (!isWarSector(c.sector)) return { ok: false, error: 'not-war-sector' };
    if (isProtectedWarSector(c.sector) && homeVillageForSector(c.sector) !== attacker) {
        return { ok: false, error: 'protected-core' };
    }
    if (String(c.sectorOwnerVillage) !== defender) return { ok: false, error: 'not-enemy-held' };
    if (c.attackerInActiveVillageWar) return { ok: false, error: 'mutual-exclusion-attacker' };
    if (c.defenderInActiveVillageWar) return { ok: false, error: 'mutual-exclusion-defender' };
    if (c.contestAlreadyActive) return { ok: false, error: 'already-contested' };
    if (Math.floor(Number(c.attackerActiveSieges) || 0) >= MAX_ACTIVE_ATTACK_SIEGES) return { ok: false, error: 'siege-limit' };
    if (c.priorFailedSiegeActive) return { ok: false, error: 'siege-cooldown' };
    const allowed = c.allowedWinConditions ?? (['combat'] as readonly WinCondition[]);
    if (!allowed.includes(c.winCondition)) return { ok: false, error: 'win-condition-unavailable' };
    const cost = discountedWrCost(SECTOR_WAR_WR, c.attackerSectorsHeld);
    if (Math.floor(Number(c.attackerWr) || 0) < cost) return { ok: false, error: 'insufficient-wr', cost };
    return { ok: true, cost };
}
