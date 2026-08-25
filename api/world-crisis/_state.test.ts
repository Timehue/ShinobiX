import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let stateApi: typeof import('./_state.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    stateApi = await import('./_state.js');
});

beforeEach(async () => {
    for (const pattern of [
        'world:crisis:*', 'lock:world:crisis:*', 'game:announcements*',
        'hall:*', 'chat:village:*', 'auth:crisis-*', 'save:crisis-*',
        'audit:legacy',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function authorize(player: string) {
    await kv.set(`auth:${player}`, { hash: 'hash', salt: 'salt' });
}

describe('The Fourfold Breach authority', () => {
    it('awakens exactly once from a legitimate committed level crossing', { concurrency: false }, async () => {
        await authorize('crisis-first');
        await authorize('crisis-second');

        assert.equal(await stateApi.observeWorldCrisisLevelCrossing({
            playerName: 'crisis-first', beforeLevel: 37, afterLevel: 37,
            character: { name: 'First Shinobi', village: 'Stormveil Village' },
        }), false, 'an existing over-threshold account must not awaken on login');
        assert.equal(await stateApi.observeWorldCrisisLevelCrossing({
            playerName: 'crisis-first', beforeLevel: 36, afterLevel: 37,
            character: { name: 'First Shinobi', village: 'Stormveil Village' }, now: 1_000,
        }), true);
        assert.equal(await stateApi.observeWorldCrisisLevelCrossing({
            playerName: 'crisis-second', beforeLevel: 36, afterLevel: 37,
            character: { name: 'Second Shinobi', village: 'Ashen Leaf Village' }, now: 1_001,
        }), false);

        const projection = await stateApi.readWorldCrisisProjection();
        assert.equal(projection.status, 'active');
        assert.equal(projection.awakenedBy, 'First Shinobi');
        assert.equal(projection.awakenedVillage, 'Stormveil Village');
        const announcements = await kv.get<Array<{ type?: string; receiptId?: string }>>('game:announcements');
        assert.equal(announcements?.filter((item) => item.type === 'world_crisis_awakened').length, 1);
        assert.equal(announcements?.[0]?.receiptId, `${projection.runId}:awakening`);
    });

    it('excludes credential-less guests from permanent server-first history', { concurrency: false }, async () => {
        await kv.set('auth:crisis-guest', { guest: true });
        assert.equal(await stateApi.observeWorldCrisisLevelCrossing({
            playerName: 'crisis-guest', beforeLevel: 36, afterLevel: 37,
            character: { name: 'Temporary Guest', village: 'Moonshadow Village' },
        }), false);
        assert.equal((await stateApi.readWorldCrisisProjection()).status, 'armed');
    });

    it('credits one defense per unique sealed proof and resolves only after every village holds', { concurrency: false }, async () => {
        await stateApi.applyWorldCrisisAdminAction({ action: 'set-target', targetPerVillage: 10, now: 1_000 });
        await stateApi.applyWorldCrisisAdminAction({ action: 'awaken-now', now: 1_001 });

        const first = await stateApi.recordWorldCrisisDefense({
            playerName: 'crisis-defender', village: 'Stormveil Village',
            sourceId: 'fourfold-breach-v1:stormveil', proofId: 'proof_token_0001', outcome: 'win', now: 2_000,
        });
        const replay = await stateApi.recordWorldCrisisDefense({
            playerName: 'crisis-defender', village: 'Stormveil Village',
            sourceId: 'fourfold-breach-v1:stormveil', proofId: 'proof_token_0001', outcome: 'win', now: 2_001,
        });
        assert.equal(first.villages['Stormveil Village'].defenses, 1);
        assert.equal(replay.villages['Stormveil Village'].defenses, 1, 'a report replay cannot double-contribute');

        const suffixes = new Map([
            ['Stormveil Village', 'stormveil'], ['Ashen Leaf Village', 'ashen-leaf'],
            ['Frostfang Village', 'frostfang'], ['Moonshadow Village', 'moonshadow'],
        ] as const);
        let proof = 10;
        for (const [village, suffix] of suffixes) {
            const already = village === 'Stormveil Village' ? 1 : 0;
            for (let count = already; count < 10; count += 1) {
                proof += 1;
                await stateApi.recordWorldCrisisDefense({
                    playerName: `crisis-${suffix}`, village,
                    sourceId: `fourfold-breach-v1:${suffix}`,
                    proofId: `proof_token_${proof.toString().padStart(4, '0')}`,
                    outcome: 'win', now: 3_000 + proof,
                });
            }
        }
        const resolved = await stateApi.readWorldCrisisProjection();
        assert.equal(resolved.status, 'resolved');
        assert.equal(resolved.globalProgressPercent, 100);
        assert.ok(Object.values(resolved.villages).every((village) => village.integrityPercent === 100));
        const announcements = await kv.get<Array<{ type?: string }>>('game:announcements');
        assert.equal(announcements?.filter((item) => item.type === 'world_crisis_resolved').length, 1);
    });
});
