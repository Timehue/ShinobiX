import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { relicRewardRoll, relicDropPool, relicForDropRoll } from './_relic-rewards.js';
import type { PvpSession } from './pvp/session.js';
import type { TowerSession } from './towers/_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
let kv: typeof import('./_storage.js').kv;
let ranked: typeof import('./pvp/_relic-reward.js').settleRankedRelicReward;
let tower: typeof import('./towers/_relic-reward.js').settleTowerRelicReward;
before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ settleRankedRelicReward: ranked } = await import('./pvp/_relic-reward.js'));
    ({ settleTowerRelicReward: tower } = await import('./towers/_relic-reward.js'));
});
beforeEach(async () => {
    for (const pattern of ['save:*', 'player-fp:*', 'player-ip:*']) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set('save:alice', { _saveVersion: 1, character: { name: 'alice', level: 100, inventory: [], fateShards: 0 } });
});
async function saved() {
    return (await kv.get<{ character: Record<string, unknown> }>('save:alice'))!.character;
}
function winningId(kind: 'pvp' | 'tower') {
    const wanted = kind === 'pvp' ? 'relic-duelists-red-cord' : 'relic-skybreak-prism';
    for (let n = 0; n < 100000; n++) {
        const roll = relicRewardRoll({ kind, id: `win-${n}`, level: 100, eventAt: 0 }, 'alice');
        if (relicForDropRoll(relicDropPool(kind, 100, 15), roll) === wanted) return `win-${n}`;
    }
    throw new Error('No deterministic winning fixture');
}
function pvp(): PvpSession {
    return { battleId: winningId('pvp'), status: 'done', winner: 'p1', ranked: true, rankedKind: 'player', rewardAuthority: 'ranked',
        joined: { p1: true, p2: true }, endedAt: Date.now(),
        p1: { name: 'alice', character: { level: 100 } }, p2: { name: 'bob', character: { level: 100 } },
    } as unknown as PvpSession;
}
function run(): TowerSession {
    return { towerId: 'celestial', runId: winningId('tower'), floor: 15, status: 'done', winner: 'squad', lastActionAt: Date.now(),
        actors: [{ side: 'squad', ownerSlug: 'alice', ai: false, character: { level: 100 } }],
    } as unknown as TowerSession;
}
test('ranked winner commits once; loser, pet, admin, spars and shared-device wins cannot roll', async () => {
    const s = pvp();
    for (const patch of [{ status: 'active' }, { ranked: false }, { rankedKind: 'pet' }, { rewardAuthority: 'admin' }, { winner: 'draw' }, { joined: { p1: true, p2: false } }, { p1: { ...s.p1, character: { level: 99 } } }]) {
        await ranked({ ...s, ...patch } as PvpSession);
        assert.equal((await saved()).relicRewardLedger, undefined);
    }
    await kv.set('player-fp:alice:shared', 1);
    await kv.set('player-fp:bob:shared', 1);
    await ranked(s);
    assert.equal((await saved()).relicRewardLedger, undefined);
    await kv.del('player-fp:bob:shared');
    await ranked(s);
    assert.deepEqual((await saved()).inventory, ['relic-duelists-red-cord']);
    await ranked(s);
    assert.deepEqual((await saved()).inventory, ['relic-duelists-red-cord']);
    assert.equal((await saved()).fateShards, 0);
    assert.equal(await kv.get('save:bob'), null);
});
test('public late-floor human victory commits once; embedded modes and borrowed allies never roll', async () => {
    const s = run();
    for (const patch of [{ towerId: 'mission' }, { floor: 9 }, { winner: 'enemy' }, { status: 'active' },
        { actors: [{ ...s.actors[0], ai: true }] }, { actors: [{ ...s.actors[0], character: { level: 69 } }] }]) {
        assert.equal((await tower({ ...s, ...patch } as TowerSession, 'alice')).reason, 'ineligible');
        assert.equal((await saved()).relicRewardLedger, undefined);
    }
    const first = await tower(s, 'alice');
    assert.equal(first.itemId, 'relic-skybreak-prism');
    assert.equal((await tower(s, 'alice')).itemId, first.itemId);
    assert.deepEqual((await saved()).inventory, [first.itemId]);
    assert.equal((await saved()).fateShards, 0);
});
