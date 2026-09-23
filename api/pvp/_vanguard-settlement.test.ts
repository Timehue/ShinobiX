import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import type { PvpSession } from './session.js';
import {
    grantVanguardRewardsForSession,
    parseVanguardRewardSettlementMarker,
    VANGUARD_REWARD_SETTLEMENT_FIELD,
} from './_vanguard-rewards.js';

const NOW = 1_850_000_000_000;
const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

async function setup() {
    const store = _makeMemoryKv();
    await store.set('save:alice', { _saveVersion: 1, character: {
        name: 'Alice', profession: 'vanguard', professionRank: 1, professionXp: 0,
        level: 50, honorSeals: 0,
    } });
    await store.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', level: 50 } });
    const session = (id: string, loserLevel: number) => ({
        battleId: `pvp-vanguard-${id}`,
        status: 'done', winner: 'p1', rewardAuthority: 'challenge',
        vanguardRewardAuthorityVersion: 2,
        p1: { name: 'Alice', character: { profession: 'vanguard', professionRank: 1, level: 50 } },
        p2: { name: 'Bob', character: { level: loserLevel } },
        joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
        baseRewards: true, createdAt: NOW - 60_000, lastMoveAt: NOW,
    } as unknown as PvpSession);
    const grant = (battle: PvpSession) => grantVanguardRewardsForSession(battle, {
        store, lock, now: NOW + 1, overlap: async () => false,
    });
    const record = async () => (await store.get<Record<string, any>>('save:alice'))!;
    return { store, session, grant, record };
}

test('a rewarded win after a level-gap no-payout remains replayable', async () => {
    const { session, grant, record } = await setup();
    assert.deepEqual(await grant(session('gap', 1)), { granted: false, reason: 'level-gap' });
    const battle = session('paid', 50);
    assert.deepEqual(await grant(battle), { granted: true, seals: 1, xp: 300 });
    const paid = await record();
    assert.ok(parseVanguardRewardSettlementMarker(paid.character[VANGUARD_REWARD_SETTLEMENT_FIELD]));
    assert.deepEqual(paid.character[VANGUARD_REWARD_SETTLEMENT_FIELD].outcome,
        { granted: true, seals: 1, xp: 300 });
    assert.equal((await grant(battle)).reason, 'already-granted');
    assert.deepEqual(await record(), paid, 'retry must not credit or rewrite the save');

    const noPayout = session('gap-again', 1);
    assert.deepEqual(await grant(noPayout), { granted: false, reason: 'level-gap' });
    const skipped = await record();
    assert.deepEqual(skipped.character[VANGUARD_REWARD_SETTLEMENT_FIELD].outcome,
        { granted: false, reason: 'level-gap' });
    assert.equal((await grant(noPayout)).reason, 'already-granted');
    assert.equal(skipped.character.honorSeals, paid.character.honorSeals);
    assert.equal(skipped.character.professionXp, paid.character.professionXp);
});

for (const granted of [true, false]) {
    test(`repairs the merged ${granted ? 'paid' : 'no-payout'} marker from its exact committed receipt`, async () => {
        const { store, session, grant, record } = await setup();
        const battle = session('repair', granted ? 50 : 1);
        await grant(battle);
        const before = await record();
        const marker = before.character[VANGUARD_REWARD_SETTLEMENT_FIELD];
        const broken = structuredClone(before);
        broken.character[VANGUARD_REWARD_SETTLEMENT_FIELD].outcome = {
            granted, seals: 1, xp: 300, reason: 'level-gap',
        };
        await store.set('save:alice', broken);
        assert.equal((await grant(battle)).reason, 'already-granted');
        const after = await record();
        assert.deepEqual(after.character[VANGUARD_REWARD_SETTLEMENT_FIELD], marker);
        assert.equal(after.character.honorSeals, before.character.honorSeals);
        assert.equal(after.character.professionXp, before.character.professionXp);
        assert.equal(after._saveVersion, before._saveVersion + 1);
        assert.equal((await grant(battle)).reason, 'already-granted');
        assert.deepEqual(await record(), after);
    });
}

for (const conflict of ['missing', 'pending', 'owner', 'amount', 'extra-field']) {
    test(`does not repair a merged marker with ${conflict} confirmation evidence`, async () => {
        const { store, session, grant, record } = await setup();
        const battle = session('conflict', 50);
        await grant(battle);
        const broken = await record();
        const marker = broken.character[VANGUARD_REWARD_SETTLEMENT_FIELD];
        marker.outcome.reason = 'level-gap';
        const key = `pvp:vanguard-rewarded:${battle.battleId}`;
        const intent = (await store.get<Record<string, any>>(key))!;
        if (conflict === 'missing') await store.del(key);
        if (conflict === 'pending') await store.set(key, {
            ...intent, state: 'pending', outcome: null, markerSettledAt: null, leaseExpiresAt: NOW + 10_000,
        });
        if (conflict === 'owner') marker.ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        if (conflict === 'amount') marker.outcome.xp++;
        if (conflict === 'extra-field') marker.outcome.unknown = true;
        await store.set('save:alice', broken);
        await assert.rejects(grant(battle), /vanguard-reward-marker-invalid/);
        assert.deepEqual(await record(), broken, 'uncertain evidence must not change the save');
    });
}
