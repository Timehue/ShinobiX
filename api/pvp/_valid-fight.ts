/*
 * One valid-fight rule set for every PvP payout (2026-10 rebalance, framework
 * section 2.8, items I-3 / I-4 / I-17 / #2 / #22 / #23).
 *
 * A PvP win pays the purse 13.5 x A(lower level) x PVP_PURSE_SCALE; a loss pays
 * 0.4 of that when the loser really fought. What keeps it from being farmed:
 *
 *   - the lower fighter's level sets the purse, so an alt pays alt money;
 *   - a winner more than 20 levels up, or a loser under 72 h old and below L20, earns nothing;
 *   - one UNORDERED pair counter per UTC day weights the pair's fights
 *     1 / 1 / 0.5 / 0.25 / 0, so two accounts mint at most 2.75 fights' worth
 *     from each other a day however they alternate wins;
 *   - under 3 completed rounds or 60 s, a KO or round-cap win pays half and a
 *     flee or AFK win pays nothing; the loser is paid only for an engaged fight.
 *
 * There is no daily fight allowance (owner, 2026-10-21): every valid fight pays.
 * Aura Dust, jutsu mastery and Vanguard XP scale by the same factor as the ryo,
 * so a fight that pays no ryo pays no side reward either.
 *
 * The counters are ephemeral KV rows with a TTL, never save fields, and they
 * fail open: a storage hiccup prices the fight as the pair's first.
 */

import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { economyDial, economySwitch } from '../_economy-dials.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import { strongholdPvpRewardMultiplier } from '../../shared/sector-stronghold.js';
import { MAX_ROUNDS } from '../combat-core/constants.js';
import { pvpSessionHp } from './_low-level-hp.js';
import { ACCOUNT_AGE_MIN_MS, PVP_CREDIT_LEVEL_GAP_MAX } from './_pvp-anti-alt.js';
import type { PvpSession } from './session.js';

// ── Fixed rules ──────────────────────────────────────────────────────────────

/** The full purse multiple of A(L); PVP_PURSE_SCALE (1 at launch, owner A13) can only lower it. */
export const PVP_WIN_A_MULT_FULL = 13.5;
/** Today's flat purse, paid while PVP_PURSE_SCALE is 0 (the kill switch). */
export const PVP_LEGACY_WIN_RYO = 75;
/** Flat bonus for the winner's active Lucky pet (legacy 90 = 75 + 15). */
export const PVP_LUCKY_BONUS_RYO = 15;
export const PVP_WIN_AURA_DUST = 6;
/** Same-pair fights in one UTC day, by ordinal; the 5th and later pay 0. */
export const PVP_PAIR_WEIGHTS = [1, 1, 0.5, 0.25] as const;
/** Loser damage, as a share of the winner's max HP, that counts as engaging. */
export const PVP_LOSS_MIN_DAMAGE_FRAC = 0.15;
/** A sleeping-camp KO is not a fight: it pays a quarter of the purse. */
export const PVP_SLEEPER_PURSE_FRAC = 0.25;
/** Day counters: the 48 h claim window, plus the day itself and slack. */
export const PVP_COUNTER_TTL_SECONDS = 74 * 60 * 60;
/** Per-fight slot memo: outlives the 48 h claim window. */
export const PVP_SLOT_TTL_SECONDS = 50 * 60 * 60;
/** Jutsu mastery rows at Lv40-49 earn this per valid fight when PVP_MASTERY_40_49 is on (#23). */
export const PVP_MASTERY_40_49_XP = { win: 60, loss: 30 } as const;
export const PVP_MASTERY_BASE_XP = { win: 10, loss: 0 } as const;

// ── Dials (framework 8.3; env read at call time, invalid values fall back) ────

/** PVP_PURSE_SCALE (default 1, range 0-1): the PvP and stronghold purse at full pay from launch
 *  (owner amendment A13, 2026-10-22). The env var is only an emergency down switch;
 *  0 = the legacy 75 flat, no loss pay. */
export function pvpPurseScale(): number {
    return economyDial('PVP_PURSE_SCALE', 1, { min: 0, max: 1 });
}
/** PVP_LOSS_FRAC (default 0.4, range 0-0.4): loss pay as a share of the win purse. */
export function pvpLossFrac(): number {
    return economyDial('PVP_LOSS_FRAC', 0.4, { min: 0, max: 0.4 });
}
/** PVP_MIN_ROUNDS (default 3, range 0-25): completed rounds for full credit. */
export function pvpMinRounds(): number {
    return Math.floor(economyDial('PVP_MIN_ROUNDS', 3, { min: 0, max: MAX_ROUNDS }));
}
/** PVP_MIN_FIGHT_MS (default 60,000, range 0-600,000): fight length for full credit. */
export function pvpMinFightMs(): number {
    return economyDial('PVP_MIN_FIGHT_MS', 60_000, { min: 0, max: 600_000 });
}
/** PVP_SHORT_FIGHT_MULT (default 0.5, range 0-1): a short KO or round-cap win's share. */
export function pvpShortFightMult(): number {
    return economyDial('PVP_SHORT_FIGHT_MULT', 0.5, { min: 0, max: 1 });
}
/** PVP_LOSER_MIN_AGE_MS (default 72 h, range 0-72 h). Accounts at PVP_ESTABLISHED_LEVEL skip it, so a reset needs no env change. */
export function pvpMinAccountAgeMs(): number {
    return economyDial('PVP_LOSER_MIN_AGE_MS', ACCOUNT_AGE_MIN_MS, { min: 0, max: ACCOUNT_AGE_MIN_MS });
}
/** PVP_MASTERY_40_49 (default on): Lv40-49 mastery rows earn 60 / 30 per valid fight. */
export function pvpMastery4049Enabled(): boolean {
    return economySwitch('PVP_MASTERY_40_49', true);
}
/** PVP_RANKED_PURSE (default off): ranked V2 pays the purse under the same pair weights. Data-gated (framework 8.2 Phase 2). */
export function pvpRankedPurseEnabled(): boolean {
    return economySwitch('PVP_RANKED_PURSE', false);
}

// ── Purse ────────────────────────────────────────────────────────────────────

/** Floor a payout, absorbing binary-fraction error (0.4 x 2025 must be 810). */
function floorPay(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value + 1e-9) : 0;
}

function fightLevel(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Stronghold multiplier for the purse in force: the anchored 1.25 / 1.5, or the legacy 2 / 4 on the 75 flat. */
export function pvpStrongholdMult(sector: unknown, rewardStronghold?: unknown): number {
    return strongholdPvpRewardMultiplier(sector, rewardStronghold, pvpPurseScale() > 0);
}

export function pvpLuckyActive(character: Record<string, unknown> | null | undefined): boolean {
    const pets = Array.isArray(character?.pets) ? character!.pets as Array<Record<string, unknown>> : [];
    const active = pets.find((pet) => pet && pet.id === character?.activePetId);
    return active?.trait === 'Lucky';
}

export type PvpPurseInput = { lMin: number; lucky?: boolean; sector?: unknown; stronghold?: unknown };

/** The full win purse before any credit factor. */
export function pvpWinPurse(o: PvpPurseInput): number {
    const scale = pvpPurseScale();
    const lucky = o.lucky ? PVP_LUCKY_BONUS_RYO : 0;
    if (scale <= 0) {
        return floorPay((PVP_LEGACY_WIN_RYO + lucky) * strongholdPvpRewardMultiplier(o.sector, o.stronghold));
    }
    const base = floorPay(PVP_WIN_A_MULT_FULL * scale * anchorRyoPerMinute(fightLevel(o.lMin)));
    return floorPay((base + lucky) * strongholdPvpRewardMultiplier(o.sector, o.stronghold, true));
}

/** The full loss purse before any credit factor: 0 while the purse is on the 75 flat. */
export function pvpLossPurse(o: PvpPurseInput): number {
    const scale = pvpPurseScale();
    const frac = pvpLossFrac();
    if (scale <= 0 || frac <= 0) return 0;
    const base = floorPay(PVP_WIN_A_MULT_FULL * scale * anchorRyoPerMinute(fightLevel(o.lMin)));
    return floorPay(floorPay(frac * base) * strongholdPvpRewardMultiplier(o.sector, o.stronghold, true));
}

/** Weight of the pair's Nth fight today (1-based). Invalid ordinals fail open to 1. */
export function pvpPairWeight(ordinal: number): number {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) return 1;
    return PVP_PAIR_WEIGHTS[ordinal - 1] ?? 0;
}

// ── Fight classification ─────────────────────────────────────────────────────

export type PvpTerminalKind = 'ko' | 'round-cap' | 'flee' | 'afk' | 'unknown';
export type PvpTerminalClass = {
    kind: PvpTerminalKind;
    completedRounds: number;
    durationMs: number;
    short: boolean;
};

type Side = 'p1' | 'p2';
function otherSide(side: Side): Side { return side === 'p1' ? 'p2' : 'p1'; }
function winnerSideOf(session: Pick<PvpSession, 'winner'>): Side | null {
    return session.winner === 'p1' || session.winner === 'p2' ? session.winner : null;
}

/**
 * How a decided fight ended, from sealed session fields only. A row with no
 * round counter (sealed before rounds existed, or a test fixture) cannot be
 * judged and keeps full credit, like a missing createdAt in the age rule;
 * every live session is created at round 1.
 */
export function classifyPvpTerminal(session: PvpSession, terminalAt?: number): PvpTerminalClass {
    const end = Number(session.endedAt) || Number(terminalAt);
    const created = Number(session.createdAt);
    const durationMs = Number.isFinite(end) && Number.isFinite(created) && created > 0
        ? Math.max(0, end - created)
        : Number.POSITIVE_INFINITY;
    const round = Number(session.round);
    const winnerSide = winnerSideOf(session);
    if (!Number.isFinite(round) || !winnerSide) {
        return { kind: 'unknown', completedRounds: Number.POSITIVE_INFINITY, durationMs, short: false };
    }
    const loserSide = otherSide(winnerSide);
    const completedRounds = Math.max(0, Math.floor(round) - 1);
    const loserHp = Number(session[loserSide]?.hp);
    const kind: PvpTerminalKind = session.fleedBy === loserSide ? 'flee'
        : Number.isFinite(loserHp) && loserHp <= 0 ? 'ko'
            : completedRounds >= MAX_ROUNDS ? 'round-cap'
                : 'afk';
    const short = completedRounds < pvpMinRounds() || durationMs < pvpMinFightMs();
    return { kind, completedRounds, durationMs, short };
}

/** The winner's share for how the fight ended: full, half for a short KO, 0 for a short flee/AFK. */
export function pvpWinShortMult(c: PvpTerminalClass): number {
    if (!c.short) return 1;
    if (c.kind === 'flee' || c.kind === 'afk') return 0;
    return pvpShortFightMult();
}

/**
 * The winner's HP when the fight began. Continuous-vitals fights (world, war,
 * guard) start each fighter at their save HP, so damage is measured from that,
 * not from max HP: a winner who arrived hurt has not been "damaged" by the loser.
 */
function winnerStartHp(session: PvpSession, winnerSide: Side): number | null {
    const fighter = session[winnerSide];
    const continuous = session.continuousVitals ?? session.rewardAuthority === 'world';
    if (!continuous) return Number.isFinite(Number(fighter?.maxHp)) ? Number(fighter.maxHp) : null;
    const snap = (fighter?.character ?? {}) as Record<string, unknown>;
    const maxHp = Number(snap.maxHp ?? 100);
    if (!Number.isFinite(maxHp)) return null;
    const start = pvpSessionHp({
        level: snap.level,
        currentHp: snap.hp ?? maxHp,
        maxHp,
        useCurrentVitals: true,
        humanPvp: session.realFighters?.p1 === true && session.realFighters?.p2 === true,
    }).hp;
    return Number.isFinite(start) ? start : null;
}

/** The loser fought: a full-length KO or round-cap in which they dealt >= 15% of the winner's max HP. */
export function pvpLossEngaged(session: PvpSession, c: PvpTerminalClass): boolean {
    if (c.short || c.kind === 'flee' || c.kind === 'afk') return false;
    const winnerSide = winnerSideOf(session);
    if (!winnerSide) return false;
    const winner = session[winnerSide];
    const maxHp = Number(winner?.maxHp);
    if (!Number.isFinite(maxHp) || maxHp <= 0) return false;
    let damage: number;
    if (winner.unlimitedHealth) {
        damage = Math.max(0, Number(winner.damageReceived) || 0);
    } else {
        const start = winnerStartHp(session, winnerSide);
        const end = Number(winner.hp);
        if (start === null || !Number.isFinite(end)) return false;
        damage = Math.max(0, start - end);
    }
    return damage >= PVP_LOSS_MIN_DAMAGE_FRAC * maxHp;
}

// ── Credited-fight gate ──────────────────────────────────────────────────────

export type PvpCreditReason = 'level-gap' | 'too-young';

/**
 * Reaching this level also proves an account is established. It is the Genin
 * exam hold, days of real play for a throwaway alt, and it lets the first
 * week after a server reset pay PvP without an env change, when every
 * account is under the age floor.
 */
export const PVP_ESTABLISHED_LEVEL = 20;

/** An account may pay or be paid once it is past the age floor OR at PVP_ESTABLISHED_LEVEL (missing createdAt passes). */
export function pvpAccountOldEnough(createdAt: unknown, terminalAt: number, level?: unknown): boolean {
    if (fightLevel(level) >= PVP_ESTABLISHED_LEVEL) return true;
    const created = Number(createdAt);
    return !(Number.isFinite(created) && created > 0 && terminalAt - created < pvpMinAccountAgeMs());
}

export function evaluateCreditedPvpFight(o: {
    winnerLevel: number;
    loserLevel: number;
    loserCreatedAt: unknown;
    terminalAt: number;
}): { credited: boolean; reason?: PvpCreditReason } {
    if (fightLevel(o.winnerLevel) - fightLevel(o.loserLevel) > PVP_CREDIT_LEVEL_GAP_MAX) {
        return { credited: false, reason: 'level-gap' };
    }
    if (!pvpAccountOldEnough(o.loserCreatedAt, o.terminalAt, o.loserLevel)) return { credited: false, reason: 'too-young' };
    return { credited: true };
}

// ── Counters ─────────────────────────────────────────────────────────────────

export function pvpUtcDay(ms: number): string {
    const value = Number.isFinite(ms) ? ms : Date.now();
    return new Date(value).toISOString().slice(0, 10);
}
function sortedPair(a: string, b: string): [string, string] {
    const x = safeName(a), y = safeName(b);
    return x <= y ? [x, y] : [y, x];
}
export const pvpPairCounterKey = (a: string, b: string, day: string): string => {
    const [lo, hi] = sortedPair(a, b);
    return `pvp:pair:${lo}:${hi}:${day}`;
};
export const pvpPairSlotKey = (fightId: string): string => `pvp:pairslot:${fightId}`;
export const pvpRankedPairCounterKey = (a: string, b: string, day: string): string => {
    const [lo, hi] = sortedPair(a, b);
    return `pvp:rankedpair:${lo}:${hi}:${day}`;
};
export const pvpRankedPairSlotKey = (matchId: string): string => `pvp:rankedpairslot:${matchId}`;

type SlotStore = Pick<KvLike, 'get' | 'set' | 'incr'>;
type SlotKeys = { slotKey: string; counterKey: string };

function storedOrdinal(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The fight's ordinal on a day counter, assigned once per fight: every helper
 * and retry that names the same slot reads the same number, and the counter
 * moves once. A crash between the increment and the memo can only advance the
 * counter (prices a later fight lower), never mint. Fails open to 1.
 */
export async function assignPvpCreditSlot(store: SlotStore, keys: SlotKeys): Promise<number> {
    try {
        const existing = storedOrdinal(await store.get(keys.slotKey));
        if (existing) return existing;
        const n = await store.incr(keys.counterKey, { ex: PVP_COUNTER_TTL_SECONDS });
        const placed = await store.set(keys.slotKey, n, { nx: true, ex: PVP_SLOT_TTL_SECONDS });
        if (placed === 'OK') return n;
        return storedOrdinal(await store.get(keys.slotKey)) ?? n;
    } catch {
        return 1;
    }
}

/** The ordinal assignPvpCreditSlot would give, without assigning anything. Fails open to 1. */
export async function peekPvpCreditSlot(store: Pick<KvLike, 'get'>, keys: SlotKeys): Promise<number> {
    try {
        const existing = storedOrdinal(await store.get(keys.slotKey));
        if (existing) return existing;
        return (storedOrdinal(await store.get(keys.counterKey)) ?? 0) + 1;
    } catch {
        return 1;
    }
}

// ── One fight's credit ───────────────────────────────────────────────────────

export type PvpFightCredit = {
    credited: boolean;
    reason?: PvpCreditReason;
    kind: PvpTerminalKind;
    completedRounds: number;
    durationMs: number;
    short: boolean;
    /** The pair's ordinal today (0 when the fight is uncredited and took no slot). */
    pairOrdinal: number;
    pairWeight: number;
    /** Win: 1 / short-fight share / 0. Loss: 1 when engaged and the winner may pay, else 0. */
    sideMult: number;
    /** pairWeight x sideMult; 0 when uncredited. Ryo, dust, mastery and Vanguard XP all scale by it. */
    factor: number;
    lMin: number;
};

/** The live thresholds behind a credit, so the player-facing copy never drifts from the dials. */
export function pvpCreditRules() {
    return {
        minRounds: pvpMinRounds(),
        minFightSeconds: Math.round(pvpMinFightMs() / 1000),
        lossMinDamagePct: Math.round(PVP_LOSS_MIN_DAMAGE_FRAC * 100),
        minAccountAgeHours: Math.round(pvpMinAccountAgeMs() / 3_600_000),
        establishedLevel: PVP_ESTABLISHED_LEVEL,
        levelGapMax: PVP_CREDIT_LEVEL_GAP_MAX,
    };
}

/** Player-facing summary of the credit, returned with the reward (owner A9: every limit is visible). */
export function pvpCreditView(credit: PvpFightCredit) {
    return {
        credited: credit.credited,
        ...(credit.reason ? { reason: credit.reason } : {}),
        kind: credit.kind,
        short: credit.short,
        pairOrdinal: credit.pairOrdinal,
        pairWeight: credit.pairWeight,
        sideMult: credit.sideMult,
        rules: pvpCreditRules(),
    };
}

function sideLevel(session: PvpSession, side: Side, fallback: unknown): number {
    return fightLevel(session[side]?.character?.level ?? fallback);
}

/**
 * Price one side of a decided fight. Both sides of one battle share the pair
 * slot `pvp:pairslot:<battleId>`, so the winner's claim, the loser's claim and
 * the Vanguard terminal saga read one ordinal. Levels come from the sealed
 * session snapshot (a fighter who levels after the fight is paid at the fight's
 * level). `assignSlot: false` reads the ordinal without taking one.
 */
export async function resolvePvpFightCredit(store: SlotStore, o: {
    session: PvpSession;
    battleId: string;
    winnerSlug: string;
    loserSlug: string;
    winnerChar?: Record<string, unknown> | null;
    loserChar?: Record<string, unknown> | null;
    terminalAt: number;
    role: 'win' | 'loss';
    assignSlot?: boolean;
}): Promise<PvpFightCredit> {
    const winnerSide = winnerSideOf(o.session) ?? 'p1';
    const loserSide = otherSide(winnerSide);
    const winnerLevel = sideLevel(o.session, winnerSide, o.winnerChar?.level);
    const loserLevel = sideLevel(o.session, loserSide, o.loserChar?.level);
    const lMin = Math.min(winnerLevel, loserLevel);
    const c = classifyPvpTerminal(o.session, o.terminalAt);
    const fight = evaluateCreditedPvpFight({
        winnerLevel,
        loserLevel,
        loserCreatedAt: o.loserChar?.createdAt,
        terminalAt: o.terminalAt,
    });
    // The loss purse is paid out of the winner's fight, so the winner must be
    // past the age floor too: a main cannot collect loss pay from fresh alts.
    const sideMult = o.role === 'win'
        ? pvpWinShortMult(c)
        : pvpLossEngaged(o.session, c) && pvpAccountOldEnough(o.winnerChar?.createdAt, o.terminalAt, winnerLevel) ? 1 : 0;
    const base = { kind: c.kind, completedRounds: c.completedRounds, durationMs: c.durationMs, short: c.short, sideMult, lMin };
    if (!fight.credited) {
        return { ...base, credited: false, reason: fight.reason, pairOrdinal: 0, pairWeight: 0, factor: 0 };
    }
    const keys = {
        slotKey: pvpPairSlotKey(o.battleId),
        counterKey: pvpPairCounterKey(o.winnerSlug, o.loserSlug, pvpUtcDay(o.terminalAt)),
    };
    const pairOrdinal = o.assignSlot === false
        ? await peekPvpCreditSlot(store, keys)
        : await assignPvpCreditSlot(store, keys);
    const pairWeight = pvpPairWeight(pairOrdinal);
    return { ...base, credited: true, pairOrdinal, pairWeight, factor: pairWeight * sideMult };
}

/** Ryo for one priced side of a fight. */
export function pvpCreditRyo(credit: PvpFightCredit, o: { role: 'win' | 'loss'; lucky?: boolean; sector?: unknown; stronghold?: unknown }): number {
    if (credit.factor <= 0) return 0;
    const purse = o.role === 'win'
        ? pvpWinPurse({ lMin: credit.lMin, lucky: o.lucky, sector: o.sector, stronghold: o.stronghold })
        : pvpLossPurse({ lMin: credit.lMin, sector: o.sector, stronghold: o.stronghold });
    return floorPay(purse * credit.factor);
}

export function pvpCreditAuraDust(credit: PvpFightCredit): number {
    return floorPay(PVP_WIN_AURA_DUST * credit.factor);
}

/**
 * Vanguard profession XP follows the fight's credit (I-17). A session the
 * claim path will pay (baseRewards) takes the shared pair slot, so the terminal
 * saga and the later claim agree; any other session only reads the ordinal.
 */
export async function pvpVanguardXpFactor(
    store: Pick<KvLike, 'get'> & Partial<Pick<KvLike, 'set' | 'incr'>>,
    o: {
        session: PvpSession;
        winnerSlug: string;
        loserSlug: string;
        winnerChar?: Record<string, unknown> | null;
        loserChar?: Record<string, unknown> | null;
        terminalAt: number;
    },
): Promise<number> {
    const canAssign = typeof store.incr === 'function' && typeof store.set === 'function';
    const credit = await resolvePvpFightCredit(store as SlotStore, {
        ...o,
        battleId: o.session.battleId,
        role: 'win',
        assignSlot: canAssign && o.session.baseRewards === true,
    });
    return credit.factor;
}

// ── Sleeper KO (api/player/sleeper-kill.ts) ──────────────────────────────────

/**
 * A sleeping-camp KO has no battle id and commits before the counter can move,
 * so it previews the pair ordinal (read only) and records it after the credit
 * lands (recordSleeperKoPairCredit): a credit that never committed is never
 * counted. It pays 25% of the win purse, inside the same pair weights.
 */
export async function previewSleeperKoCredit(store: Pick<KvLike, 'get'>, o: {
    attackerSlug: string;
    targetSlug: string;
    attackerLevel: unknown;
    targetLevel: unknown;
    targetCreatedAt: unknown;
    rewardEligible: boolean;
    lucky?: boolean;
    sector?: unknown;
    now: number;
}): Promise<{ credited: boolean; reason?: PvpCreditReason; pairOrdinal: number; pairWeight: number; factor: number; ryo: number }> {
    const fight = evaluateCreditedPvpFight({
        winnerLevel: fightLevel(o.attackerLevel),
        loserLevel: fightLevel(o.targetLevel),
        loserCreatedAt: o.targetCreatedAt,
        terminalAt: o.now,
    });
    if (!o.rewardEligible || !fight.credited) {
        return { credited: false, reason: fight.reason, pairOrdinal: 0, pairWeight: 0, factor: 0, ryo: 0 };
    }
    let pairOrdinal = 1;
    try {
        pairOrdinal = (storedOrdinal(await store.get(pvpPairCounterKey(o.attackerSlug, o.targetSlug, pvpUtcDay(o.now)))) ?? 0) + 1;
    } catch { /* fail open: first fight of the day */ }
    const pairWeight = pvpPairWeight(pairOrdinal);
    const lMin = Math.min(fightLevel(o.attackerLevel), fightLevel(o.targetLevel));
    const purse = pvpWinPurse({ lMin, lucky: o.lucky, sector: o.sector });
    return { credited: true, pairOrdinal, pairWeight, factor: pairWeight, ryo: floorPay(PVP_SLEEPER_PURSE_FRAC * purse * pairWeight) };
}

/** Count a committed sleeper KO against the pair's day. Fails open. */
export async function recordSleeperKoPairCredit(store: Pick<KvLike, 'incr'>, o: { attackerSlug: string; targetSlug: string; now: number }): Promise<void> {
    try {
        await store.incr(pvpPairCounterKey(o.attackerSlug, o.targetSlug, pvpUtcDay(o.now)), { ex: PVP_COUNTER_TTL_SECONDS });
    } catch { /* fail open */ }
}

// ── Ranked V2 weight (I-3) ───────────────────────────────────────────────────

export const PVP_RANKED_WEIGHT_ROW_VERSION = 1 as const;
export type RankedWeightRow = {
    v: typeof PVP_RANKED_WEIGHT_ROW_VERSION;
    /** shortMult x pair weight on the ranked pair counter; scales Elo and Vanguard XP. */
    weight: number;
    pairOrdinal: number;
    shortMult: number;
    /** Sealed lower fighter level, for the ranked purse. */
    lMin: number;
    /** Sealed loss-engagement verdict, for the ranked loser's purse. */
    engaged: boolean;
    /** The fight's slot on the CASUAL pair counter; present only when the ranked purse was on at publication. */
    sharedPairOrdinal?: number;
};
export const pvpRankedWeightKey = (matchId: string): string => `pvp:ranked-weight:${matchId}`;

export function parseRankedWeightRow(raw: unknown): RankedWeightRow | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const weight = Number(row.weight);
    const shortMult = Number(row.shortMult);
    const pairOrdinal = Number(row.pairOrdinal);
    const lMin = Number(row.lMin);
    if (row.v !== PVP_RANKED_WEIGHT_ROW_VERSION
        || !Number.isFinite(weight) || weight < 0 || weight > 1
        || !Number.isFinite(shortMult) || shortMult < 0 || shortMult > 1
        || !Number.isSafeInteger(pairOrdinal) || pairOrdinal < 1
        || !Number.isSafeInteger(lMin) || lMin < 1
        || typeof row.engaged !== 'boolean') return null;
    const shared = Number(row.sharedPairOrdinal);
    return {
        v: PVP_RANKED_WEIGHT_ROW_VERSION,
        weight,
        pairOrdinal,
        shortMult,
        lMin,
        engaged: row.engaged,
        ...(Number.isSafeInteger(shared) && shared >= 1 ? { sharedPairOrdinal: shared } : {}),
    };
}

export async function readRankedWeightRow(store: Pick<KvLike, 'get'>, matchId: string): Promise<RankedWeightRow | null> {
    return parseRankedWeightRow(await store.get<unknown>(pvpRankedWeightKey(matchId)));
}

/**
 * Seal a ranked match's credit weight once, before its terminal is sealed, so
 * every helper and retry settles the same Elo. Classified from the sealed
 * `endedAt`, never publication time, so a delayed publication cannot lengthen
 * a short fight or move it to another UTC day. A store without `incr` (an old
 * test fake) prices the match as the pair's first. A write the store cannot
 * confirm throws; the terminal is retry-safe.
 */
export async function sealRankedWeightRow(
    store: Pick<KvLike, 'get' | 'set'> & Partial<Pick<KvLike, 'incr'>>,
    o: { session: PvpSession; matchId: string; a: string; b: string; terminalAt: number; ttlSeconds: number },
): Promise<RankedWeightRow> {
    const existing = await readRankedWeightRow(store, o.matchId);
    if (existing) return existing;
    const endedAt = Number(o.session.endedAt) || o.terminalAt;
    const c = classifyPvpTerminal(o.session, endedAt);
    const shortMult = pvpWinShortMult(c);
    const slotStore = typeof store.incr === 'function' ? store as SlotStore : null;
    const pairOrdinal = slotStore
        ? await assignPvpCreditSlot(slotStore, {
            slotKey: pvpRankedPairSlotKey(o.matchId),
            counterKey: pvpRankedPairCounterKey(o.a, o.b, pvpUtcDay(endedAt)),
        })
        : 1;
    const weight = shortMult * pvpPairWeight(pairOrdinal);
    const lMin = Math.min(fightLevel(o.session.p1?.character?.level), fightLevel(o.session.p2?.character?.level));
    // The ranked purse shares the casual pair counter, so ranked and casual
    // fights together stay inside one pair's 2.75 fights a day.
    const sharedPairOrdinal = slotStore && pvpRankedPurseEnabled() && weight > 0
        ? await assignPvpCreditSlot(slotStore, {
            slotKey: pvpPairSlotKey(o.session.battleId),
            counterKey: pvpPairCounterKey(o.a, o.b, pvpUtcDay(endedAt)),
        })
        : undefined;
    const row: RankedWeightRow = {
        v: PVP_RANKED_WEIGHT_ROW_VERSION,
        weight,
        pairOrdinal,
        shortMult,
        lMin,
        engaged: pvpLossEngaged(o.session, c),
        ...(sharedPairOrdinal ? { sharedPairOrdinal } : {}),
    };
    const placed = await store.set(pvpRankedWeightKey(o.matchId), row, { nx: true, ex: o.ttlSeconds });
    if (placed === 'OK') return row;
    const stored = await readRankedWeightRow(store, o.matchId);
    if (stored) return stored;
    throw new Error('pvp-ranked-weight-unconfirmed');
}

/**
 * The ranked purse for one settled side (PVP_RANKED_PURSE). A terminal sealed
 * without a shared pair slot (before the flag, or pre-deploy) pays nothing.
 */
export function rankedPurseRyo(row: RankedWeightRow | null, o: { role: 'winner' | 'loser'; lucky?: boolean }): number {
    if (!row || !row.sharedPairOrdinal || !pvpRankedPurseEnabled()) return 0;
    const factor = row.shortMult * pvpPairWeight(row.sharedPairOrdinal);
    if (factor <= 0) return 0;
    if (o.role === 'winner') return floorPay(pvpWinPurse({ lMin: row.lMin, lucky: o.lucky }) * factor);
    return row.engaged ? floorPay(pvpLossPurse({ lMin: row.lMin }) * pvpPairWeight(row.sharedPairOrdinal)) : 0;
}
