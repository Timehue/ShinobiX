import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/*
 * The companion of _settled-mutation-writers.test.ts for routes that refuse an
 * admin caller and so are driven with a player session token. Each one used to
 * write the save raw, which discarded the HP, chakra and stamina a player had
 * recovered since their last save; each now settles that recovery into its
 * write. The fixture save has earned 30 seconds of it.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'settled-player-writers-session-secret-32b';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

const PREFIX = 'settledplayerqa';
const IDLE_MS = 30_000;
const EARNED = 30;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function seedTired(name: string, extra: Json = {}): Promise<void> {
    const at = Date.now() - IDLE_MS;
    await kv.set(`save:${name}`, {
        _saveVersion: 3,
        _saveAt: at,
        _regenAt: at,
        character: {
            name,
            level: 40,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            pets: [],
            inventory: [],
            hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
            ryo: 10_000,
            ...extra,
        },
    });
}

async function post(path: string, name: string, body: Json): Promise<Out> {
    const handler = (await import(path)).default as Handler;
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '' },
        socket: { remoteAddress: '127.0.0.95' },
    } as never, res as never);
    return out;
}

async function stored(name: string): Promise<Json> {
    return (await kv.get<Json>(`save:${name}`))!.character as Json;
}

describe('player-token writers keep the idle recovery a player earned', { concurrency: false }, () => {
    it('Pet Gauntlet entry', async () => {
        const name = `${PREFIX}gauntlet`;
        await seedTired(name);
        const out = await post('../pet/gauntlet.js', name, { action: 'start' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const character = await stored(name);
        assert.ok(Number(character.hp) >= 10 + EARNED, `hp ${character.hp} lost the idle recovery`);
        assert.ok(Number(character.chakra) >= 20 + EARNED, `chakra ${character.chakra} lost the idle recovery`);
        assert.ok(Number(character.stamina) >= EARNED, `stamina ${character.stamina} lost the idle recovery`);
    });

    it('Healer self top-up keeps the chakra and stamina it does not refill', async () => {
        const name = `${PREFIX}topup`;
        await seedTired(name, { profession: 'healer', professionXp: 0, professionRank: 1 });
        const out = await post('../player/heal.js', name, { targetName: name, topUp: true });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const character = await stored(name);
        assert.equal(character.hp, 100, 'the top-up mends HP');
        assert.ok(Number(character.chakra) >= 20 + EARNED, `chakra ${character.chakra} lost the idle recovery`);
        assert.ok(Number(character.stamina) >= EARNED, `stamina ${character.stamina} lost the idle recovery`);
    });
});
