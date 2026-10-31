/*
 * Pure soft-cap math for daily AI-fight rewards (P0.2b). The first
 * AI_FIGHT_SOFT_CAP_PER_DAY AI wins each UTC day pay full XP/ryo; beyond that the
 * reward is multiplied by AI_FIGHT_REDUCED_MULT so a grinder can't blow past the
 * ~90-day progression curve — without walling a normal active player. Deliberately
 * GENEROUS; tune these before enabling AI_FIGHT_SERVER_AUTH / aiFightServerAuth.v1.
 *
 * The per-fight clamps are anti-inflation safety rails on the client-reported base.
 * The legit max ryo is now 150 (L90+, or L76+ with Lucky), so the ryo clamp is
 * binding, not headroom: it is what caps a forged or farmed day at 9,350 ryo.
 *
 * The level-scaled purse a win seals (aiFightPurseForLevel) also lives here,
 * next to the clamp that bounds it. It reads its two env dials per call.
 */

import { createHmac } from 'node:crypto';
import { AI_PVE_STAT_POINTS_PER_WIN } from '../../shared/combat-growth-rules.js';
import { economyDial } from '../_economy-dials.js';

/**
 * Uniform 0–3 points, fixed to the server-minted fight token so even a zero
 * cannot be rerolled after a failed save or a retry on another worker.
 * Like gearRoll, salt public fight IDs with the stable server secret; local
 * no-secret runs use a fixed fallback without changing authentication.
 */
export function aiFightStatPointsForWin(playerName: string, token: string): number {
    const salt = process.env.SESSION_SECRET || 'pve-stat-roll-unsalted';
    const roll = createHmac('sha256', salt).update(`pve-stat-v1:${playerName}:${token}`).digest().readUInt32BE(0);
    return roll % (AI_PVE_STAT_POINTS_PER_WIN + 1);
}

export const AI_FIGHT_SOFT_CAP_PER_DAY = 50;   // full reward for the first N AI wins/day
// Absolute ceiling on paid AI wins. The battle token reduces arbitrary claims,
// but the server does not simulate the client-side PvE fight, so an attacker can
// still mint valid start tokens directly. Past this bound the token is consumed
// and the win pays zero, limiting the daily blast radius.
export const AI_FIGHT_HARD_CAP_PER_DAY = 100;
export const AI_FIGHT_REDUCED_MULT = 0.25;     // reward multiplier past the soft cap
export const MAX_AI_FIGHT_XP = 150;            // per-fight base XP clamp (legit max 125)
export const MAX_AI_FIGHT_RYO = 150;           // per-fight base ryo clamp; binds from L90 (L76 with Lucky)
// TTL on the date-keyed daily counter so old date keys self-evict (a bit over a day).
export const AI_FIGHT_DAILY_COUNT_TTL_SECONDS = 26 * 60 * 60;

// Ordinary AI purse (2026-10 economy rebalance, framework #25): 60 + level,
// capped by MAX_AI_FIGHT_RYO. A Lucky active pet adds a flat 15 under the same
// cap, so Lucky saturates from L76 and adds nothing from L90.
export const AI_FIGHT_PURSE_BASE = 60;
export const AI_FIGHT_PURSE_PER_LEVEL = 1;
export const AI_FIGHT_LUCKY_BONUS = 15;
/** Per-level dial ceiling: anything steeper just reaches the 150 clamp sooner. */
export const AI_FIGHT_PURSE_PER_LEVEL_MAX = 3;

function wholeDial(name: string, fallback: number, max: number): number {
    const value = economyDial(name, fallback, { min: 0, max });
    return Number.isInteger(value) ? value : fallback;
}

/** AI_FIGHT_PURSE_BASE (default 60, whole ryo 0-150), read per call. Kill value:
 *  75 with AI_FIGHT_PURSE_PER_LEVEL 0 restores the flat 75 (90 with Lucky). */
export function aiFightPurseBase(): number {
    return wholeDial('AI_FIGHT_PURSE_BASE', AI_FIGHT_PURSE_BASE, MAX_AI_FIGHT_RYO);
}

/** AI_FIGHT_PURSE_PER_LEVEL (default 1, whole ryo 0-3), read per call. */
export function aiFightPursePerLevel(): number {
    return wholeDial('AI_FIGHT_PURSE_PER_LEVEL', AI_FIGHT_PURSE_PER_LEVEL, AI_FIGHT_PURSE_PER_LEVEL_MAX);
}

/**
 * The base ryo an ordinary AI win seals at the player's level: base + perLevel
 * x level (+15 for an active Lucky pet), never above MAX_AI_FIGHT_RYO. A
 * missing or invalid level reads as L1, the same clamp the World fight uses.
 */
export function aiFightPurseForLevel(level: unknown, trait?: string | null): number {
    const lv = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    const lucky = trait === 'Lucky' ? AI_FIGHT_LUCKY_BONUS : 0;
    return Math.min(MAX_AI_FIGHT_RYO, aiFightPurseBase() + aiFightPursePerLevel() * lv + lucky);
}

export type AiFightReward = { xp: number; ryo: number; capped: boolean };

/**
 * Allowed ryo for ONE AI win, given the day's running win count (including
 * this win). Clamps the sealed base, then applies the soft-cap multiplier.
 * Character XP is retired; `xp` stays in the shape as 0 for old clients.
 * Stat points are rolled separately by aiFightStatPointsForWin and reserved
 * against the shared daily budget by report-ai-fight.
 */
export function aiFightReward(_claimedXp: unknown, claimedRyo: unknown, dailyCountIncludingThis: number): AiFightReward {
    const ryoBase = Math.max(0, Math.min(MAX_AI_FIGHT_RYO, Math.floor(Number(claimedRyo) || 0)));
    const count = Math.max(0, Math.floor(Number(dailyCountIncludingThis) || 0));
    if (count > AI_FIGHT_HARD_CAP_PER_DAY) return { xp: 0, ryo: 0, capped: true };
    const overCap = count > AI_FIGHT_SOFT_CAP_PER_DAY;
    const mult = overCap ? AI_FIGHT_REDUCED_MULT : 1;
    return { xp: 0, ryo: Math.floor(ryoBase * mult), capped: overCap };
}
