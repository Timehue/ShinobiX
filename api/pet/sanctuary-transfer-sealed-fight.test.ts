import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-sanctuary-sealed-fight-memory-only';
delete process.env.SESSION_SECRET;

/*
 * A pet battle seals each fighter's consumable at kickoff, and battle-result
 * spends it from the carried roster when the fight settles. A companion moved
 * to the Sanctuary mid-fight left the roster with that item still equipped, so
 * the fight used it and nothing was spent. Only the sealed pet waits now.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };

let kv: typeof import('../_storage.js').kv;
let createOwnedPet: typeof import('./_owned-pet.js').createOwnedPet;
let sanctuary: Handler;

const PLAYER = 'sealedtamer';
const TOKEN = 'sealed-fight-token';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ createOwnedPet } = await import('./_owned-pet.js'));
    sanctuary = (await import('./sanctuary-transfer.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

async function toSanctuary(petId: string): Promise<Reply> {
    const output: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { output.status = n; return res; },
        json(payload: Record<string, any>) { output.body = payload; return res; },
        end() { return res; },
    };
    await sanctuary({
        method: 'POST',
        body: { playerName: PLAYER, petId, action: 'to-sanctuary' },
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.93' },
    } as never, res as never);
    return output;
}

function equipped(templateId: string): Record<string, unknown> {
    return { ...createOwnedPet(templateId, { origin: 'wild' }), level: 20, loadout: { consumable: 'pet-tonic' } };
}

async function seed(pets: Array<Record<string, unknown>>): Promise<void> {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, level: 30, ryo: 0, pets } });
}

async function openFight(sealedPets: Array<Record<string, unknown>>, options: { pointerOnly?: boolean } = {}): Promise<void> {
    await kv.set(`pet:battle-active:${PLAYER}`, TOKEN, { ex: 900 });
    if (options.pointerOnly) return;
    await kv.set(`pet:battle-token:${PLAYER}:${TOKEN}`, {
        playerName: PLAYER,
        playerPetIds: sealedPets.map((pet) => pet.id),
        casualPveSeal: { version: 1, playerPets: sealedPets, opponentPets: [], params: {} },
    }, { ex: 900 });
}

async function carriedIds(): Promise<string[]> {
    const saved = await kv.get<Record<string, any>>(`save:${PLAYER}`);
    return (saved?.character.pets ?? []).map((pet: Record<string, unknown>) => String(pet.id));
}

describe('a companion in a sealed pet fight stays carried', { concurrency: false }, () => {
    test('the fighter whose consumable the fight sealed cannot be stored', async () => {
        const fighter = equipped('standard-0');
        await seed([fighter]);
        await openFight([{ id: fighter.id, loadout: { consumable: 'pet-tonic' } }]);

        const stored = await toSanctuary(String(fighter.id));
        assert.equal(stored.status, 409, JSON.stringify(stored.body));
        assert.equal(stored.body.error, 'pet-is-in-active-battle');
        assert.deepEqual(await carriedIds(), [fighter.id], 'the fighter stayed in the roster');
    });

    test('a companion outside the fight still moves', async () => {
        const fighter = equipped('standard-0');
        const bystander = equipped('standard-6');
        await seed([fighter, bystander]);
        await openFight([{ id: fighter.id, loadout: { consumable: 'pet-tonic' } }]);

        const stored = await toSanctuary(String(bystander.id));
        assert.equal(stored.status, 200, JSON.stringify(stored.body));
        assert.deepEqual(await carriedIds(), [fighter.id]);
    });

    test('a fighter that sealed no consumable still moves', async () => {
        const fighter = equipped('standard-0');
        await seed([fighter]);
        await openFight([{ id: fighter.id }]);

        const stored = await toSanctuary(String(fighter.id));
        assert.equal(stored.status, 200, JSON.stringify(stored.body));
        assert.deepEqual(await carriedIds(), []);
    });

    test('a pointer whose battle token is gone blocks nothing', async () => {
        const fighter = equipped('standard-0');
        await seed([fighter]);
        await openFight([], { pointerOnly: true });

        const stored = await toSanctuary(String(fighter.id));
        assert.equal(stored.status, 200, JSON.stringify(stored.body));
        assert.deepEqual(await carriedIds(), []);
    });
});
