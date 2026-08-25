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
        'hall:*', 'chat:village:*', 'auth:reckoning-*', 'save:reckoning-*',
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

describe('The Hollow Gate Reckoning authority', () => {
    it('awakens once from the first legitimate 79 to 80 crossing', { concurrency: false }, async () => {
        await authorize('reckoning-first');
        await authorize('reckoning-second');
        assert.equal(await stateApi.observeWorldCrisis80LevelCrossing({
            playerName: 'reckoning-first', beforeLevel: 80, afterLevel: 80,
            character: { name: 'Existing Elder', village: 'Stormveil Village' },
        }), false);
        assert.equal(await stateApi.observeWorldCrisis80LevelCrossing({
            playerName: 'reckoning-first', beforeLevel: 79, afterLevel: 80,
            character: { name: 'First Witness', village: 'Stormveil Village' }, now: 8_000,
        }), true);
        assert.equal(await stateApi.observeWorldCrisis80LevelCrossing({
            playerName: 'reckoning-second', beforeLevel: 79, afterLevel: 80,
            character: { name: 'Second Witness', village: 'Ashen Leaf Village' }, now: 8_001,
        }), false);

        const projection = await stateApi.readWorldCrisis80Projection();
        assert.equal(projection.status, 'active');
        assert.equal(projection.awakenedBy, 'First Witness');
        const announcements = await kv.get<Array<{ type?: string }>>('game:announcements');
        assert.equal(announcements?.filter((item) => item.type === 'world_crisis_80_awakened').length, 1);
    });

    it('keeps existing and credential-less saves out of server-first history', { concurrency: false }, async () => {
        await kv.set('auth:reckoning-guest', { guest: true });
        assert.equal(await stateApi.observeWorldCrisis80LevelCrossing({
            playerName: 'reckoning-guest', beforeLevel: 79, afterLevel: 80,
            character: { name: 'Temporary Witness', village: 'Moonshadow Village' },
        }), false);
        assert.equal((await stateApi.readWorldCrisis80Projection()).status, 'armed');
    });

    it('counts one contribution per proof and preserves the two defense paths', { concurrency: false }, async () => {
        await stateApi.applyWorldCrisis80AdminAction({ action: 'set-target', targetPerVillage: 20, now: 1_000 });
        await stateApi.applyWorldCrisis80AdminAction({ action: 'awaken-now', now: 1_001 });

        const shinobi = await stateApi.recordWorldCrisis80Defense({
            playerName: 'reckoning-defender', village: 'Stormveil Village',
            sourceId: 'hollow-gate-reckoning-v1:stormveil:triad', proofId: 'tower_run_proof_0001',
            path: 'shinobi', outcome: 'win', now: 2_000,
        });
        const replay = await stateApi.recordWorldCrisis80Defense({
            playerName: 'reckoning-defender', village: 'Stormveil Village',
            sourceId: 'hollow-gate-reckoning-v1:stormveil:triad', proofId: 'tower_run_proof_0001',
            path: 'shinobi', outcome: 'win', now: 2_001,
        });
        const companion = await stateApi.recordWorldCrisis80Defense({
            playerName: 'reckoning-defender', village: 'Stormveil Village',
            sourceId: 'hollow-gate-reckoning-v1:stormveil:pets', proofId: 'showdown_proof_0002',
            path: 'companion', outcome: 'win', now: 2_002,
        });
        assert.equal(shinobi.villages['Stormveil Village'].shinobiDefenses, 1);
        assert.equal(replay.villages['Stormveil Village'].defenses, 1);
        assert.equal(companion.villages['Stormveil Village'].defenses, 2);
        assert.equal(companion.villages['Stormveil Village'].companionDefenses, 1);
        assert.deepEqual(companion.topDefenders[0] && {
            wins: companion.topDefenders[0].wins,
            shinobiWins: companion.topDefenders[0].shinobiWins,
            companionWins: companion.topDefenders[0].companionWins,
        }, { wins: 2, shinobiWins: 1, companionWins: 1 });
    });
});
