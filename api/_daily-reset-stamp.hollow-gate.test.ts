import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'daily-reset-stamp-hollow-gate-secret';

/*
 * PET-8 (2026-10 economy rebalance) for the Hollow Gate writer: a dive that is
 * the first save write of a new UTC day stamps lastDailyReset, so it must zero
 * the other counters keyed to that stamp. Before, yesterday's 20 missions and
 * 100 arena wins read as today's, and the save floor kept them there.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
let start: Handler;
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let hasDailyMissionSlot: typeof import('./missions/_mission-catalog.js').hasDailyMissionSlot;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ hasDailyMissionSlot } = await import('./missions/_mission-catalog.js'));
    start = (await import('./hollow-gate/start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a first Hollow Gate dive of the day zeroes yesterday\'s mission and arena counts', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'dailyresethgdive';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await kv.set(`save:${player}`, {
        _saveVersion: 1,
        character: {
            name: player, level: 34, village: 'Ashen Leaf Village', hp: 500, maxHp: 500,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }],
            lastDailyReset: yesterday, dailyMissionsCompleted: 20, dailyPetWins: 100, dailyFateSpins: 5,
        },
    });
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader: () => res, status: (s: number) => { out.status = s; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; }, end: () => res };
    await start({ method: 'POST', body: { playerName: player, requestId: 'daily-reset-hg-1' },
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player)! },
        socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const character = (await kv.get<Record<string, any>>(`save:${player}`))!.character;
    assert.equal(character.lastDailyReset, today);
    assert.equal(character.dailyHollowGateRuns, 1);
    assert.equal(character.dailyMissionsCompleted, 0, 'yesterday\'s 20 missions must not lock today\'s board');
    assert.equal(character.dailyPetWins, 0, 'yesterday\'s 100 wins must not lock today\'s arena');
    assert.equal(character.dailyFateSpins, 0);
    assert.ok(hasDailyMissionSlot(character, today));
});
