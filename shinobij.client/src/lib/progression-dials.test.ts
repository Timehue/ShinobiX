import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    FETCH_S_MISSION_ID, HUNT_AS_MIN_LEVEL, HUNT_DROP_CHANCE_DEFAULTS, HUNT_FS_MIN_LEVEL, SEAL_SPEEDUP_MINUTES_PER_SEAL,
} from '../constants/game';
import {
    DAILY_STAT_POINT_CAP_MAX,
    dailyStatBudgetLine,
    dailyStatBudgetToday,
    dailyStatPointsAvailable,
    missionDropChanceText,
    missionStatPointText,
    normalizeProgressionDials,
    sharedProgressionDials,
} from './progression-dials';
import { setSharedDailyStatBudget, setSharedProgressionDialsPayload } from './progression-dials-store';
import {
    FETCH_S_MISSION_ID as SERVER_FETCH_S_MISSION_ID,
    HUNT_AS_CHANCE_DEFAULT,
    HUNT_AS_MIN_LEVEL as SERVER_HUNT_AS_MIN_LEVEL,
    HUNT_FS_CHANCE_DEFAULT,
    HUNT_FS_MIN_LEVEL as SERVER_HUNT_FS_MIN_LEVEL,
    huntAsChance,
    huntFsChance,
} from '../../../api/missions/_mission-catalog';
import { trainingRateTable } from '../../../api/_training-config';
import { DAILY_STAT_POINT_CAP_MAX as SERVER_CAP_MAX, dailyStatPointCap, statGainMultiplier } from '../../../api/_stat-growth';
import { DAILY_STAT_POINT_CAP } from '../../../shared/combat-growth-rules';
import { MINUTES_PER_SEAL } from '../../../api/jutsu/speedup';

// The client mirrors of the server progression dials (api/game-state.ts
// `progressionDials`) and of the Honor Seal speed-up price. The server applies
// all of them; these copies only keep previews and card text honest.

const DIAL_ENV = ['DAILY_STAT_POINT_CAP', 'HUNT_FS_CHANCE', 'HUNT_AS_CHANCE', 'TRAINING_RATE_TABLE', 'STAT_GAIN_MULTIPLIER'] as const;

function withServerEnv(env: Partial<Record<typeof DIAL_ENV[number], string>>, run: () => void) {
    const previous = DIAL_ENV.map((name) => process.env[name]);
    try {
        for (const name of DIAL_ENV) {
            if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
        }
        run();
    } finally {
        DIAL_ENV.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    }
}

const DEFAULTS = { statGainMultiplier: 1, trainingRateTable: 'v2', dailyStatPointCap: 60, huntDropChances: { fateShards: 0.25, auraStones: 0.2 } };

describe('progression dials — client mirrors the server', () => {
    it('display defaults equal the server dial defaults and ranges', () => {
        assert.equal(DAILY_STAT_POINT_CAP_MAX, SERVER_CAP_MAX);
        assert.deepEqual(HUNT_DROP_CHANCE_DEFAULTS, { fateShards: HUNT_FS_CHANCE_DEFAULT, auraStones: HUNT_AS_CHANCE_DEFAULT });
        assert.equal(HUNT_FS_MIN_LEVEL, SERVER_HUNT_FS_MIN_LEVEL);
        assert.equal(HUNT_AS_MIN_LEVEL, SERVER_HUNT_AS_MIN_LEVEL);
        assert.equal(FETCH_S_MISSION_ID, SERVER_FETCH_S_MISSION_ID);
    });

    it('the speed-up buttons quote the server price', () => {
        assert.equal(SEAL_SPEEDUP_MINUTES_PER_SEAL, MINUTES_PER_SEAL);
    });

    it('falls back to the code defaults before the first frame or on a malformed one', () => {
        for (const raw of [undefined, null, 'x', [], {}]) assert.deepEqual(normalizeProgressionDials(raw), DEFAULTS);
        assert.deepEqual(normalizeProgressionDials({
            statGainMultiplier: -1, trainingRateTable: 'v9', dailyStatPointCap: 301, huntDropChances: { fateShards: 2, auraStones: -1 },
        }), DEFAULTS);
        assert.deepEqual(normalizeProgressionDials({ dailyStatPointCap: 59.5, huntDropChances: { fateShards: '', auraStones: null } }), DEFAULTS);
        assert.deepEqual(normalizeProgressionDials({
            statGainMultiplier: 9, trainingRateTable: 'legacy', dailyStatPointCap: 0, huntDropChances: { fateShards: 1, auraStones: 0 },
        }), { statGainMultiplier: 2.5, trainingRateTable: 'legacy', dailyStatPointCap: 0, huntDropChances: { fateShards: 1, auraStones: 0 } });
    });

    it('whatever the server publishes round-trips through the frame unchanged', () => {
        for (const env of [{}, { DAILY_STAT_POINT_CAP: '45', HUNT_FS_CHANCE: '0.1', HUNT_AS_CHANCE: '0', TRAINING_RATE_TABLE: 'legacy', STAT_GAIN_MULTIPLIER: '1.06' }]) {
            withServerEnv(env, () => {
                // api/game-state.ts publishes the boot-resolved cap, which is the dial.
                const frame = {
                    statGainMultiplier: statGainMultiplier(), trainingRateTable: trainingRateTable(),
                    dailyStatPointCap: dailyStatPointCap(), huntDropChances: { fateShards: huntFsChance(), auraStones: huntAsChance() },
                };
                assert.deepEqual(normalizeProgressionDials(JSON.parse(JSON.stringify(frame))), frame);
            });
        }
        assert.equal(DEFAULTS.dailyStatPointCap, DAILY_STAT_POINT_CAP);
    });
});

describe('the shared daily stat-point budget on the mission cards (owner A9)', () => {
    it('shows "Stat points today" once a claim today reported it, and drops a stale day', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 21, 12, 0, 0) });
        try {
            setSharedProgressionDialsPayload(null);
            assert.equal(dailyStatBudgetLine('rin'), null, 'nothing before a reply');
            assert.equal(dailyStatPointsAvailable('rin'), true, 'unknown counts as available');
            assert.equal(missionStatPointText('rin', 3), '+3 Stat Pts');

            setSharedDailyStatBudget('rin', { day: '2026-10-21', spent: 41, cap: 60 });
            assert.equal(dailyStatBudgetLine('rin'), 'Stat points today: 41 / 60');
            assert.equal(dailyStatBudgetLine('kai'), null, 'another player never sees it');
            assert.equal(missionStatPointText('rin', 3), '+3 Stat Pts');

            setSharedDailyStatBudget('rin', { day: '2026-10-21', spent: 60, cap: 60 });
            assert.equal(dailyStatPointsAvailable('rin'), false);
            assert.equal(missionStatPointText('rin', 3), 'Daily stat points reached (60 / 60)');

            setSharedDailyStatBudget('rin', { day: '2026-10-20', spent: 60, cap: 60 });
            assert.equal(dailyStatBudgetToday('rin'), null, 'yesterday\'s spend never counts');
            assert.equal(dailyStatPointsAvailable('rin'), true);

            setSharedProgressionDialsPayload({ dailyStatPointCap: 0 });
            assert.equal(missionStatPointText('rin', 3), 'Daily stat points reached', 'the dial at 0 stops every grant');
        } finally {
            setSharedProgressionDialsPayload(null);
        }
    });

    it('names the hunt drop chances the server rolls at the player\'s level', () => {
        try {
            setSharedProgressionDialsPayload(null);
            assert.equal(missionDropChanceText(19, 'hunt'), null);
            assert.equal(missionDropChanceText(20, 'hunt'), '25% Fate Shard');
            assert.equal(missionDropChanceText(50, 'hunt'), '25% Fate Shard · 20% Aura Stone');
            assert.equal(missionDropChanceText(70, 'fetch-s'), '25% Fate Shard', 'fetch-S never rolls an Aura Stone');
            setSharedProgressionDialsPayload({ huntDropChances: { fateShards: 0, auraStones: 0.35 } });
            assert.equal(sharedProgressionDials().huntDropChances.auraStones, 0.35);
            assert.equal(missionDropChanceText(60, 'hunt'), '35% Aura Stone');
        } finally {
            setSharedProgressionDialsPayload(null);
        }
    });
});
