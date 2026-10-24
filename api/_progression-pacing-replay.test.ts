import { strict as assert } from 'node:assert';
import { describe, it, type TestContext } from 'node:test';
import { _makeMemoryKv } from './_storage.js';
import { earnedForLevel, earnedStatPoints, levelForEarned } from './_xp-engine.js';
import { trainingRateTable, trainingTiersFor, type TrainingTierId } from './_training-config.js';
import { trustedTrainingRewards } from './training/_session.js';
import { combinedStatBoost, DAILY_COMBAT_STAT_CAP, DAILY_STAT_POINT_CAP_MAX, AI_PVE_STAT_POINTS_PER_WIN } from './_stat-growth.js';
import { reserveCombatStatBudget } from './pvp/_combat-stat-budget.js';
import { FIELD_MISSION_STAT_POINTS } from './missions/_mission-catalog.js';
import { APEX_STAT_POINTS } from './missions/_apex-contract.js';
import { STORY_LEVELS, STORY_REWARDS } from './story/_settle.js';

/*
 * Phase 1A gate (framework §8.2): "regular days to L90 within 80-96 in replay".
 *
 * A day-stepped port of the economist model's archetype routines (framework §1,
 * final-model.mjs ROUTINE) that calls the REAL server grant functions rather
 * than copies of their numbers:
 *   - training: trustedTrainingRewards per session (the real seal: bonus read
 *     off the save fields, rookie on the ledger level, era dial), over the table
 *     trainingTiersFor(trainingRateTable()) that /api/training/start uses;
 *   - the level curve: earnedForLevel / levelForEarned;
 *   - hunt / field claims: FIELD_MISSION_STAT_POINTS boosted the way
 *     claim-mission.ts boosts it, each claim reserved against the one shared
 *     daily budget (owner ruling A1; claim-mission reserves through
 *     api/_daily-stat-budget.ts, which wraps this same reservation);
 *   - combat: reserveCombatStatBudget against the same budget;
 *   - one-time and weekly grants: STORY_REWARDS, Story Tower, Apex, bosses.
 * The handlers call these same functions; the handler spot checks live in
 * api/admin/boost-event.test.ts (training seal), field-trail-handler.test.ts
 * (a claim against a nearly spent budget) and
 * api/pvp/_pvp-growth-budget.integration.test.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 17, 12, 0, 0);

type Archetype = 'casual' | 'regular' | 'hardcore';
type BandRoutine = { hunt?: number; fetch?: number; explore?: number; ai?: number; pvp?: number };
type Band = 10 | 30 | 50 | 70 | 90;

// Claims and fights per day by level band (final-model.mjs ROUTINE).
const ROUTINE: Record<Archetype, Record<Band, BandRoutine>> = {
    casual: { 10: { hunt: 4, ai: 2 }, 30: { hunt: 4, ai: 1, explore: 2 }, 50: { hunt: 4, ai: 1, explore: 2 }, 70: { hunt: 4, ai: 1, explore: 2 }, 90: { hunt: 4, ai: 1, explore: 2 } },
    regular: { 10: { hunt: 8, fetch: 3, explore: 6, ai: 2, pvp: 1 }, 30: { hunt: 5, pvp: 2 }, 50: { hunt: 5, pvp: 1 }, 70: { hunt: 2, pvp: 1 }, 90: { hunt: 2, pvp: 1 } },
    hardcore: { 10: { hunt: 20, fetch: 10, explore: 25, pvp: 2 }, 30: { hunt: 20, pvp: 3 }, 50: { hunt: 10, pvp: 3 }, 70: { hunt: 8, pvp: 3 }, 90: { hunt: 8, pvp: 3 } },
};
const FETCH_EXPLORES: Record<Band, number> = { 10: 3, 30: 7, 50: 9, 70: 12, 90: 12 };
const EXPLORE_FIGHT_RATE = 0.496; // share of explores that turn into an AI fight (model)
const EXPECTED_PVP_POINTS = 3;    // 50% win rate × PVP 6 per win (model)
const MISSION_BONUS: Record<Archetype, number> = { casual: 0, regular: 10, hardcore: 30 };
const OPTIMISER_MISSION_BONUS = 37.5;
const WEEKLY_BOSS_POINTS = 10;  // weekly boss kill (framework §1.3, unchanged)
const WORLD_BOSS_POINTS = 3;    // world boss, every other week (unchanged)
const WEEKLY: Record<Archetype, { boss: boolean; apexFromBand: number }> = {
    casual: { boss: false, apexFromBand: 999 },
    regular: { boss: true, apexFromBand: 90 },
    hardcore: { boss: true, apexFromBand: 70 },
};
const STORY_TOWER_TOTAL = 463;
const STORY_TOWER_PER_DAY: Record<Archetype, number> = { casual: 0, regular: 31, hardcore: 155 };

const bandFor = (level: number): Band => (level < 20 ? 10 : level < 40 ? 30 : level < 60 ? 50 : level < 80 ? 70 : 90);
const hunterRank = (band: Band, archetype: Archetype) =>
    band >= 90 ? (archetype === 'casual' ? 4 : 5) : band >= 70 ? 4 : band >= 50 ? 3 : band >= 30 ? 2 : 0;

// Training bonus comes from save fields, so the real trainingBonusPct runs.
const BONUS_FIELDS: Record<'casual' | 'regular' | 'hardcore' | 'optimiser', Record<string, unknown>> = {
    casual: {},                                                    // 0%
    regular: { elderFocus: 'training' },                           // +10%
    hardcore: { villageUpgrades: { training: 40 }, elderFocus: 'training', clan: 'Leaf',
        clanUpgradeLevels: { trainingGrounds: 25 }, clanDoctrine: 'scholars' },   // 10 + 10 + 5 + 5 = 30%
    optimiser: { villageUpgrades: { training: 50 }, elderFocus: 'training', clan: 'Leaf',
        clanUpgradeLevels: { trainingGrounds: 50 }, clanDoctrine: 'scholars' },   // 12.5 + 10 + 10 + 5 = 37.5%
};

const REGIMEN: Record<'casual' | 'regular' | 'hardcore' | 'script' | 'human', Array<[TrainingTierId, number]>> = {
    casual: [['8h', 1], ['4h', 1]],
    regular: [['8h', 1], ['4h', 3]],
    hardcore: [['1h', 12], ['4h', 1], ['8h', 1]],
    script: [['15m', 96]],
    human: [['15m', 63], ['8h', 1]],
};

type Profile = {
    name: string;
    routine: Archetype;       // claims, combat, weekly and tower cadence
    regimen: keyof typeof REGIMEN;
    bonus: keyof typeof BONUS_FIELDS;
    optimiserClaims?: boolean; // claim every slot at the optimiser's mission bonus
};

const PROFILES: Profile[] = [
    { name: 'casual', routine: 'casual', regimen: 'casual', bonus: 'casual' },
    { name: 'regular', routine: 'regular', regimen: 'regular', bonus: 'regular' },
    { name: 'hardcore', routine: 'hardcore', regimen: 'hardcore', bonus: 'hardcore' },
    { name: 'script optimiser', routine: 'hardcore', regimen: 'script', bonus: 'optimiser', optimiserClaims: true },
    { name: 'human optimiser', routine: 'hardcore', regimen: 'human', bonus: 'optimiser', optimiserClaims: true },
];

/** The stat-point request of each of the day's claims, in claim order. */
function claimRequests(profile: Profile, band: Band): number[] {
    const archetype = profile.routine;
    const rank = hunterRank(band, archetype);
    const missionBonus = profile.optimiserClaims ? OPTIMISER_MISSION_BONUS : MISSION_BONUS[archetype];
    // Optimisers claim every slot (20 hunts + Hunter Rank, 20 field jobs).
    const hunts = profile.optimiserClaims ? 20 + rank : ROUTINE[archetype][band].hunt ?? 0;
    const fields = profile.optimiserClaims ? 20 : ROUTINE[archetype][band].fetch ?? 0;
    // claim-mission.ts: round(3 × combinedStatBoost(mission bonus + 5% per Hunter Rank) × event)
    const hunt = Math.max(0, Math.round(FIELD_MISSION_STAT_POINTS * combinedStatBoost(missionBonus + rank * 5)));
    const field = Math.max(0, Math.round(FIELD_MISSION_STAT_POINTS * combinedStatBoost(missionBonus)));
    return [...Array(hunts).fill(hunt), ...Array(fields).fill(field)];
}

/** The model's expected combat stat request for the day (before the budget). */
function expectedCombatRequest(archetype: Archetype, band: Band): number {
    const r = ROUTINE[archetype][band];
    const pve = AI_PVE_STAT_POINTS_PER_WIN;
    return Math.round(
        pve * (r.hunt ?? 0)
        + pve * FETCH_EXPLORES[band] * EXPLORE_FIGHT_RATE * (r.fetch ?? 0)
        + pve * EXPLORE_FIGHT_RATE * (r.explore ?? 0)
        + pve * (r.ai ?? 0)
        + EXPECTED_PVP_POINTS * (r.pvp ?? 0),
    );
}

async function daysToLevel(profile: Profile, target: number, cap: number): Promise<number> {
    const store = _makeMemoryKv();
    const tiers = trainingTiersFor(trainingRateTable());
    const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
    const storyClaimed = new Set<number>();
    const weekly = WEEKLY[profile.routine];
    let earned = earnedForLevel(10);
    let tower = 0;
    for (let day = 0; day < 600; day += 1) {
        const level = levelForEarned(earned);
        if (level >= target) return day;
        const band = bandFor(level);
        const todayKey = new Date(START + day * DAY_MS).toISOString().slice(0, 10);

        // Training: the real seal for each session, on the day's ledger level.
        const fixture = { stats: {}, unspentStats: Math.floor(earned), ...BONUS_FIELDS[profile.bonus] };
        assert.equal(earnedStatPoints(fixture), Math.floor(earned));
        let gained = 0;
        for (const [id, count] of REGIMEN[profile.regimen]) {
            gained += trustedTrainingRewards(tierById.get(id)!, fixture).sealedGain * count;
        }

        // Claims, then the day's combat, all through the one shared budget.
        for (const [i, requested] of claimRequests(profile, band).entries()) {
            const claim = await reserveCombatStatBudget(store, {
                playerName: 'replay', battleId: `mission:${todayKey}:claim:${i}`, eventAt: START + day * DAY_MS, requested, cap,
            });
            gained += claim.points;
        }
        const combat = await reserveCombatStatBudget(store, {
            playerName: 'replay', battleId: `day-${day}`, eventAt: START + day * DAY_MS,
            requested: expectedCombatRequest(profile.routine, band), cap,
        });
        gained += combat.points;

        // Weekly grants, amortised per day as in the model.
        if (band >= 30 && weekly.boss) gained += WEEKLY_BOSS_POINTS / 7 + WORLD_BOSS_POINTS / 14;
        if (band >= weekly.apexFromBand) gained += APEX_STAT_POINTS / 7;

        // One-time grants: Story Tower from L30, story milestones on reaching them.
        if (level >= 30 && tower < STORY_TOWER_TOTAL) {
            const climb = Math.min(STORY_TOWER_PER_DAY[profile.routine], STORY_TOWER_TOTAL - tower);
            tower += climb;
            gained += climb;
        }
        STORY_LEVELS.forEach((storyLevel, i) => {
            if (level >= storyLevel && !storyClaimed.has(storyLevel)) {
                storyClaimed.add(storyLevel);
                gained += STORY_REWARDS[i].statPoints;
            }
        });
        earned += gained;
    }
    return Infinity;
}

const DIAL_ENV = ['STAT_GAIN_MULTIPLIER', 'TRAINING_RATE_TABLE'] as const;

async function withDials<T>(env: Partial<Record<typeof DIAL_ENV[number], string>>, run: () => Promise<T>): Promise<T> {
    const previous = DIAL_ENV.map((name) => process.env[name]);
    for (const name of DIAL_ENV) {
        if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
    }
    try { return await run(); } finally {
        DIAL_ENV.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    }
}

async function replayAll(t: TestContext, label: string, cap: number = DAILY_COMBAT_STAT_CAP): Promise<Record<string, number>> {
    const days: Record<string, number> = {};
    for (const profile of PROFILES) days[profile.name] = await daysToLevel(profile, 90, cap);
    t.diagnostic(`${label}: L10 → L90 days ${Object.entries(days).map(([name, d]) => `${name} ${d}`).join(', ')}`);
    return days;
}

describe('Phase 1A pacing replay (framework §1.1 targets, §8.2 gate)', () => {
    it('the default dials put every archetype inside its L10 → L90 target', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: START });
        assert.equal(DAILY_COMBAT_STAT_CAP, 60, 'the replay runs on the default shared budget');
        const days = await withDials({}, () => replayAll(t, `v2 table, shared budget ${DAILY_COMBAT_STAT_CAP}, dial 1`));
        assert.ok(days.regular >= 80 && days.regular <= 96, `regular ${days.regular} (gate 80-96; target 85-92; expected 86)`);
        assert.ok(days.casual <= 150, `casual ${days.casual} (ceiling 150; expected 142)`);
        assert.ok(days.hardcore >= 0.62 * days.regular, `hardcore ${days.hardcore} vs 0.62 × regular ${0.62 * days.regular} (expected 54)`);
        assert.ok(days['script optimiser'] >= 37, `script optimiser ${days['script optimiser']} (floor 37; expected 38)`);
        assert.ok(days['human optimiser'] >= 40, `human optimiser ${days['human optimiser']} (floor 40; expected 42)`);
        // Ordering sanity: more time and attention always means a faster climb.
        assert.ok(days.casual > days.regular && days.regular > days.hardcore && days.hardcore > days['human optimiser']
            && days['human optimiser'] > days['script optimiser']);
    });

    it('the kill values (legacy table, the budget dial at its maximum) restore the pre-rebalance pace', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: START });
        // DAILY_STAT_POINT_CAP is read at boot, so the replay passes the dial's
        // maximum straight to the reservations instead of through the env.
        const days = await withDials(
            { TRAINING_RATE_TABLE: 'legacy' },
            () => replayAll(t, `legacy table, shared budget ${DAILY_STAT_POINT_CAP_MAX}`, DAILY_STAT_POINT_CAP_MAX),
        );
        // The model's "today" column: casual 130, regular 77, hardcore 49, script 30.
        assert.ok(days.regular < 80, `regular ${days.regular} is faster than the gate without the rebalance`);
        assert.ok(days['script optimiser'] < 37, `script optimiser ${days['script optimiser']} beats its floor without the cap`);
    });
});
