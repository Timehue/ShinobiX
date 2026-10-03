import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import type { ClanWar } from './_storage.js';

type Kv = typeof import('../../_storage.js').kv;
type ClanWarStorage = typeof import('./_storage.js');

let kv: Kv;
let loadAllClanWars: ClanWarStorage['loadAllClanWars'];
let clanInActiveWar: ClanWarStorage['clanInActiveWar'];
let applyLazyClanWarExpiry: ClanWarStorage['applyLazyClanWarExpiry'];
let clanWarKey: ClanWarStorage['clanWarKey'];
let clanWarCooldownKey: ClanWarStorage['clanWarCooldownKey'];

const MATCH_ID = 'tpvp-0123456789abcdef0123456789abcdef';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ loadAllClanWars, clanInActiveWar, applyLazyClanWarExpiry, clanWarKey, clanWarCooldownKey } = await import('./_storage.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('clan-war:*')) await kv.del(key);
});

function war(): ClanWar {
    return {
        id: clanWarKey('Alpha', 'Beta').slice('clan-war:'.length),
        clans: ['Alpha', 'Beta'],
        villages: { Alpha: 'moonshadow', Beta: 'stormveil' },
        hp: { Alpha: 1000, Beta: 1000 },
        startedAt: Date.now(),
        updatedAt: Date.now(),
        declaredBy: 'ash',
        pendingChallenges: [],
        completedChallenges: [],
    };
}

describe('clan-war scans', () => {
    it('list only war rows, not the 2v2 and cooldown rows under the same prefix', async () => {
        const record = war();
        await kv.set(clanWarKey('Alpha', 'Beta'), record);
        await kv.set(clanWarCooldownKey('Gamma', 'Delta'), Date.now());
        // A 2v2 duel publishes its match index when it starts and its
        // settlement receipt when it settles, both under `clan-war:`.
        await kv.set('clan-war:mpvp:cw-2v2-1', MATCH_ID);
        await kv.set(`clan-war:mpvp-settlement:${MATCH_ID}`, {
            version: 1,
            matchId: MATCH_ID,
            warId: record.id,
            challengeId: 'cw-2v2-1',
            result: 'from-wins',
            outcome: 'applied',
            settledAt: Date.now(),
        });

        const wars = await loadAllClanWars();
        assert.deepEqual(wars.map(entry => entry.id), [record.id]);
        // What the war list projects, and what declare asks before a new war.
        assert.doesNotThrow(() => wars.map(entry => applyLazyClanWarExpiry(entry, Date.now())));
        assert.equal(await clanInActiveWar('Alpha'), true);
        assert.equal(await clanInActiveWar('Gamma'), false, 'a clan that is not at war may declare one');
    });
});
