import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import type { ClanWar } from './war/_storage.js';

type Kv = typeof import('../_storage.js').kv;

let kv: Kv;
let dissolveClanUnderLock: typeof import('./_dissolve.js').dissolveClanUnderLock;
let clanWarKey: typeof import('./war/_storage.js').clanWarKey;

const MATCH_ID = 'tpvp-0123456789abcdef0123456789abcdef';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ dissolveClanUnderLock } = await import('./_dissolve.js'));
    ({ clanWarKey } = await import('./war/_storage.js'));
});

describe('clan dissolution war scan', () => {
    it('ends the clan\'s war while 2v2 rows share the clan-war prefix', async () => {
        // The scan read every `clan-war:` row as a war, so a 2v2 match index or
        // settlement receipt made `war.clans.some` throw and the deletion failed.
        const clanKey = 'save:clan-storm';
        await kv.set(clanKey, { name: 'Storm', founderName: 'kaze', members: [{ name: 'kaze' }], createdAt: 1 });
        await kv.set('save:kaze', { _saveVersion: 1, character: { name: 'kaze', clan: 'Storm' } });
        const warKey = clanWarKey('Storm', 'Tide');
        const war: ClanWar = {
            id: warKey.slice('clan-war:'.length),
            clans: ['Storm', 'Tide'],
            villages: { Storm: 'moonshadow', Tide: 'stormveil' },
            hp: { Storm: 1000, Tide: 1000 },
            startedAt: 1,
            updatedAt: 1,
            declaredBy: 'kaze',
            pendingChallenges: [],
            completedChallenges: [],
        };
        await kv.set(warKey, war);
        const receipt = {
            version: 1,
            matchId: MATCH_ID,
            warId: 'other-vs-pair',
            challengeId: 'cw-2v2-1',
            result: 'from-wins',
            outcome: 'applied',
            settledAt: 1,
        };
        await kv.set('clan-war:mpvp:cw-2v2-1', MATCH_ID);
        await kv.set(`clan-war:mpvp-settlement:${MATCH_ID}`, receipt);

        const result = await dissolveClanUnderLock(clanKey, await kv.get(clanKey), 'kaze');

        assert.deepEqual(result.finalizedWars.map(entry => entry.id), [war.id]);
        assert.equal((await kv.get<ClanWar>(warKey))?.winnerClan, 'Tide');
        assert.equal(await kv.get(clanKey), null, 'the clan itself is gone');
        assert.equal(await kv.get('clan-war:mpvp:cw-2v2-1'), MATCH_ID, 'the 2v2 rows are left as they were');
        assert.deepEqual(await kv.get(`clan-war:mpvp-settlement:${MATCH_ID}`), receipt);
    });
});
