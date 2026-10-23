/*
 * The collusive-surrender floor for village wars (2026-10 rebalance, framework
 * I-5, owner sign-off Q4).
 *
 * Surrender had no minimum duration, and an agreed peace ended a war at once,
 * yet both still stamped crates and MVPs. With a 7-day cooldown per PAIR of
 * villages, one village could surrender to each rival in rotation and farm
 * crates, MVP bundles and the loser's comeback rally. Now a war that ends BY
 * AGREEMENT (a surrender, or both Kages' peace offers) before the floor pays no
 * crates, purses or MVP rewards and starts no rally; its stats still count.
 * Score, timeout and HP endings are never "early".
 *
 * Pure and import-light, so api/world-state.ts and api/war/_reward.ts can both
 * use it without an import cycle. Reads only fields the war row already stores.
 */

import { economyDial } from '../_economy-dials.js';
import { VILLAGE_WAR_REWARD_MIN_DURATION_HOURS } from '../../shared/village-war-reward-floor.js';
import { VILLAGE_CAMPAIGN_DURATION_MS } from '../../shared/village-war-campaign.js';

const HOUR_MS = 60 * 60 * 1000;

export const VILLAGE_WAR_REWARD_MIN_DURATION_MS = VILLAGE_WAR_REWARD_MIN_DURATION_HOURS * HOUR_MS;

/** WAR_MIN_DURATION_HOURS (default 72, whole hours 0-120): the floor. 0 turns I-5 off. */
export function warMinDurationMs(): number {
    return Math.floor(economyDial('WAR_MIN_DURATION_HOURS', VILLAGE_WAR_REWARD_MIN_DURATION_HOURS, { min: 0, max: 120 })) * HOUR_MS;
}

export type AgreementEndingWar = {
    villages: readonly string[];
    endedAt?: number;
    winnerVillage?: string;
    startedAt?: number;
    pendingUntil?: number;
    surrenderedBy?: string;
    peaceProposals?: Record<string, number>;
};

/** When the war went live: the end of its pre-war window, else its start (the
 *  same instant world-state's warEffectiveStartMs and campaign.startsAt use). */
export function villageWarLiveFrom(war: Pick<AgreementEndingWar, 'startedAt' | 'pendingUntil'>): number {
    return Number(war.pendingUntil) || Number(war.startedAt) || 0;
}

/** A surrender, or a no-winner war on which BOTH villages offered peace. The
 *  second offer ends the war at once, so two offers on the row mean peace ended it. */
export function villageWarEndedByAgreement(war: AgreementEndingWar): boolean {
    if (!war.endedAt) return false;
    if (String(war.surrenderedBy ?? '').trim()) return true;
    if (war.winnerVillage) return false;
    const offers = war.peaceProposals ?? {};
    return war.villages.length === 2 && war.villages.every((v) => Number(offers[v]) > 0);
}

/** An agreement ending less than `minMs` after the war went live. */
export function villageWarEndedEarlyByAgreement(war: AgreementEndingWar, minMs: number = warMinDurationMs()): boolean {
    if (!(minMs > 0) || !villageWarEndedByAgreement(war)) return false;
    return Number(war.endedAt) - villageWarLiveFrom(war) < minMs;
}

/**
 * The share of the war's raised pay (purse, purse honor, the MVP raise) an
 * agreement ending past the floor still earns: the fraction of the five-day
 * campaign that was fought, at most 1. A surrender at 72 h pays 60%, so ending
 * wars at the floor and re-declaring earns no more per day than fighting full
 * campaigns. Score, timeout and HP endings pay in full.
 */
export function villageWarAgreementPayFraction(war: AgreementEndingWar, fullMs: number = VILLAGE_CAMPAIGN_DURATION_MS): number {
    if (!villageWarEndedByAgreement(war) || !(fullMs > 0)) return 1;
    const fought = Number(war.endedAt) - villageWarLiveFrom(war);
    if (!Number.isFinite(fought) || fought <= 0) return 0;
    return Math.min(1, fought / fullMs);
}
