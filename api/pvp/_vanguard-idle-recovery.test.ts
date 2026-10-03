import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import type { PvpSession } from './session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.ENABLE_VANGUARD_REWARD_V2;

/*
 * A Vanguard win writes two kinds of save: the winner's, with the Honor Seals
 * and profession XP, and each escorting Pet Tamer's, with the next-expedition
 * flag. Neither write moves a vital, and the Pet Tamer is rarely online when a
 * clanmate's win flags them. Both used to fence the regeneration cursor to
 * "now", which threw away the HP, chakra and stamina recovered since that
 * player's last save. Each test starts both 30 s past their last save at
 * HP 10/100, chakra 20/100 and stamina 0/100, on the legacy grant (generic
 * PvP) and on the V2 saga, and checks that the recovery and the carried
 * cursor survive.
 */

type Grant = typeof import('./_vanguard-rewards.js').grantVanguardRewardsForSession;

let kv: typeof import('../_storage.js').kv;
let makeMemoryKv: typeof import('../_storage.js')._makeMemoryKv;
let offerEscort: typeof import('../clan/pet-escort/_storage.js').offerEscort;
let grant: Grant;

const CLAN = 'Leaf';
const TIRED = { hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 };
let tiredAt = 0;

before(async () => {
    ({ kv, _makeMemoryKv: makeMemoryKv } = await import('../_storage.js'));
    ({ offerEscort } = await import('../clan/pet-escort/_storage.js'));
    ({ grantVanguardRewardsForSession: grant } = await import('./_vanguard-rewards.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    tiredAt = Date.now() - 30_000;
});

/** The winner, an escorting Pet Tamer in the same clan, and the loser. */
function saves(): Record<string, Record<string, unknown>> {
    const tired = (character: Record<string, unknown>) => ({
        _saveVersion: 1,
        _saveAt: tiredAt,
        _regenAt: tiredAt,
        character: { ...character, ...TIRED },
    });
    return {
        'save:alice': tired({
            name: 'Alice', profession: 'vanguard', professionRank: 1, professionXp: 0,
            level: 50, honorSeals: 0, clan: CLAN, activePetId: 'alice-pet',
        }),
        'save:tia': tired({ name: 'Tia', profession: 'petTamer', clan: CLAN }),
        'save:bob': { _saveVersion: 1, character: { name: 'Bob', level: 50 } },
    };
}

function battle(id: string, v2: boolean): PvpSession {
    const now = Date.now();
    return {
        battleId: `pvp-vanguard-rest-${id}`,
        status: 'done', winner: 'p1', rewardAuthority: 'challenge',
        ...(v2 ? { vanguardRewardAuthorityVersion: 2 } : {}),
        p1: { name: 'Alice', character: { profession: 'vanguard', professionRank: 1, level: 50, clan: CLAN, activePetId: 'alice-pet' } },
        p2: { name: 'Bob', character: { level: 50 } },
        joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
        baseRewards: true, createdAt: now - 60_000, lastMoveAt: now,
    } as unknown as PvpSession;
}

function assertRecovered(saved: Record<string, any>, who: string): void {
    const character = saved.character;
    assert.ok(character.hp >= 40, `${who}: hp ${character.hp} lost the idle recovery`);
    assert.ok(character.chakra >= 50, `${who}: chakra ${character.chakra} lost the idle recovery`);
    assert.ok(character.stamina >= 30, `${who}: stamina ${character.stamina} lost the idle recovery`);
    // Neither write moves a vital, so each carries the settled cursor.
    assert.ok(Number(saved._regenAt) >= tiredAt + 30_000 - 1_000, `${who}: cursor ${saved._regenAt} fell behind the recovery`);
    assert.equal((Number(saved._regenAt) - tiredAt) % 1_000, 0, `${who}: cursor ${saved._regenAt} was fenced to the write, not carried`);
}

describe('a Vanguard win keeps the idle recovery of the winner and the escort', { concurrency: false }, () => {
    test('on the legacy grant', async () => {
        for (const [key, value] of Object.entries(saves())) await kv.set(key, value);
        await offerEscort(CLAN, 'Tia');

        const result = await grant(battle('legacy', false));
        assert.equal(result.granted, true, JSON.stringify(result));

        const escort = (await kv.get<Record<string, any>>('save:tia'))!;
        assert.equal(escort.character.petEscortBonusReady, true, 'the escort was still flagged');
        assertRecovered(escort, 'Pet Tamer');
        const winner = (await kv.get<Record<string, any>>('save:alice'))!;
        assert.equal(winner.character.honorSeals, result.seals, 'the winner was still paid');
        assert.equal(winner.character.professionXp, result.xp);
        assertRecovered(winner, 'winner');
    });

    test('on the V2 saga', async () => {
        const store = makeMemoryKv();
        for (const [key, value] of Object.entries(saves())) await store.set(key, value);

        const result = await grant(battle('v2', true), {
            store,
            lock: async (_key, action) => action(),
            now: Date.now(),
            overlap: async () => false,
            activeEscorters: async () => ['Tia'],
        });
        assert.equal(result.granted, true, JSON.stringify(result));

        const escort = (await store.get<Record<string, any>>('save:tia'))!;
        assert.equal(escort.character.petEscortBonusReady, true, 'the escort was still flagged');
        assertRecovered(escort, 'Pet Tamer');
        const winner = (await store.get<Record<string, any>>('save:alice'))!;
        assert.equal(winner.character.honorSeals, result.seals, 'the winner was still paid');
        assert.equal(winner.character.professionXp, result.xp);
        assertRecovered(winner, 'winner');
    });
});
