process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'inventory-sell-pet-unlock-secret-32-bytes';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /api/inventory/sell, driven through the mounted handler (2026-10 item-use
 * pass). A collar or PvP pet gear copy is an unlock every pet shares and stays
 * in the backpack while worn, so it used to sell while every pet kept wearing
 * it. The last worn copy is now refused; a spare copy still sells.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let PET_UNLOCK_WORN_ERROR: string;
let handler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'petunlockseller';
const GEAR = 'pvp-aegis-pendant';
let seq = 0;

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

async function sell(requestId = `pet-unlock-sale-${String(++seq).padStart(6, '0')}`) {
    const ip = `10.61.0.${++seq}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, itemId: GEAR, source: 'backpack', quantity: 1, requestId },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER), 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function seed(inventory: string[], worn: boolean) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, level: 70, ryo: 0, inventory, itemStacks: [], equipment: {},
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            pets: [{ id: 'pet-1', name: 'Fang', level: 60, maxLevel: 100, loadout: worn ? { pvp: GEAR } : {} }],
        },
    });
}

const stored = async () => ((await kv.get<Json>(`save:${PLAYER}`))?.character ?? {}) as Json;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_UNLOCK_WORN_ERROR } = await import('../pet/_pet-unlocks.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./sell.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('selling a worn pet unlock', { concurrency: false }, () => {
    it('refuses the last copy while a pet wears it, and changes nothing', async () => {
        await seed([GEAR], true);
        const out = await sell();
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.error, PET_UNLOCK_WORN_ERROR);
        const character = await stored();
        assert.deepEqual(character.inventory, [GEAR]);
        assert.equal(character.ryo, 0);
    });

    it('sells a spare copy, and the last copy once no pet wears it', async () => {
        await seed([GEAR, GEAR], true);
        const spare = await sell();
        assert.equal(spare.statusCode, 200, JSON.stringify(spare.body));
        assert.deepEqual((await stored()).inventory, [GEAR]);

        await seed([GEAR], false);
        const unworn = await sell();
        assert.equal(unworn.statusCode, 200, JSON.stringify(unworn.body));
        assert.deepEqual((await stored()).inventory, []);
        assert.ok(Number((await stored()).ryo) > 0);
    });
});
