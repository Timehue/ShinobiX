import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// I-19 (2026-10 economy rebalance): the world boss package is recorded in the
// economy ledger by the committed credit only, so a replayed settlement logs
// nothing a second time.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

const PLAYER = 'worldbossrewardledger';

let kv: typeof import('../_storage.js').kv;
let settleWorldBossReward: typeof import('./_reward.js').settleWorldBossReward;
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;
let ECON_TXN_LIST_KEY: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleWorldBossReward } = await import('./_reward.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    ({ ECON_TXN_LIST_KEY } = await import('../_economy.js'));
});

after(async () => {
    await drainBackgroundWork();
    const keys = await kv.keys('*');
    if (keys.length > 0) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('a replayed world boss settlement pays and logs its package once', async () => {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, level: 30, unspentStats: 0, spentStats: {}, examsPassed: [], ryo: 1_000, boneCharms: 4, inventory: [],
            maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 100, chakra: 100, stamina: 100,
        },
    });
    const input = { eventId: 'wbe-ledger-test', eventStartedAt: Date.now() - 60_000, playerSlug: PLAYER };
    const first = await settleWorldBossReward(input);
    const second = await settleWorldBossReward(input);
    assert.equal(first?.reward.ryo, 2_500);
    assert.equal(second?.reward.ryo, 2_500, 'the replay answers from the stored receipt');
    const saved = await kv.get<{ character?: Record<string, unknown> }>(`save:${PLAYER}`);
    assert.equal(saved?.character?.ryo, 3_500);
    assert.equal(saved?.character?.boneCharms, 6);

    await drainBackgroundWork();
    const txns = ((await kv.get<Record<string, unknown>[]>(ECON_TXN_LIST_KEY)) ?? [])
        .filter((txn) => txn.source === 'worldboss.reward')
        .map((txn) => [txn.currency, txn.delta])
        .sort();
    assert.deepEqual(txns, [['boneCharms', 2], ['ryo', 2_500]]);
});
