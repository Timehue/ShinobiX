import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let camps: typeof import('./sleeper-camps.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    camps = await import('./sleeper-camps.js');
});

beforeEach(async () => {
    await kv.del(camps.SLEEPER_CAMPS_KEY);
    camps.__resetBeatClearedForTest();
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

const NOW = 1_000_000;
const camp = (name: string, sector = 12) => ({ name, displayName: name, sector, createdAt: NOW });

describe('heartbeat sleeper-camp clear', () => {
    it('clears a camp on the first beat and skips the shared-row rewrite on the next beats', { concurrency: false }, async (t) => {
        await camps.setSleeperCamp(camp('rill'));
        const hdel = t.mock.method(kv, 'hdel');

        await camps.clearSleeperCampOnBeat('rill', NOW);
        assert.equal((await camps.listSleeperCamps()).has('rill'), false, 'the reconnected player is no longer a camp');
        await camps.clearSleeperCampOnBeat('rill', NOW + 20_000);
        await camps.clearSleeperCampOnBeat('Rill', NOW + 40_000);
        assert.equal(hdel.mock.callCount(), 1, 'repeat beats must not rewrite world:sleeper-camps');
    });

    it('clears again on the next beat after this process pitches a new camp', { concurrency: false }, async () => {
        await camps.clearSleeperCampOnBeat('rill', NOW);
        await camps.setSleeperCamp(camp('rill', 14));
        await camps.clearSleeperCampOnBeat('rill', NOW + 20_000);
        assert.equal((await camps.listSleeperCamps()).has('rill'), false);
    });

    it('rechecks after the window, so a camp written elsewhere cannot outlive it', { concurrency: false }, async () => {
        await camps.clearSleeperCampOnBeat('rill', NOW);
        // Written behind this process's back, e.g. by the old container during a deploy overlap.
        await kv.hset(camps.SLEEPER_CAMPS_KEY, { rill: camp('rill') });
        await camps.clearSleeperCampOnBeat('rill', NOW + camps.BEAT_CLEAR_RECHECK_MS - 1);
        assert.equal((await camps.listSleeperCamps()).has('rill'), true, 'still inside the skip window');
        await camps.clearSleeperCampOnBeat('rill', NOW + camps.BEAT_CLEAR_RECHECK_MS);
        assert.equal((await camps.listSleeperCamps()).has('rill'), false, 'the recheck removes it');
    });

    it('keeps explicit clears unconditional and safe to pass to Array#map', { concurrency: false }, async () => {
        await camps.setSleeperCamp(camp('rill'));
        await camps.setSleeperCamp(camp('kiri'));
        await camps.clearSleeperCampOnBeat('rill', NOW);
        await kv.hset(camps.SLEEPER_CAMPS_KEY, { rill: camp('rill') });
        await Promise.all(['rill', 'kiri'].map(camps.clearSleeperCamp));
        assert.equal((await camps.listSleeperCamps()).size, 0);
    });
});
