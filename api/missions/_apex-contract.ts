/*
 * Apex Contract — SERVER authority.
 *
 * Mirror of shinobij.client/src/lib/apex-contract.ts. The two are parity-tested
 * (_apex-contract.test.ts): the client copy drives the UI and builds the fight,
 * this copy decides what actually gets PAID. Keep them in sync — same pattern as
 * lib/spire-catalog.ts.
 *
 * Reward flow, matching the mint→prove→claim pattern used everywhere else:
 *   1. Arena mints an ai-fight token sealing the opponentId (ai-fight-start).
 *   2. report-ai-fight consumes it. If the sealed opponentId is THIS week's apex
 *      beast, it writes the kill receipt below.
 *   3. claim-mission pays from THIS catalog — never from the client body — and
 *      stamps apexWeekClaimed so the purse is once per ISO week.
 *
 * apexWeekClaimed lives in the SERVER-OWNED save field set (api/save/[name].ts)
 * alongside hunterRank: a client-writable copy would let a player reset it and
 * re-claim the purse indefinitely.
 */

export const APEX_MIN_HUNTER_RANK = 5;
export const APEX_MIN_LEVEL = 70;

/** ⚖ Purse — once per ISO week, on its own slot (never a daily hunt). */
export const APEX_REWARD = {
    xp: 3_000, // retired (character XP removed) — kept for old-client display shapes
    ryo: 8_000,
    stamina: 40,
    fateShards: 3,
} as const;
// Weekly capstone stat-pool grant (leveling-without-xp map §4): one-time per
// week by the apexWeekClaimed stamp, outside the daily checklist, unboosted.
export const APEX_STAT_POINTS = 25;

export type ApexBeastDef = { baseAiId: string; apexAiId: string; level: number; statBonus: number; hp: number };

/*
 * ⚖ Roster. HP CAPS AT 12,500 — the Worldstorm base hunt's already-proven-fair
 * pool. With +165..+235 on every stat these beasts are lethal; more HP would
 * make the fight longer, not harder. Difficulty is spent on lethality.
 */
export const APEX_ROSTER: readonly ApexBeastDef[] = [
    { baseAiId: 'hunt-ai-ember-drake', apexAiId: 'apex-ai-ember-drake', level: 85, statBonus: 165, hp: 11_200 },
    { baseAiId: 'hunt-ai-moon-serpent', apexAiId: 'apex-ai-moon-serpent', level: 88, statBonus: 173, hp: 11_600 },
    { baseAiId: 'hunt-ai-ancient-chakra-beast', apexAiId: 'apex-ai-ancient-chakra-beast', level: 100, statBonus: 220, hp: 12_000 },
    { baseAiId: 'hunt-ai-worldstorm-dragon', apexAiId: 'apex-ai-worldstorm-dragon', level: 100, statBonus: 235, hp: 12_500 },
];

/** ISO-8601 week key, e.g. "2026-W30". MUST match the client implementation. */
export function isoWeekKey(now: Date): string {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayNumber = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    date.setUTCDate(date.getUTCDate() - dayNumber + 3);
    const isoYear = date.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
    const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function weekOrdinal(weekKey: string): number {
    const [yearPart, weekPart] = weekKey.split('-W');
    const year = Math.max(0, Math.floor(Number(yearPart) || 0));
    const week = Math.max(1, Math.floor(Number(weekPart) || 1));
    return year * 53 + week;
}

/** The globally-shared Apex beast for a week. Deterministic — no per-player reroll. */
export function apexBeastForWeek(weekKey: string): ApexBeastDef {
    return APEX_ROSTER[weekOrdinal(weekKey) % APEX_ROSTER.length];
}

/** True when `apexAiId` is the beast on offer for `weekKey`. */
export function isApexBeastForWeek(apexAiId: string, weekKey: string): boolean {
    return !!apexAiId && apexBeastForWeek(weekKey).apexAiId === apexAiId;
}

type ApexChar = { hunterRank?: unknown; level?: unknown; apexWeekClaimed?: unknown };

export function canTakeApex(char: ApexChar | null | undefined): boolean {
    if (!char) return false;
    return Math.floor(Number(char.hunterRank ?? 0)) >= APEX_MIN_HUNTER_RANK
        && Math.floor(Number(char.level ?? 0)) >= APEX_MIN_LEVEL;
}

export function apexClaimedThisWeek(char: ApexChar | null | undefined, weekKey: string): boolean {
    return typeof char?.apexWeekClaimed === 'string' && char.apexWeekClaimed === weekKey;
}

/** Kill receipt written by report-ai-fight, consumed by claim-mission. */
export function apexKillReceiptKey(playerName: string, weekKey: string): string {
    return `missions:apex-kill:${playerName}:${weekKey}`;
}

/** Outlives the grace window below. */
export const APEX_RECEIPT_TTL_SECONDS = 16 * 24 * 60 * 60;

/** The ISO week before `now`. */
export function previousWeekKey(now: Date): string {
    return isoWeekKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
}

/**
 * Weeks a claim may settle, newest first.
 *
 * Without the previous week a Sunday-23:55 kill becomes unclaimable at 00:01
 * Monday — the beast rotates, the key no longer matches, and the purse is gone
 * with no recourse. That is exactly the stale-claim trap this codebase keeps
 * having to self-heal, so it is designed out rather than patched later.
 *
 * It cannot double-pay: each week has its own receipt, and `apexWeekClaimed`
 * records WHICH week was paid, so settling last week's kill still leaves this
 * week's claimable — and neither can be claimed twice.
 */
export function apexClaimableWeeks(now: Date): readonly string[] {
    return [isoWeekKey(now), previousWeekKey(now)];
}
