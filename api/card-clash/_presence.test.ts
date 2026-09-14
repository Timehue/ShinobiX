import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import {
    battleStateKey,
    isBattleStateProjection,
    resetBattleAuthorityCacheForTests,
} from '../_realtime/battle-projection.js';
import { onlineStore } from '../_realtime/online-store.js';
import { cardDuelEngages, syncCardDuelPresence } from './_presence.js';

/*
 * F01 — a Chronicle card duel is provable battle presence. The three duel
 * hosts share one session shape (two duelist names and a status ending in
 * `done`); after every write the host syncs a battle projection per duelist
 * naming the session's own KV key, which the heartbeat's resolver reads back.
 */

const NOW = 1_800_000_000_000;

describe('card duel presence — a live match is provable presence for each duelist', () => {
    let kv: ReturnType<typeof _makeMemoryKv>;

    beforeEach(() => {
        kv = _makeMemoryKv();
        resetBattleAuthorityCacheForTests();
        onlineStore.remove('rill');
        onlineStore.remove('kaede');
    });

    it('publishes a projection naming the session key for each seated duelist once the match is live', async () => {
        onlineStore.upsert({ name: 'rill', sector: 3, character: null });
        await syncCardDuelPresence(kv, 'cc-freeplay:m1', { p1Name: 'Rill', status: 'awaiting-opponent' }, 600, NOW);
        assert.equal(await kv.get(battleStateKey('rill')), null, 'an open seat is not a fight: a challenge is never a roaming shield');
        assert.equal(onlineStore.get('rill')?.inBattle, undefined);

        await syncCardDuelPresence(kv, 'cc-freeplay:m1', { p1Name: 'Rill', p2Name: 'Kaede', status: 'active' }, 600, NOW + 1);
        const mine = await kv.get(battleStateKey('rill'));
        assert.ok(isBattleStateProjection(mine));
        assert.equal(mine.kind, 'card-clash');
        assert.equal(mine.sessionId, 'cc-freeplay:m1', 'the projection names the row the resolver verifies');
        assert.equal(mine.expiresAt, NOW + 1 + 600_000);
        assert.ok(isBattleStateProjection(await kv.get(battleStateKey('kaede'))), 'both duelists are covered');
        assert.equal(onlineStore.get('rill')?.inBattle, true, 'the presence flag follows the start hook');
    });

    it('retires both projections once the duel is done, and never one that names a different fight', async () => {
        await syncCardDuelPresence(kv, 'cc-freeplay:m1', { p1Name: 'Rill', p2Name: 'Kaede', status: 'active' }, 600, NOW);
        await kv.set(battleStateKey('kaede'), { version: 1, kind: 'solo-pve', sessionId: 'run-9', startedAt: NOW, expiresAt: NOW + 60_000 });
        await syncCardDuelPresence(kv, 'cc-freeplay:m1', { p1Name: 'Rill', p2Name: 'Kaede', status: 'done' }, 600, NOW + 5);
        assert.equal(await kv.get(battleStateKey('rill')), null);
        const theirs = await kv.get(battleStateKey('kaede'));
        assert.ok(isBattleStateProjection(theirs) && theirs.sessionId === 'run-9', 'a projection for another fight is left alone');
    });

    it('cardDuelEngages: a duelist in a live match; nobody in an open, finished or missing one', () => {
        assert.equal(cardDuelEngages({ p1Name: 'Rill', p2Name: 'Kaede', status: 'active' }, 'rill'), true);
        assert.equal(cardDuelEngages({ p1Name: 'Rill', p2Name: 'Kaede', status: 'active' }, 'Kaede'), true);
        assert.equal(cardDuelEngages({ p1Name: 'Rill', p2Name: 'Kaede', status: 'active' }, 'sora'), false);
        assert.equal(cardDuelEngages({ p1Name: 'Rill', status: 'awaiting-p2' }, 'rill'), false);
        assert.equal(cardDuelEngages({ p1Name: 'Rill', p2Name: 'Kaede', status: 'done' }, 'rill'), false);
        assert.equal(cardDuelEngages(null, 'rill'), false);
    });
});
