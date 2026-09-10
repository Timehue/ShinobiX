/*
 * `_storage` chooses its backend ONCE, at module-evaluation time:
 *   const _qaMemoryKv = process.env.SHINOBIX_QA_MEMORY_KV === '1'
 *
 * ES module imports are hoisted, so a STATIC import of any app module evaluates
 * that line before a single statement in this file runs — whatever order the
 * lines are written in. This file used to import `_war-mercenary-hire`
 * statically, which reaches `_storage` transitively, so the flag below was
 * always set too late: the suite fell through to the real Supabase client and
 * died in its `before` hook with
 *   "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
 * on any machine without production credentials — i.e. every developer machine
 * and any CI job not handed a service key. It is a unit test over pure helpers;
 * it should never have needed either.
 *
 * So: env first, then NO static value imports of app modules — everything that
 * can reach storage is pulled in from the `before` hook, which runs after this.
 * Type-only imports stay static because they are erased at compile time and
 * evaluate nothing. Same shape as every other storage-touching test in the tree
 * (api/bank/transfer.test.ts, api/pve/fight-outcome.test.ts, ...).
 */
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { KvLike } from './_storage.js';
import type { PvpSession } from './pvp/session.js';
import type { WarMercenaryHireIdentity } from './_war-mercenary-hire.js';

type MercenaryHireModule = typeof import('./_war-mercenary-hire.js');
let WAR_MERCENARY_FUNDING_FIELD: MercenaryHireModule['WAR_MERCENARY_FUNDING_FIELD'];
let helpWarMercenaryHire: MercenaryHireModule['helpWarMercenaryHire'];
let settleWarMercenaryHire: MercenaryHireModule['settleWarMercenaryHire'];
let warMercenaryHireFingerprint: MercenaryHireModule['warMercenaryHireFingerprint'];

const NOW = Date.now();
const WAR_KEY = 'world:war:leaf-vs-mist';
const SOURCE_KEY = 'save:hirer';
const BATTLE_ID = 'pvp-mercenary-freeze-race';

let kv: typeof import('./_storage.js').kv;
let settlePvp: typeof import('./world-state.js').settlePvpVillageWarContinuation;
let activeEnemies: typeof import('./world-state.js').activeVillageWarEnemiesOf;
let mutableEnemies: typeof import('./world-state.js').mutableVillageWarEnemiesOf;
let listMutableWars: typeof import('./world-state.js').listActiveVillageWars;

function war(): Record<string, unknown> {
    return {
        id: 'leaf-vs-mist',
        villages: ['Leaf', 'Mist'],
        hp: { Leaf: 5_000, Mist: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: NOW - 10_000,
        updatedAt: NOW - 10_000,
        lastDecayDate: new Date(NOW).toISOString().slice(0, 10),
    };
}

function battle(): PvpSession {
    return {
        battleId: BATTLE_ID,
        p1: { name: 'Winner', character: { village: 'Leaf' } },
        p2: { name: 'Loser', character: { village: 'Mist' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        baseRewards: true,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        round: 2,
        activePlayer: 'p1',
        ap: { p1: 1, p2: 1 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        createdAt: NOW - 5_000,
        endedAt: NOW - 1_000,
    } as unknown as PvpSession;
}

before(async () => {
    ({
        WAR_MERCENARY_FUNDING_FIELD,
        helpWarMercenaryHire,
        settleWarMercenaryHire,
        warMercenaryHireFingerprint,
    } = await import('./_war-mercenary-hire.js'));
    ({ kv } = await import('./_storage.js'));
    ({
        settlePvpVillageWarContinuation: settlePvp,
        activeVillageWarEnemiesOf: activeEnemies,
        mutableVillageWarEnemiesOf: mutableEnemies,
        listActiveVillageWars: listMutableWars,
    } = await import('./world-state.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

describe('PvP continuation waits for a target-first mercenary strike', { concurrency: false }, () => {
    it('does not consume a durable no-op while hidden, then applies after mercenary help-forward', async () => {
        const target = war();
        await kv.set(WAR_KEY, target);
        await kv.set(SOURCE_KEY, {
            _saveVersion: 1,
            character: { name: 'Hirer', village: 'Leaf', honorSeals: 800 },
        });
        const immutable: WarMercenaryHireIdentity = {
            hireId: 'merc:leaf-vs-mist:hirer:elite',
            warId: 'leaf-vs-mist',
            warToken: 'leaf-vs-mist',
            generation: 1,
            warEndsAt: NOW - 10_000 + 14 * 24 * 60 * 60 * 1_000,
            player: 'hirer',
            displayName: 'Hirer',
            village: 'Leaf',
            enemy: 'Mist',
            tierId: 'elite',
            costSeals: 500,
            warDamage: 300,
            sourceKey: SOURCE_KEY,
        };
        let paused = false;
        const pauseAfterTarget: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
            get: kv.get.bind(kv),
            set: kv.set.bind(kv),
            compareSet: async (key, expected, value, options) => {
                if (key === SOURCE_KEY && !paused) {
                    paused = true;
                    throw new Error('pause-after-mercenary-target');
                }
                return kv.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(settleWarMercenaryHire(pauseAfterTarget, {
            ...immutable,
            warKey: WAR_KEY,
            fingerprint: warMercenaryHireFingerprint(immutable),
            ownerId: 'merc-owner',
            now: NOW,
            expectedWar: target,
        }), /pause-after-mercenary-target/);
        const hidden = await kv.get<Record<string, unknown>>(WAR_KEY);
        assert.ok(hidden?.[WAR_MERCENARY_FUNDING_FIELD]);
        assert.deepEqual(await activeEnemies('Leaf'), ['Mist'], 'daily and hostility authority stay active');
        assert.deepEqual(await mutableEnemies('Leaf'), [], 'manual roaming engage cannot consume a band');
        assert.deepEqual(await listMutableWars(), [], 'autonomous deployment cannot consume a band');

        const session = battle();
        await kv.set(`pvp:${BATTLE_ID}`, session);
        const blocked = await settlePvp(BATTLE_ID, 'winner');
        assert.equal(blocked.status, 503);
        assert.match(String(blocked.body.error), /mercenary strike is settling/i);
        assert.equal(await kv.get(`pvp:war-continuation:winner:${BATTLE_ID}`), null);
        assert.equal((hidden?.hp as Record<string, unknown>).Mist, 5_000);
        assert.equal(hidden?.pvpBattleReceipts, undefined);

        const mercenary = await helpWarMercenaryHire(kv, WAR_KEY, hidden!, NOW + 1);
        assert.equal(mercenary.status, 'active');
        if (mercenary.status !== 'active') return;
        assert.equal((mercenary.row.hp as Record<string, unknown>).Mist, 4_700);
        assert.equal((mercenary.sourceRow.character as Record<string, unknown>).honorSeals, 300);

        const applied = await settlePvp(BATTLE_ID, 'winner');
        assert.equal(applied.status, 200);
        assert.equal(applied.body.settlement, 'applied');
        const finalWar = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(finalWar?.hp?.Mist, 4_695);
        assert.ok(await kv.get(`pvp:war-continuation:winner:${BATTLE_ID}`));
    });
});
