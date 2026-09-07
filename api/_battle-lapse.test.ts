process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The lapse dispatcher's record-only kinds (F01/F08). A Hollow Gate dive and
 * a pet showdown own their own endings and never involve the body, so a
 * "lapse" for them is only ever a projection that outlived its record. The
 * dispatcher retires such a projection and never invents a consequence.
 */

let kv: typeof import('./_storage.js').kv;
let onlineStore: typeof import('./_realtime/online-store.js').onlineStore;
let reconcileLapsedBattle: typeof import('./_battle-lapse.js').reconcileLapsedBattle;
let resetLapseReconciliationForTests: typeof import('./_battle-lapse.js').resetLapseReconciliationForTests;
let battleStateKey: typeof import('./_realtime/battle-projection.js').battleStateKey;

const PLAYER = 'lapsediver';
const NOW = 1_800_000_000_000;

function projection(kind: 'hollow-gate' | 'pet-showdown', sessionId: string) {
    return { version: 1, kind, sessionId, startedAt: NOW, expiresAt: NOW + 60_000 };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore } = await import('./_realtime/online-store.js'));
    ({ reconcileLapsedBattle, resetLapseReconciliationForTests } = await import('./_battle-lapse.js'));
    ({ battleStateKey } = await import('./_realtime/battle-projection.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    onlineStore.remove(PLAYER);
    onlineStore.upsert({ name: PLAYER, sector: 3, character: null });
    onlineStore.setInBattle(PLAYER, true);
    resetLapseReconciliationForTests();
});

after(async () => {
    onlineStore.remove(PLAYER);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

describe('lapse reconciliation — record-only kinds retire stale projections and nothing else', { concurrency: false }, () => {
    it('keeps a Hollow Gate projection whose run key still exists, and retires one whose dive is over', async () => {
        await kv.set(battleStateKey(PLAYER), projection('hollow-gate', 'tok-1'));
        await kv.set(`hg-run:${PLAYER}:tok-1`, { mintedAt: NOW });
        const kept = await reconcileLapsedBattle({ kind: 'hollow-gate', sessionId: 'tok-1' }, PLAYER, NOW);
        assert.deepEqual(kept, { kind: 'hollow-gate', sessionId: 'tok-1', transitioned: false, settled: false });
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'a live dive keeps its projection');
        assert.equal(onlineStore.get(PLAYER)?.inBattle, true);

        resetLapseReconciliationForTests();
        await kv.del(`hg-run:${PLAYER}:tok-1`);
        const retired = await reconcileLapsedBattle({ kind: 'hollow-gate', sessionId: 'tok-1' }, PLAYER, NOW);
        assert.equal(retired.transitioned, false);
        assert.equal(await kv.get(battleStateKey(PLAYER)), null, 'the projection is retired');
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined, 'and presence ends with it');
    });

    it('retires a showdown projection once its session is finished or gone, and never touches the save', async () => {
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, hp: 50, maxHp: 100 } });
        await kv.set(battleStateKey(PLAYER), projection('pet-showdown', 'sd-1'));
        await kv.set(`pet:showdown:${PLAYER}:sd-1`, { sessionId: 'sd-1', playerName: PLAYER, finished: false });
        await reconcileLapsedBattle({ kind: 'pet-showdown', sessionId: 'sd-1' }, PLAYER, NOW);
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'an unfinished showdown keeps its projection');

        resetLapseReconciliationForTests();
        await kv.set(`pet:showdown:${PLAYER}:sd-1`, { sessionId: 'sd-1', playerName: PLAYER, finished: true, outcome: 'loss' });
        await reconcileLapsedBattle({ kind: 'pet-showdown', sessionId: 'sd-1' }, PLAYER, NOW);
        assert.equal(await kv.get(battleStateKey(PLAYER)), null);
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined);
        const save = await kv.get<{ character?: { hp?: number } }>(`save:${PLAYER}`);
        assert.equal(save?.character?.hp, 50, 'a pet fight never involves the body');
    });

    it('a projection for another player is never retired by a reconciliation naming a different fight', async () => {
        await kv.set(battleStateKey(PLAYER), projection('hollow-gate', 'tok-2'));
        await reconcileLapsedBattle({ kind: 'hollow-gate', sessionId: 'tok-1' }, PLAYER, NOW);
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'retirement is fenced on the session it names');
    });
});
