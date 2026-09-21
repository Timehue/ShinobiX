process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ranked-format-weapon-test-secret-32-bytes';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { RANKED_FORMAT_DEFAULT_WEAPON_ID } from './_ranked-format.js';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const PLAYER = 'rankedweaponowner';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let sanitizeCharacterSave: typeof import('../save/[name].js').sanitizeCharacterSave;
let petMigrationVersion: number;
let ipSeed = 0;

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

async function post(weaponId: unknown, as = PLAYER) {
    const ip = `10.64.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, weaponId },
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-player-name': as,
            'x-player-token': issuePlayerToken(as),
            'x-forwarded-for': ip,
        },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ sanitizeCharacterSave } = await import('../save/[name].js'));
    ({ PET_BREEDING_MIGRATION_VERSION: petMigrationVersion } = await import('../pet/_owned-pet.js'));
    handler = (await import('./ranked-format-weapon.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: { name: PLAYER, level: 40, petBreedingMigrationVersion: petMigrationVersion },
    });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('ranked format weapon preference', { concurrency: false }, () => {
    it('persists the 30% Reflect ranked weapon and returns the authoritative save version', async () => {
        const out = await post('tempest-fang-blade');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.weaponId, 'tempest-fang-blade');
        assert.equal((out.body?.character as Json)?.rankedFormatWeaponId, 'tempest-fang-blade');
        assert.equal(out.body?._saveVersion, 2);
        const stored = await kv.get<Json>(`save:${PLAYER}`);
        assert.equal((stored?.character as Json)?.rankedFormatWeaponId, 'tempest-fang-blade');
    });

    it('rejects invalid and cross-account choices without changing the save', async () => {
        assert.equal((await post('not-a-ranked-weapon')).statusCode, 400);
        assert.equal((await post(RANKED_FORMAT_DEFAULT_WEAPON_ID, 'anotherplayer')).statusCode, 403);
        const stored = await kv.get<Json>(`save:${PLAYER}`);
        assert.equal((stored?.character as Json)?.rankedFormatWeaponId, undefined);
        assert.equal(stored?._saveVersion, 1);
    });

    it('replaying the confirmed choice is a no-op', async () => {
        const first = await post('frostfang-oathblade');
        const replay = await post('frostfang-oathblade');
        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?._saveVersion, first.body?._saveVersion);
    });

    it('keeps the preference server-owned across existing and first-save autosaves', () => {
        const existing = {
            character: {
                name: PLAYER,
                rankedFormatWeaponId: 'elderbranch-katana',
            },
        };
        const forgedExisting = sanitizeCharacterSave({
            character: {
                name: PLAYER,
                rankedFormatWeaponId: 'frostfang-oathblade',
            },
        }, existing);
        assert.equal(
            (forgedExisting.character as Json).rankedFormatWeaponId,
            'elderbranch-katana',
            'an ordinary autosave must preserve the authoritative stored choice',
        );

        const forgedFirstSave = sanitizeCharacterSave({
            character: {
                name: PLAYER,
                rankedFormatWeaponId: 'elderbranch-katana',
            },
        }, null);
        assert.equal(
            (forgedFirstSave.character as Json).rankedFormatWeaponId,
            undefined,
            'a first save must not mint a ranked weapon preference',
        );
    });
});
