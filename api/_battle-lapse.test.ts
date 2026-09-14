process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter } from './pvp/session.js';

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

function projection(kind: 'hollow-gate' | 'pet-showdown' | 'card-clash', sessionId: string) {
    return { version: 1, kind, sessionId, startedAt: NOW, expiresAt: NOW + 60_000 };
}

function fighter(name: string, hp: number): PvpFighter {
    return {
        name, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: name === 'Diver' ? 62 : 63,
        character: { name, level: 20, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
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

    it('keeps a card duel projection while the match is live, and retires it once the duel is done', async () => {
        await kv.set(battleStateKey(PLAYER), projection('card-clash', 'cc-freeplay:m1'));
        await kv.set('cc-freeplay:m1', { p1Name: PLAYER, p2Name: 'someoneelse', status: 'active' });
        const kept = await reconcileLapsedBattle({ kind: 'card-clash', sessionId: 'cc-freeplay:m1' }, PLAYER, NOW);
        assert.deepEqual(kept, { kind: 'card-clash', sessionId: 'cc-freeplay:m1', transitioned: false, settled: false });
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'a live match keeps its projection');
        assert.equal(onlineStore.get(PLAYER)?.inBattle, true);

        resetLapseReconciliationForTests();
        await kv.set('cc-freeplay:m1', { p1Name: PLAYER, p2Name: 'someoneelse', status: 'done' });
        const retired = await reconcileLapsedBattle({ kind: 'card-clash', sessionId: 'cc-freeplay:m1' }, PLAYER, NOW);
        assert.equal(retired.transitioned, false, 'nothing is terminalized: the duel owns its own ending');
        assert.equal(await kv.get(battleStateKey(PLAYER)), null, 'the projection is retired');
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined, 'and presence ends with it');
    });

    it('a projection for another player is never retired by a reconciliation naming a different fight', async () => {
        await kv.set(battleStateKey(PLAYER), projection('hollow-gate', 'tok-2'));
        await reconcileLapsedBattle({ kind: 'hollow-gate', sessionId: 'tok-1' }, PLAYER, NOW);
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'retirement is fenced on the session it names');
    });
});

describe('lapse reconciliation — a fight inside a Hollow Gate dive is voided, never abandoned', { concurrency: false }, () => {
    it('deletes the lapsed row and retires the projection without touching the body: the dive restarts the encounter', async () => {
        const { createSoloPveSession } = await import('./solo-pve/_session.js');
        const { writeSoloPveSession, readSoloPveSession } = await import('./solo-pve/_store.js');
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, hp: 50, maxHp: 100 } });
        const now = Date.now();
        const session = createSoloPveSession({
            sessionId: 'hgcombat-abc123', ownerSlug: PLAYER,
            encounter: { kind: 'hollow-gate', id: 'floor-3:warden', bindingId: 'hgcombat-abc123' },
            player: fighter('Diver', 30), enemy: fighter('Warden', 90),
            now: now - 3 * 60 * 60_000, // long past its gameplay expiry by the real clock
        });
        await writeSoloPveSession(session);
        assert.ok(await kv.get(battleStateKey(PLAYER)), 'creation published the projection');

        const result = await reconcileLapsedBattle({ kind: 'solo-pve', sessionId: 'hgcombat-abc123' }, PLAYER, now);
        assert.deepEqual(result, { kind: 'solo-pve', sessionId: 'hgcombat-abc123', transitioned: true, settled: false });
        assert.equal(await readSoloPveSession('hgcombat-abc123'), null, 'voided: a lapse is not a loss, and the dive owns the consequence');
        assert.equal(await kv.get(battleStateKey(PLAYER)), null, 'the projection is retired');
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined);
        assert.equal((await kv.get<{ character: { hp: number } }>(`save:${PLAYER}`))?.character.hp, 50, 'no defeat, no hospital, no charge');
    });
});
