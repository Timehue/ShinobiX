/** Read-only gameplay probes. Writes only dated audit evidence; never loads a player save. */
import { writeFileSync } from 'node:fs';
import { TRAINING_TIERS, trainingStatGain } from '../api/_training-config.js';
import { trustedTrainingRewards } from '../api/training/_session.js';
import { earnedForLevel, levelForEarned } from '../api/_xp-engine.js';
import { FIELD_MISSIONS, FIELD_MISSION_STAT_POINTS, combatMissionByKey } from '../api/missions/_mission-catalog.js';
import { DAILY_COMBAT_STAT_CAP } from '../api/_stat-growth.js';
import { jutsuRyoTrainingCost } from '../api/training/_jutsu-ryo.js';
import { MISSION_KEYS, DISCIPLINES, missionSession, simulate, type Policy } from './mission-encounter-sim.js';

if (process.env.STAT_GAIN_MULTIPLIER && Number(process.env.STAT_GAIN_MULTIPLIER) !== 1) {
    throw new Error('This baseline probe requires STAT_GAIN_MULTIPLIER=1.');
}
const schedules = {
    one_8h: ['8h'],
    two_8h: ['8h', '8h'],
    three_8h: ['8h', '8h', '8h'],
    reference_24h: [...Array(12).fill('1h'), '4h', '8h'],
    theoretical_96_short: Array(96).fill('15m'),
};
const pacing = [];
for (const [name, ids] of Object.entries(schedules)) {
    for (const daily of [false, true]) {
        let points = earnedForLevel(10);
        const milestones: Record<string, number> = {};
        let day = 0;
        while (points < earnedForLevel(100) && day < 500) {
            day++;
            for (const id of ids) {
                const tier = TRAINING_TIERS.find(t => t.id === id)!;
                points += trustedTrainingRewards(tier, { unspentStats: points }).sealedGain;
            }
            if (daily) {
                const level = levelForEarned(points);
                points += FIELD_MISSIONS.filter(m => m.levelReq <= level).length * FIELD_MISSION_STAT_POINTS + DAILY_COMBAT_STAT_CAP;
            }
            for (const target of [13, 15, 20, 30, 35, 39, 50, 70, 80, 100]) {
                if (points >= earnedForLevel(target) && milestones[target] === undefined) milestones[target] = day;
            }
        }
        pacing.push({ schedule: name, fullAvailableDailyChecklistAndCombatCap: daily, milestonesInCompletedDays: milestones });
    }
}
const fights = [];
for (const key of MISSION_KEYS) {
    const minLevel = combatMissionByKey(key)!.min;
    for (const level of [minLevel, Math.min(100, minLevel + 8), Math.min(100, minLevel + 25)]) {
        for (const discipline of DISCIPLINES) {
            for (const policy of ['damage', 'guard', 'answer', 'close'] as Policy[]) {
                const initial = missionSession(key, level, discipline);
                if (!Number.isInteger(level) || initial.player.character.level !== level) throw new Error('Invalid fixture level');
                const { metrics } = simulate(initial, policy);
                const { elapsedMs, enemyTurnMs, ...deterministic } = metrics;
                fights.push({ key, level, discipline, policy, ...deterministic });
            }
        }
    }
}
const summary = MISSION_KEYS.map(key => {
    const rows = fights.filter(f => f.key === key && f.policy === 'damage');
    return { key, count: rows.length, wins: rows.filter(f => f.outcome === 'win').length,
        outcomes: [...new Set(rows.map(f => f.outcome))], rounds: [Math.min(...rows.map(f => f.rounds)), Math.max(...rows.map(f => f.rounds))] };
});
const report = {
    node: process.version, platform: process.platform,
    assumptions: 'Start at Academy floor L10; default era, no bonuses/events; all earned points available; exams pass instantly; no missed starts, travel, recovery, stamina or ryo constraints; daily grants credited after training. Not a time-to-level forecast. Full dailies means all level-eligible built-in hunt/fetch claims plus shared combat cap. Other grants excluded.',
    tiers: TRAINING_TIERS.map(t => ({ id: t.id, gain: trainingStatGain(t, t.ms), hourly: trainingStatGain(t, t.ms) / (t.ms / 3600000) })),
    thresholds: Object.fromEntries([10, 13, 15, 20, 30, 35, 39, 50, 70, 80, 100].map(level => [level, earnedForLevel(level)])),
    firstPaidJutsuLessonRyo: jutsuRyoTrainingCost(1),
    pacing, fightSummary: summary, fights,
};
writeFileSync('docs/audits/gameplay-loop-evidence-2026-09-29.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, fights: `${fights.length} deterministic fights saved in evidence JSON` }, null, 2));
