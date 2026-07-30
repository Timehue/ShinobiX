import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Drives the real jutsu-ryo handler against an in-memory KV so the admin-content
// lookup is exercised end to end. Admin auth bypasses the per-player name check
// and the rate limit; the ownership check under test runs either way.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'jutsu-ryo-admin-content-test';
delete process.env.SESSION_SECRET;

type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Handler = (req: never, res: never) => Promise<unknown>;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let resetAdminJutsuCatalogCache: () => void;

const PLAYER = 'blitztester';
const SAVE_KEY = `save:${PLAYER}`;
// Authored on save:admin1 only — exactly like the live "Overload" jutsu. It is
// deliberately absent from JUTSU_CATALOG and from the player's own record.
const ADMIN_JUTSU_ID = 'starter-universal-blitz';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ __resetAdminJutsuCatalogCache: resetAdminJutsuCatalogCache } = await import('../_admin-jutsu-catalog.js'));
    handler = (await import('./jutsu-ryo.js')).default as unknown as Handler;
});

beforeEach(async () => {
    // The id set is memoized for 60s; drop it so each test sees its own seed.
    resetAdminJutsuCatalogCache();
    await kv.set('save:admin1', {
        character: { name: 'admin1' },
        creatorJutsus: [{ id: ADMIN_JUTSU_ID, name: 'Overload' }],
    });
    await kv.del('save:admin2');
    // A brand-new player: no mastery, no creator content of their own.
    await kv.set(SAVE_KEY, {
        character: { name: PLAYER, level: 1, ryo: 50_000, jutsuMastery: [] },
        _saveVersion: 1,
    });
});

after(async () => {
    resetAdminJutsuCatalogCache();
    await kv.del('save:admin1');
    await kv.del(SAVE_KEY);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function start(jutsuId: string, requestId: string) {
    const { res, out } = fakeRes();
    await handler(fakeReq({ playerName: PLAYER, action: 'start', requestId, jutsuId }), res);
    return out;
}

function masteryLevel(character: unknown, jutsuId: string): number | undefined {
    const rows = (character as { jutsuMastery?: Array<{ jutsuId: string; level: number }> })?.jutsuMastery ?? [];
    return rows.find((row) => row.jutsuId === jutsuId)?.level;
}

describe('jutsu ryo training — admin-authored content', () => {
    it('unlocks a jutsu that exists only on the admin content slot', async () => {
        // Regression: creatorJutsus is a SERVER_LEDGER_TOPLEVEL_FIELD, so the
        // player's own record never carries it. Checking the record alone made
        // every admin-authored jutsu 409 unknown-or-unowned-jutsu.
        const out = await start(ADMIN_JUTSU_ID, 'admin-authored-unlock-1');
        assert.equal(out.statusCode, 200, `expected 200, got ${out.statusCode} ${JSON.stringify(out.body)}`);
        assert.equal(masteryLevel(out.body?.character, ADMIN_JUTSU_ID), 1);
    });

    it('still rejects an id that no catalog, slot, or save knows', async () => {
        const out = await start('totally-made-up-jutsu', 'admin-authored-unlock-2');
        assert.equal(out.statusCode, 409);
        assert.equal(out.body?.error, 'unknown-or-unowned-jutsu');
    });

    it('reads the second admin slot too', async () => {
        resetAdminJutsuCatalogCache();
        await kv.set('save:admin1', { character: { name: 'admin1' }, creatorJutsus: [] });
        await kv.set('save:admin2', {
            character: { name: 'admin2' },
            creatorJutsus: [{ id: 'admin-slot-two-jutsu', name: 'Slot Two' }],
        });
        const out = await start('admin-slot-two-jutsu', 'admin-authored-unlock-3');
        assert.equal(out.statusCode, 200, `expected 200, got ${out.statusCode} ${JSON.stringify(out.body)}`);
        assert.equal(masteryLevel(out.body?.character, 'admin-slot-two-jutsu'), 1);
    });

    it('still unlocks a built-in catalog jutsu with no admin content present', async () => {
        resetAdminJutsuCatalogCache();
        await kv.del('save:admin1');
        await kv.del('save:admin2');
        const out = await start('starter-universal-flicker', 'admin-authored-unlock-4');
        assert.equal(out.statusCode, 200, `expected 200, got ${out.statusCode} ${JSON.stringify(out.body)}`);
        assert.equal(masteryLevel(out.body?.character, 'starter-universal-flicker'), 1);
    });
});
