import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'elapsed-read-ownership-admin';
process.env.SESSION_SECRET = 'elapsed-read-ownership-player-session-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const PLAYER = 'elapsedreadowner';
const SAVE_KEY = `save:${PLAYER}`;

let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let kv: typeof import('../_storage.js').kv;

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

async function get(headers: Record<string, string>) {
    const { out, res } = response();
    await handler({
        method: 'GET',
        query: { name: PLAYER },
        headers,
        socket: { remoteAddress: '127.0.0.81' },
    } as never, res);
    return out;
}

function save(now: number): Json {
    return {
        _saveVersion: 7,
        _saveAt: now - 60_000,
        worldGeoV: 2,
        currentSector: 40,
        currentBiome: 'central',
        character: {
            name: PLAYER,
            hp: 0,
            maxHp: 100,
            chakra: 0,
            maxChakra: 100,
            stamina: 0,
            maxStamina: 100,
        },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
});

after(async () => {
    await kv.del(SAVE_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
});

test('admin inspection projects elapsed vitals without mutating the player version, while a self-read persists', async () => {
    const seeded = save(Date.now());
    await kv.set(SAVE_KEY, seeded);

    const admin = await get({ 'x-admin-password': process.env.ADMIN_PASSWORD! });
    assert.equal(admin.statusCode, 200);
    assert.ok(Number((admin.body?.character as Json).stamina) > 0, 'admin still receives a full settled projection');

    const afterAdmin = await kv.get<Json>(SAVE_KEY);
    assert.equal(afterAdmin?._saveVersion, 7, 'admin GET must not advance the player save stream');
    assert.equal((afterAdmin?.character as Json).stamina, 0, 'admin GET must not persist projected vitals');
    assert.equal(afterAdmin?._saveAt, seeded._saveAt);

    const token = issuePlayerToken(PLAYER);
    assert.ok(token);
    const owner = await get({ 'x-player-name': PLAYER, 'x-player-token': token });
    assert.equal(owner.statusCode, 200);
    assert.equal(owner.body?._saveVersion, 8);

    const afterOwner = await kv.get<Json>(SAVE_KEY);
    assert.equal(afterOwner?._saveVersion, 8, 'true player self-read publishes the elapsed settlement');
    assert.ok(Number((afterOwner?.character as Json).stamina) > 0);
    assert.equal((afterOwner?.character as Json).stamina, (owner.body?.character as Json).stamina);
    assert.equal(afterOwner?._saveAt, owner.body?._saveAt);
});
