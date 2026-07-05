/*
 * Weekly Clan Boss Gauntlet — storage + composite scoring (pure math).
 *
 * A server-wide WEEKLY event: one boss appears; every clan gets its OWN instance
 * with a shared HP pool. Clan members queue 3-person co-op assaults (real
 * Battle-Towers fights — see api/clan-boss/{start,settle}.ts, which wrap the
 * server-authoritative tower engine), and each assault's SERVER-COMPUTED damage
 * is banked against the clan's pool. Clans race; at week end the top 3 by a
 * MULTI-FACTOR score win rewards into their treasury. The weekly cron opens /
 * closes / ranks / rewards (api/cron/_clan-boss-weekly.ts).
 *
 * Scaled for a small server (≤100 players): pools scale per-capita so a 4-person
 * clan can finish, and there is a single flat competition — no tiers.
 *
 * Feature-gated: endpoints 404 unless ENABLE_CLAN_BOSS==='1'; the client tab is
 * gated on clanBoss.v1. Ships inert.
 */
import { kv } from '../_storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE — all tunable; NEEDS SIGN-OFF before ENABLE_CLAN_BOSS=1. Rewards are
// treasury-only (ryo / Fate Shards / Bone Charms / clan XP) — no player combat
// power, honouring the balanced-PvP pillar.
// ─────────────────────────────────────────────────────────────────────────────

// ── The clan's shared boss ─────────────────────────────────────────────────
// Every clan faces the SAME boss with its OWN persistent HP bar (= this pool),
// scaled per-capita so a small clan can still finish. This IS the boss's health;
// parties chip it down across many assaults over the week.
export const CB_BASE_POOL = 14000;
export const CB_POOL_PER_MEMBER = 8000;
export const CB_MEMBER_CAP = 25;           // pool stops scaling past this roster size

// ── One assault ────────────────────────────────────────────────────────────
// A party fights the boss at min(remaining pool, CB_ASSAULT_HP_CAP) HP. The cap is
// set ABOVE what a 3-party can burn down before the boss wears them out, so an
// assault normally ends in a WIPE (or a round-out) having only CHIPPED the boss —
// the boss is truly slain only on the FINAL assault, once the remaining pool drops
// below what a party can finish. So the whole boss takes MANY attempts, and "every
// challenge ends in a wipe besides the clear." Banked chip-damage is what matters.
export const CB_ASSAULT_HP_CAP = 12000;
export const CB_ASSAULTS_PER_MEMBER = 5;
export const CB_MAX_PARTY = 3;             // host + up to 2 clanmates
export const CB_ASSAULT_LOG_CAP = 200;

// Clan-boss tower floors live in a reserved id range so they never collide with the
// public 1..N tower floors (api/towers/_floor-catalog.ts CLAN_BOSS_FLOORS).
export const CB_FLOOR_BASE = 9001;

// ── Composite score (multi-factor; no single axis can be gamed) ──
// Wiping is the EXPECTED outcome of chipping a boss you can't one-shot, so it is
// NOT penalised — progress is measured by damage. Efficiency, for the clans that
// actually SLAY the boss, blends fewest total rounds AND fastest wall-clock time.
export const CB_KILL_BONUS = 15000;        // flat — slaying the boss is the goal
export const CB_DMG_WEIGHT = 0.15;         // per point of damage chipped into the boss
export const CB_BREADTH_WEIGHT = 500;      // per DISTINCT member who joined an assault
export const CB_ROUND_PAR = 220;           // "par" total combat rounds to the kill
export const CB_ROUND_WEIGHT = 20;         // per round UNDER par (slayers only)
export const CB_TIME_PAR_HOURS = 120;      // "par" wall-clock (5 days) from spawn → kill
export const CB_TIME_WEIGHT = 45;          // per HOUR under par (slayers only) — the speed race
export const CB_CLEAN_WEIGHT = 400;        // per flawless clear (no party death) — rewards the finisher

// ── Top-3 clan rewards → clan treasury (tunable). Fate Shards / Bone Charms are
// premium-ish; this is a NEW weekly faucet for them — flagged for review. ──
export const CB_REWARDS: Record<1 | 2 | 3, { ryo: number; fateShards: number; boneCharms: number; clanXp: number }> = {
    1: { ryo: 30000, fateShards: 3, boneCharms: 5, clanXp: 1500 },
    2: { ryo: 20000, fateShards: 2, boneCharms: 3, clanXp: 1000 },
    3: { ryo: 12000, fateShards: 1, boneCharms: 2, clanXp: 700 },
};
// Any clan that KILLED its boss but finished off the podium still gets this.
export const CB_PARTICIPATION_REWARD = { ryo: 4000, fateShards: 0, boneCharms: 1, clanXp: 300 };

export const CB_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────

export type ClanBossDef = {
    id: string;
    name: string;
    icon: string;
    flavor: string;
    // Which Battle-Towers boss mechanic this week's fight uses. MUST match the
    // matching CLAN_BOSS_FLOORS entry (api/towers/_floor-catalog.ts) — a test pins it.
    mechanic: 'enrage' | 'summon' | 'regen' | 'bulwark';
    // The reserved tower floor id an assault against this boss runs on.
    floorId: number;
};

// Index-aligned with CLAN_BOSS_FLOORS in api/towers/_floor-catalog.ts (same order,
// same mechanic, floorId = CB_FLOOR_BASE + index).
export const CLAN_BOSSES: ClanBossDef[] = [
    { id: 'oni-warlord', name: 'The Oni Warlord', icon: '👹', flavor: 'A horned titan that enrages as it bleeds — end it fast or be crushed.', mechanic: 'enrage', floorId: CB_FLOOR_BASE + 0 },
    { id: 'abyss-leviathan', name: 'Abyssal Leviathan', icon: '🐉', flavor: 'It calls the drowned to its side. Cut down the spawn or drown in numbers.', mechanic: 'summon', floorId: CB_FLOOR_BASE + 1 },
    { id: 'fallen-kage', name: 'The Fallen Kage', icon: '👤', flavor: 'Knits their wounds shut each round. Only overwhelming pressure wins the DPS race.', mechanic: 'regen', floorId: CB_FLOOR_BASE + 2 },
    { id: 'stone-golem', name: 'Ancient Stone Golem', icon: '🗿', flavor: 'Its guardians shield it from harm. Break the guards before the core will fall.', mechanic: 'bulwark', floorId: CB_FLOOR_BASE + 3 },
];

export const CLAN_BOSS_BY_ID: Record<string, ClanBossDef> =
    CLAN_BOSSES.reduce((acc, b) => { acc[b.id] = b; return acc; }, {} as Record<string, ClanBossDef>);

// Global weekly event state (one per week, shared by all clans).
export type ClanBossWeek = {
    weekId: string;
    bossId: string;
    spawnedAt: number;
    endsAt: number;
    settled?: boolean;
};

// One assault's server-trusted outcome (banked from a finished tower session).
export type ClanBossAssault = {
    runId: string;
    by: string;            // host slug
    party: string[];       // participant slugs (host + allies)
    damage: number;        // server-computed damage dealt to the pool this assault
    rounds: number;        // rounds elapsed in the fight
    wiped: boolean;        // party lost / all KO'd
    clean: boolean;        // no party member was KO'd
    at: number;
};

// Per-clan progress for a given week.
export type ClanBossProgress = {
    clanName: string;
    weekId: string;
    bossId: string;
    weekStartedAt: number;                 // week spawn time — the clock for time-to-kill
    poolMax: number;
    pool: number;                          // HP remaining
    killedAt?: number;
    totalRounds: number;                   // summed across assaults
    participants: string[];                // DISTINCT member slugs who assaulted
    memberAttempts: Record<string, number>; // slug → assaults used this week
    assaults: ClanBossAssault[];           // capped log (newest first)
    updatedAt: number;
};

// ── Pure math (unit-tested) ──────────────────────────────────────────────────

export function clanBossPoolMax(memberCount: number): number {
    const m = Math.max(1, Math.min(CB_MEMBER_CAP, Math.floor(Number(memberCount) || 1)));
    return CB_BASE_POOL + CB_POOL_PER_MEMBER * m;
}

/** Damage the clan has dealt to its pool so far (= poolMax − remaining). */
export function clanBossDamageDealt(p: ClanBossProgress): number {
    return Math.max(0, p.poolMax - p.pool);
}

/** Hours from the boss spawning to this clan's kill (0 if not killed). */
export function clanBossHoursToKill(p: ClanBossProgress): number {
    if (!p.killedAt) return 0;
    const start = Number(p.weekStartedAt) || 0;   // 0 is a valid start; a missing clock → no time bonus
    return Math.max(0, (p.killedAt - start) / 3_600_000);
}

/**
 * The COMPOSITE score — multiple independent factors so no single axis can be
 * gamed. Wiping is the EXPECTED result of chipping a boss you can't one-shot, so
 * it is NOT penalised; progress is measured by damage. The efficiency factors
 * (rounds + time) only reward the clans that actually SLAY the boss:
 *   + kill bonus            — slaying the boss is the goal
 *   + damage chipped         — the grind-down axis (the only one for non-slayers)
 *   + participation breadth  — distinct members who fought (kills the "3 carries" cheese)
 *   + rounds under par       — efficiency (slayers only)
 *   + TIME under par         — fastest wall-clock spawn→kill (slayers only)
 *   + clean clears           — flawless, no-death clears (the finisher)
 */
export function clanBossScore(p: ClanBossProgress): number {
    const killed = !!p.killedAt;
    const damage = clanBossDamageDealt(p);
    const distinct = p.participants.length;
    const cleanClears = p.assaults.filter(a => a.clean && !a.wiped).length;

    let score = 0;
    if (killed) score += CB_KILL_BONUS;
    score += damage * CB_DMG_WEIGHT;
    score += distinct * CB_BREADTH_WEIGHT;
    if (killed) {
        score += Math.max(0, CB_ROUND_PAR - p.totalRounds) * CB_ROUND_WEIGHT;
        score += Math.max(0, CB_TIME_PAR_HOURS - clanBossHoursToKill(p)) * CB_TIME_WEIGHT;
    }
    score += cleanClears * CB_CLEAN_WEIGHT;
    return Math.max(0, Math.round(score));
}

/** Rank clans by composite score (desc); killers always sort above non-killers. */
export function rankClanBoss(list: ClanBossProgress[]): Array<{ clanName: string; score: number; killed: boolean; rank: number }> {
    return [...list]
        .map(p => ({ clanName: p.clanName, score: clanBossScore(p), killed: !!p.killedAt }))
        .sort((a, b) =>
            (Number(b.killed) - Number(a.killed)) ||
            (b.score - a.score) ||
            a.clanName.localeCompare(b.clanName))
        .map((e, i) => ({ ...e, rank: i + 1 }));
}

/** Deterministic ISO-week id, e.g. "2026-W27". */
export function clanBossWeekId(now: number): string {
    const d = new Date(now);
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(
        ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic boss pick from the week id (all bosses share pool scaling). */
export function clanBossPickId(weekId: string): string {
    let h = 0;
    for (let i = 0; i < weekId.length; i++) h = (Math.imul(h, 31) + weekId.charCodeAt(i)) >>> 0;
    return CLAN_BOSSES[h % CLAN_BOSSES.length].id;
}

/** Resolve the boss stored on the weekly event, with a compatibility fallback for malformed legacy weeks. */
export function resolveClanBossDef(week: ClanBossWeek | null | undefined): ClanBossDef | null {
    if (!week) return null;
    return CLAN_BOSS_BY_ID[week.bossId] ?? CLAN_BOSS_BY_ID[clanBossPickId(week.weekId)] ?? null;
}

export function clanBossAttemptsLeft(p: ClanBossProgress | null, memberSlug: string): number {
    const used = p?.memberAttempts?.[memberSlug] ?? 0;
    return Math.max(0, CB_ASSAULTS_PER_MEMBER - used);
}

// ── KV ───────────────────────────────────────────────────────────────────────

export function clanSlug(clanName: string): string {
    return clanName.toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function clanBossWeekKey(weekId: string): string {
    return `clan-boss:week:${weekId}`;
}
export function clanBossProgressKey(weekId: string, clanName: string): string {
    return `clan-boss:progress:${weekId}:${clanSlug(clanName)}`;
}
export function clanBossArchiveKey(weekId: string): string {
    return `clan-boss:archive:${weekId}`;
}

export async function loadClanBossWeek(weekId: string): Promise<ClanBossWeek | null> {
    return kv.get<ClanBossWeek>(clanBossWeekKey(weekId));
}
export async function loadClanBossProgress(weekId: string, clanName: string): Promise<ClanBossProgress | null> {
    return kv.get<ClanBossProgress>(clanBossProgressKey(weekId, clanName));
}
export async function saveClanBossProgress(p: ClanBossProgress): Promise<void> {
    // Cap the assault log to keep the blob small.
    if (p.assaults.length > CB_ASSAULT_LOG_CAP) p.assaults = p.assaults.slice(0, CB_ASSAULT_LOG_CAP);
    await kv.set(clanBossProgressKey(p.weekId, p.clanName), p);
}

export function newClanBossProgress(clanName: string, week: ClanBossWeek, memberCount: number): ClanBossProgress {
    const poolMax = clanBossPoolMax(memberCount);
    return {
        clanName,
        weekId: week.weekId,
        bossId: week.bossId,
        weekStartedAt: week.spawnedAt,
        poolMax,
        pool: poolMax,
        totalRounds: 0,
        participants: [],
        memberAttempts: {},
        assaults: [],
        updatedAt: week.spawnedAt,
    };
}

/**
 * Reserve one of the host's weekly assault attempts (called at assault-START, so a
 * player can't spin up unlimited parallel assaults). Also credits participation
 * breadth immediately for the whole party. Pure; caller persists under a lock.
 */
export function reserveAttempt(p: ClanBossProgress, host: string, party: string[], at: number): ClanBossProgress {
    const participants = new Set(p.participants);
    for (const slug of party) if (slug) participants.add(slug);
    const memberAttempts = { ...p.memberAttempts };
    memberAttempts[host] = (memberAttempts[host] ?? 0) + 1;
    return { ...p, participants: [...participants], memberAttempts, updatedAt: at };
}

/**
 * Bank a finished assault's server-trusted result into the clan's progress (called
 * at assault-SETTLE). `damage` is the boss HP the party removed in the tower fight —
 * clamped to the remaining pool so overkill on the final chunk can't inflate the
 * damage score. Does NOT touch memberAttempts (reserved at start). Pure; caller
 * persists under a lock.
 */
export function bankAssault(
    p: ClanBossProgress,
    assault: { runId: string; by: string; party: string[]; damage: number; rounds: number; wiped: boolean; clean: boolean; at: number },
): ClanBossProgress {
    const dealt = Math.max(0, Math.min(assault.damage, p.pool));
    const nextPool = Math.max(0, p.pool - dealt);
    const participants = new Set(p.participants);
    for (const slug of assault.party) if (slug) participants.add(slug);

    const next: ClanBossProgress = {
        ...p,
        pool: nextPool,
        totalRounds: p.totalRounds + Math.max(0, Math.floor(assault.rounds)),
        participants: [...participants],
        assaults: [{ ...assault, damage: dealt }, ...p.assaults].slice(0, CB_ASSAULT_LOG_CAP),
        updatedAt: assault.at,
    };
    if (nextPool <= 0 && !next.killedAt) next.killedAt = assault.at;
    return next;
}
