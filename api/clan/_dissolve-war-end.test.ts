import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import type { ClanWar } from './war/_storage.js';

type Kv = typeof import('../_storage.js').kv;

let kv: Kv;
let dissolveClanUnderLock: typeof import('./_dissolve.js').dissolveClanUnderLock;
let clanWarKey: typeof import('./war/_storage.js').clanWarKey;
let clanWarCooldownKey: typeof import('./war/_storage.js').clanWarCooldownKey;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ dissolveClanUnderLock } = await import('./_dissolve.js'));
    ({ clanWarKey, clanWarCooldownKey } = await import('./war/_storage.js'));
});

describe('clan dissolution ending its wars', () => {
    it('finalizes a war whose end lands but whose reply is lost', async (t) => {
        // The dissolution used to reject on the lost reply. The founder's retry
        // then skipped the already-ended war, so it never reached finalizedWars
        // (the winner's war-end clan XP) and its rematch cooldown was never set.
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

        const realCompareSet = kv.compareSet.bind(kv);
        let lostReplies = 0;
        const lossy = t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            const landed = await realCompareSet(key, expected, value, options);
            if (key !== warKey || !landed || lostReplies > 0) return landed;
            lostReplies += 1;
            throw new Error('Connection terminated unexpectedly');
        });
        const first = await dissolveClanUnderLock(clanKey, await kv.get(clanKey), 'kaze')
            .then(value => value, (error: Error) => error);
        lossy.mock.restore();
        assert.equal(lostReplies, 1, 'the war end landed and only its reply was lost');
        // A founder whose deletion failed deletes again.
        const result = first instanceof Error
            ? await dissolveClanUnderLock(clanKey, await kv.get(clanKey), 'kaze')
            : first;

        assert.deepEqual(result.finalizedWars.map(entry => entry.id), [war.id],
            'the caller pays war-end clan XP from this list');
        assert.equal((await kv.get<ClanWar>(warKey))?.winnerClan, 'Tide');
        assert.equal(await kv.get(clanWarCooldownKey('Storm', 'Tide')), '1', 'the rematch cooldown is stamped');
        assert.equal(await kv.get(clanKey), null, 'the clan itself is gone');
    });
});
