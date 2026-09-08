process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'owner-read-walked-tile-player-session-secret';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F03 — the owner's restore pull resumes on the tile the player last stood
 * on. `currentTile` on the save is the ARRIVAL tile the travel settle wrote;
 * the walked tile (walked-tile.ts) is projected over it on the owner's read
 * when it is for the same sector, and never persisted back.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let walkedTileKey: typeof import('../_realtime/walked-tile.js').walkedTileKey;
let handler: Handler;

const PLAYER = 'walkedtilereader';
const OTHER = 'walkedtileviewer';

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

async function get(as: string, query: Json = {}) {
    const { out, res } = response();
    await handler({
        method: 'GET',
        query: { name: PLAYER, ...query },
        headers: { 'x-player-name': as, 'x-player-token': issuePlayerToken(as)! },
        socket: { remoteAddress: '127.0.0.82' },
    } as never, res);
    return out;
}

function save(): Json {
    return {
        _saveVersion: 7,
        _saveAt: Date.now(),
        _regenAt: Date.now(),
        worldGeoV: 2,
        currentSector: 12,
        currentTile: 5,
        currentBiome: 'central',
        character: { name: PLAYER, level: 20, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100 },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ walkedTileKey } = await import('../_realtime/walked-tile.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(`save:${PLAYER}`, save());
    await kv.set(`save:${OTHER}`, { ...save(), currentSector: 3, character: { ...(save().character as Json), name: OTHER } });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('save GET — the owner resumes on the tile they last stood on (F03)', { concurrency: false }, () => {
    it('projects the walked tile over the arrival tile for the same sector, without writing the save', async () => {
        await kv.set(walkedTileKey(PLAYER), { sector: 12, tile: 77, at: Date.now() });
        const out = await get(PLAYER);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.currentTile, 77, 'the spot the player last stood on');
        assert.equal(out.body?.currentSector, 12);
        assert.equal((await kv.get<Json>(`save:${PLAYER}`))?.currentTile, 5, 'the stored arrival tile is untouched');
    });

    it('ignores a walk recorded in another sector, and answers the arrival tile when nothing was walked', async () => {
        await kv.set(walkedTileKey(PLAYER), { sector: 13, tile: 77, at: Date.now() });
        assert.equal((await get(PLAYER)).body?.currentTile, 5, 'a walk elsewhere never wins');
        await kv.del(walkedTileKey(PLAYER));
        assert.equal((await get(PLAYER)).body?.currentTile, 5);
    });

    it('a foreign reader gets no tile at all, walked or not', async () => {
        await kv.set(walkedTileKey(PLAYER), { sector: 12, tile: 77, at: Date.now() });
        const out = await get(OTHER);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal('currentTile' in (out.body ?? {}), false, 'position is not part of the public DTO');
    });
});
