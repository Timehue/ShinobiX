import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';

/*
 * 2026-10-15 audit M3 + M4, driven through the real handlers on the isolated
 * in-memory store.
 *
 * M3: an admin write left a claimable slot unclaimed, and an unclaimed slot was
 * claimed by its first player writer. So admin catalog pet art
 * (`petbody:starter-fire`) and any art from before claims existed could be
 * claimed and replaced by any player.
 *
 * M4: a player could store an http(s) link (which /api/img redirects to) and
 * write `misc:` ids, which had no owner at all.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'images-claim-takeover-session-secret';
process.env.ADMIN_PASSWORD = 'images-claim-takeover-admin';
delete process.env.IMAGE_LEGACY_HASH_WRITE;
delete process.env.R2_PUBLIC_BASE;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown; headers: Record<string, string> };

let kv: typeof import('./_storage.js').kv;
let images: typeof import('./images.js');
let imagesHandler: Handler;
let imgHandler: Handler;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let withinPlayerSaveCommit: typeof import('./_save-write-guard.js').withinPlayerSaveCommit;
let clearProcCache: () => void;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    images = (await import('./images.js')) as unknown as typeof images;
    imagesHandler = images.default as unknown as Handler;
    imgHandler = (await import('./img.js')).default as unknown as Handler;
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ withinPlayerSaveCommit } = await import('./_save-write-guard.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
});

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

const png = (tag: string) => `data:image/png;base64,${Buffer.from(`image-${tag}`).toString('base64')}`;
const ADMIN = { 'x-admin-password': 'images-claim-takeover-admin' };
let ipCounter = 0;

async function call(handler: Handler, method: string, query: Record<string, string>, headers: Record<string, string>, body?: unknown): Promise<Out> {
    const out: Out = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (payload: unknown) => { out.body = payload; return res; },
        send: (payload: unknown) => { out.body = payload; return res; },
        end: () => res,
        redirect: (code: number, url: string) => { out.statusCode = code; out.headers.location = url; return res; },
    };
    // A fresh address per request keeps the per-IP upload backstop out of the way.
    const ip = `10.71.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
    await handler({ method, query, headers, body, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

async function player(name: string, save?: Record<string, unknown>): Promise<Record<string, string>> {
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    if (save) await withinPlayerSaveCommit(() => kv.set(`save:${name}`, save));
    return { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! };
}

const upload = (headers: Record<string, string>, id: string, image: string) => call(imagesHandler, 'POST', {}, headers, { id, image });
const remove = (headers: Record<string, string>, id: string) => call(imagesHandler, 'DELETE', { id }, headers);

describe('M3: admin catalog art under claimable prefixes', () => {
    it('an admin write reserves the slot, so no player can claim or replace it', async () => {
        assert.equal((await upload(ADMIN, 'petbody:starter-fire', png('catalog'))).statusCode, 200);
        assert.equal(await kv.get('img-owner:petbody:starter-fire'), images.ADMIN_IMAGE_OWNER);

        const thief = await player('thief');
        assert.equal((await upload(thief, 'petbody:starter-fire', png('stolen'))).statusCode, 403);
        assert.equal((await remove(thief, 'petbody:starter-fire')).statusCode, 403);
        assert.equal(await kv.get('shared:img:petbody:starter-fire'), png('catalog'));
        assert.equal(await kv.get('img-owner:petbody:starter-fire'), images.ADMIN_IMAGE_OWNER);
    });

    it('legacy unclaimed pet art (already stored) cannot be claimed by a player', async () => {
        for (const id of ['pet:starter-fox', 'pet:starter-fox:variant:shadow', 'petsheet:starter-fox', 'petlayers:starter-fox:back']) {
            await kv.set(`shared:img:${id}`, png('legacy'));
            const thief = await player('thief');
            assert.equal((await upload(thief, id, png('stolen'))).statusCode, 403, id);
            assert.equal(await kv.get(`img-owner:${id}`), null, `${id}: a refused write claims nothing`);
            assert.equal(await kv.get(`shared:img:${id}`), png('legacy'), id);
        }
    });

    it('legacy art held only by the frozen legacy rows counts as existing too', async () => {
        await kv.hset('shared:imgfields:pet', { 'pet:old-hash-only': png('legacy') });
        const thief = await player('thief');
        assert.equal((await upload(thief, 'pet:old-hash-only', png('stolen'))).statusCode, 403);
    });

    it('an admin editing a player-claimed slot keeps the player\'s claim', async () => {
        const id = `pet:${randomUUID()}`;
        const owner = await player('owner');
        assert.equal((await upload(owner, id, png('mine'))).statusCode, 200);
        assert.equal((await upload(ADMIN, id, png('admin-fix'))).statusCode, 200);
        assert.equal(await kv.get(`img-owner:${id}`), 'owner');
        assert.equal((await upload(owner, id, png('mine-again'))).statusCode, 200);
    });

    it('a brand-new id is still claimed by its first writer, and only that writer may replace it', async () => {
        const id = `item:named-weapon-${randomUUID()}`;
        const forger = await player('forger');
        const other = await player('other');
        assert.equal((await upload(forger, id, png('forged'))).statusCode, 200, 'the optimistic first publish is never blocked');
        assert.equal(await kv.get(`img-owner:${id}`), 'forger');
        assert.equal((await upload(other, id, png('stolen'))).statusCode, 403);
        assert.equal((await upload(forger, id, png('reforged'))).statusCode, 200);
    });
});

describe('M3: pre-claim player art is reclaimed only with proof from the save', () => {
    const bloodlineId = randomUUID();
    const jutsuId = randomUUID();
    const itemId = `named-armor-${randomUUID()}`;
    const ownerSave = {
        character: { name: 'creator' },
        savedBloodlines: [{ id: bloodlineId, name: 'Ember Veil', jutsus: [{ id: jutsuId, name: 'Veil Strike' }] }],
        creatorItems: [{ id: itemId, name: 'Ash Plate' }],
    };

    for (const id of [`bloodline:${bloodlineId}`, `jutsu:${jutsuId}`, `item:${itemId}`]) {
        it(`${id.split(':')[0]}: the creator whose save holds it reclaims it; anyone else is refused`, async () => {
            await kv.set(`shared:img:${id}`, png('pre-claim'));
            const stranger = await player('stranger', { character: { name: 'stranger' }, savedBloodlines: [], creatorItems: [] });
            assert.equal((await upload(stranger, id, png('stolen'))).statusCode, 403);
            assert.equal((await remove(stranger, id)).statusCode, 403, 'nor delete it');
            assert.equal(await kv.get(`img-owner:${id}`), null);

            const creator = await player('creator', ownerSave);
            assert.equal((await upload(creator, id, png('edited'))).statusCode, 200);
            assert.equal(await kv.get(`img-owner:${id}`), 'creator', 'the proven creator now holds the claim');
            assert.equal((await upload(stranger, id, png('stolen'))).statusCode, 403);
        });
    }

    it('an admin approving a player\'s bloodline does not lock the creator out of their own art', async () => {
        // The bloodline approval re-publishes the PLAYER's bloodline/jutsu ids.
        // Only pet catalog ids are reserved for admin; these stay provable.
        const id = `bloodline:${bloodlineId}`;
        await kv.set(`shared:img:${id}`, png('pre-claim'));
        assert.equal((await upload(ADMIN, id, png('approved'))).statusCode, 200);
        assert.equal(await kv.get(`img-owner:${id}`), null, 'no admin reservation on a player id');
        const creator = await player('creator', ownerSave);
        assert.equal((await upload(creator, id, png('edited-after-approval'))).statusCode, 200);
    });

    it('saveProvesImageOwnership never proves pet art', async () => {
        await player('creator', { ...ownerSave, pets: [{ id: 'starter-fox' }] });
        assert.equal(await images.saveProvesImageOwnership('pet:starter-fox', 'creator'), false);
        assert.equal(await images.saveProvesImageOwnership(`bloodline:${bloodlineId}`, 'creator'), true);
        assert.equal(await images.saveProvesImageOwnership(`bloodline:${bloodlineId}`, 'nobody'), false);
    });
});

describe('M4: players upload image files only, never links or misc ids', () => {
    it('refuses an http(s) link from a player in every category', async () => {
        const headers = await player('linker');
        for (const id of ['avatar:linker', `pet:${randomUUID()}`, `item:named-weapon-${randomUUID()}`, `bloodline:${randomUUID()}`]) {
            const out = await upload(headers, id, 'https://cdn.example.com/a.png');
            assert.equal(out.statusCode, 400, id);
            assert.equal(await kv.get(`shared:img:${id}`), null, id);
            assert.equal(await kv.get(`img-owner:${id}`), null, `${id}: a refused link claims nothing`);
        }
    });

    it('still lets an admin store a link', async () => {
        assert.equal((await upload(ADMIN, 'card:linked', 'https://cdn.example.com/a.png')).statusCode, 200);
    });

    it('refuses misc ids (any unknown prefix, or a known one in the wrong case) to players', async () => {
        const headers = await player('misc-writer');
        for (const id of ['misc:x', 'profession:backdrop', `JUTSU:${randomUUID()}`, `Pet:${randomUUID()}`]) {
            assert.equal((await upload(headers, id, png('x'))).statusCode, 403, id);
            assert.equal(await kv.get(`shared:img:${id}`), null, id);
        }
        assert.equal((await upload(ADMIN, 'profession:backdrop', png('admin'))).statusCode, 200, 'admin profession art still publishes');
    });
});

describe('M4: /api/img is not an open redirect', () => {
    it('refuses to redirect a player-writable id to a foreign host (404, no-store)', async () => {
        for (const id of ['pet:legacy-link', 'avatar:someone', 'misc:legacy', `item:named-weapon-${randomUUID()}`, 'CARD:wrong-case']) {
            await kv.set(`shared:img:${id}`, 'https://evil.example/collect?u=1');
            const out = await call(imgHandler, 'GET', { id }, {});
            assert.equal(out.statusCode, 404, id);
            assert.equal(out.headers['cache-control'], 'no-store', id);
            assert.equal(out.headers.location, undefined, id);
        }
    });

    it('follows a link to our own hosts, and admin-authored catalog links as before', async () => {
        await kv.set('shared:img:pet:own-host', 'https://www.shinobijourney.com/pets/fox.png');
        const own = await call(imgHandler, 'GET', { id: 'pet:own-host' }, {});
        assert.equal(own.statusCode, 302);
        assert.equal(own.headers.location, 'https://www.shinobijourney.com/pets/fox.png');

        await kv.set('shared:img:card:catalog', 'https://cdn.example.com/card.png');
        const catalog = await call(imgHandler, 'GET', { id: 'card:catalog' }, {});
        assert.equal(catalog.statusCode, 302);
        assert.equal(catalog.headers.location, 'https://cdn.example.com/card.png');
    });

    it('isSafeImageRedirect: the R2 public host is allowed; credentials, http and lookalikes are not', async () => {
        const { isSafeImageRedirect } = await import('./img.js');
        process.env.R2_PUBLIC_BASE = 'https://img.shinobi-cdn.example/';
        try {
            assert.equal(isSafeImageRedirect('pet:x', 'https://img.shinobi-cdn.example/pet/x.png'), true);
            assert.equal(isSafeImageRedirect('pet:x', 'http://img.shinobi-cdn.example/pet/x.png'), false, 'https only');
            assert.equal(isSafeImageRedirect('pet:x', 'https://img.shinobi-cdn.example.evil.example/x.png'), false);
            assert.equal(isSafeImageRedirect('pet:x', 'https://shinobijourney.com@evil.example/x.png'), false);
            assert.equal(isSafeImageRedirect('pet:x', 'https://user:pw@shinobijourney.com/x.png'), false);
            assert.equal(isSafeImageRedirect('pet:x', 'https://evil.example/x.png'), false);
            assert.equal(isSafeImageRedirect('jutsu:fireball', 'https://cdn.example.com/x.png'), true, 'admin-only prefix');
            assert.equal(isSafeImageRedirect(`jutsu:${randomUUID()}`, 'https://cdn.example.com/x.png'), false, 'player bloodline jutsu');
        } finally {
            delete process.env.R2_PUBLIC_BASE;
        }
    });
});
