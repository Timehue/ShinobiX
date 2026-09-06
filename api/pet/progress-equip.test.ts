process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-equip-test-admin';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * N01 — re-equipping the PvE item already in the slot used to write
 * `pveDurability = 20` again: a worn item at 1 durability became a fresh one
 * for free, with no inventory debit (the `itemId !== current` guard skipped the
 * removal). These drive the mounted handler with its real decision logic over
 * the in-memory KV.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'petequipowner';
const SAVE_KEY = `save:${PLAYER}`;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(body: Json) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.91' },
        socket: { remoteAddress: '127.0.0.91' },
    } as never, res);
    return out;
}

function pet(loadout: Json): Json {
    return { id: 'pet-1', name: 'Fang', level: 5, maxLevel: 50, element: 'Fire', loadout };
}

async function seed(loadout: Json, inventory: string[]) {
    await kv.set(SAVE_KEY, {
        _saveVersion: 3,
        _saveAt: Date.now(),
        character: {
            name: PLAYER,
            level: 10,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            inventory,
            itemStacks: [],
            pets: [pet(loadout)],
            activePetId: 'pet-1',
        },
    });
}

async function storedPet(): Promise<Json> {
    const record = await kv.get<Json>(SAVE_KEY);
    return ((record?.character as Json).pets as Json[])[0];
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./_owned-pet.js'));
    handler = (await import('./progress.js')).default as unknown as Handler;
});

after(async () => {
    await kv.del(SAVE_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('pet equip — same-item re-equip is a true no-op', { concurrency: false }, () => {
    it('leaves worn PvE gear at its remaining durability and touches nothing else', async () => {
        await seed({ pve: 'pet-armor', pveDurability: 1 }, []);
        const before = await kv.get<Json>(SAVE_KEY);

        const out = await post({ action: 'equip', petId: 'pet-1', slot: 'pve', itemId: 'pet-armor' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const stored = await storedPet();
        assert.equal((stored.loadout as Json).pve, 'pet-armor');
        assert.equal((stored.loadout as Json).pveDurability, 1, 'durability must not be refreshed to 20');
        const record = await kv.get<Json>(SAVE_KEY);
        assert.deepEqual((record?.character as Json).inventory, [], 'no inventory movement');
        assert.equal(record?._saveVersion, before?._saveVersion, 'a no-op publishes no new save version');
        assert.equal(out.body?._saveVersion, before?._saveVersion, 'the response echoes the unchanged version');

        // A retry of the same no-op is still a no-op.
        const again = await post({ action: 'equip', petId: 'pet-1', slot: 'pve', itemId: 'pet-armor' });
        assert.equal(again.statusCode, 200);
        assert.equal(((await storedPet()).loadout as Json).pveDurability, 1);
    });

    it('a genuine replacement debits one item and grants full durability exactly once', async () => {
        await seed({ pve: 'pet-armor', pveDurability: 1 }, ['pet-plate']);

        const out = await post({ action: 'equip', petId: 'pet-1', slot: 'pve', itemId: 'pet-plate' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        let stored = await storedPet();
        assert.equal((stored.loadout as Json).pve, 'pet-plate');
        assert.equal((stored.loadout as Json).pveDurability, 20, 'a real replacement starts at the existing full durability');
        assert.deepEqual(((await kv.get<Json>(SAVE_KEY))?.character as Json).inventory, [], 'the replacement was consumed');

        // Wear it, then retry the SAME equip request (a lost-ACK retry): the
        // slot already holds the item, so nothing may be repaired or debited.
        const worn = await kv.get<Json>(SAVE_KEY);
        const wornPets = ((worn?.character as Json).pets as Json[]).map((p) => ({ ...p, loadout: { ...(p.loadout as Json), pveDurability: 3 } }));
        await kv.set(SAVE_KEY, { ...worn, character: { ...(worn?.character as Json), pets: wornPets } });

        const retry = await post({ action: 'equip', petId: 'pet-1', slot: 'pve', itemId: 'pet-plate' });
        assert.equal(retry.statusCode, 200);
        stored = await storedPet();
        assert.equal((stored.loadout as Json).pveDurability, 3, 'a retried replacement cannot repair the gear');
    });

    it('still refuses a replacement the player does not own', async () => {
        await seed({ pve: 'pet-armor', pveDurability: 1 }, []);
        const out = await post({ action: 'equip', petId: 'pet-1', slot: 'pve', itemId: 'pet-plate' });
        assert.equal(out.statusCode, 409);
        assert.equal(((await storedPet()).loadout as Json).pveDurability, 1);
    });
});
