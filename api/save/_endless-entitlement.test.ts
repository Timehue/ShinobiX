import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char) =>
    sanitizeCharacterSave({ character: incoming }, { character: existing }).character as Record<string, unknown>;

test('generic saves cannot forge or erase Endless Tower authority state', () => {
    const run = { runToken: 'server-token-123456', wave: 7, bankedRyo: 800, bankedXp: 300, startedAt: 1 };
    const receipt = { key: 'proof-token-123456', action: 'win', reward: { ryo: 100, xp: 50 } };
    const out = sanitize(
        {
            endlessTowerRun: { ...run, wave: 200, bankedRyo: 100_000, bankedXp: 50_000 },
            endlessTowerBestWave: 200,
            totalEndlessTowerWins: 999,
            dailyTowerXp: 0,
            dailyEndlessRuns: 0,
            dailyEndlessDate: '2099-01-01',
            redeemedEndlessActions: [],
        },
        {
            endlessTowerRun: run,
            endlessTowerBestWave: 6,
            totalEndlessTowerWins: 6,
            dailyTowerXp: 300,
            dailyEndlessRuns: 2,
            dailyEndlessDate: '2026-07-12',
            redeemedEndlessActions: [receipt],
        },
    );

    assert.deepEqual(out.endlessTowerRun, run);
    assert.equal(out.endlessTowerBestWave, 6);
    assert.equal(out.totalEndlessTowerWins, 6);
    assert.equal(out.dailyTowerXp, 300);
    assert.equal(out.dailyEndlessRuns, 2);
    assert.equal(out.dailyEndlessDate, '2026-07-12');
    assert.deepEqual(out.redeemedEndlessActions, [receipt]);
});
