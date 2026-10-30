import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// GET /api/clan-boss/party reads only the viewer's slug and clan, so it loads
// `character.clan` through a projection (loadPartyViewerContext) instead of the
// whole save. These pin that the projection accepts and refuses exactly the
// saves the full loader does, and that the GET never reads the full save.

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let party: typeof import('./_party.js');
let projectKvValue: typeof import('../_storage-projection.js').projectKvValue;
let handler: Handler;
let token: string;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'clan-boss-party-viewer-test-secret-with-entropy';
    delete process.env.DISABLE_CLAN_BOSS_PARTIES;
    ({ kv } = await import('../_storage.js'));
    party = await import('./_party.js');
    ({ projectKvValue } = await import('../_storage-projection.js'));
    token = (await import('../_auth.js')).issuePlayerToken('viewerok')!;
    handler = (await import('./party.js')).default as unknown as Handler;
});

const CASES: Array<[string, unknown]> = [
    ['viewerok', { _saveVersion: 4, character: { name: 'Viewer Ok', clan: '  The Testers ' } }],
    ['blankclan', { character: { name: 'Blank', clan: '   ' } }],
    ['nullclan', { character: { name: 'Null', clan: null } }],
    ['numclan', { character: { name: 'Num', clan: 7 } }],
    ['noclan', { character: { name: 'None' } }],
    ['nochar', { _saveVersion: 1 }],
    ['strchar', { character: 'oops' }],
    ['strsave', 'not-an-object'],
];

test('loadPartyViewerContext matches loadPartyPlayerContext on every save shape', async () => {
    for (const [slug, value] of CASES) await kv.set(`save:${slug}`, value);
    const projectedStore = {
        mget: kv.mget.bind(kv),
        // The Postgres path: project in the store, as pgKv.mgetProjected does.
        mgetProjected: async (keys: string[], projection: Parameters<typeof projectKvValue>[1]) =>
            (await kv.mget(...keys)).map((value) => projectKvValue(value, projection)),
    };
    for (const slug of [...CASES.map(([s]) => s), 'missing-save', '']) {
        const full = await party.loadPartyPlayerContext(slug);
        const expected = full ? { slug: full.slug, clanName: full.clanName } : null;
        assert.deepEqual(await party.loadPartyViewerContext(slug), expected, `fallback store: ${slug}`);
        assert.deepEqual(await party.loadPartyViewerContext(slug, projectedStore), expected, `projected store: ${slug}`);
    }
    assert.deepEqual(await party.loadPartyViewerContext('viewerok'), { slug: 'viewerok', clanName: 'The Testers' });
});

function mockRes() {
    const res = {
        statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string>,
        setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res; },
        status(code: number) { res.statusCode = code; return res; },
        json(body: unknown) { res.body = body; return res; },
        end() { return res; },
    };
    return res;
}

test('the party GET answers from the projection without reading the full save', async () => {
    await kv.set('save:viewerok', { character: { name: 'Viewer Ok', clan: 'The Testers' } });
    const originalGet = kv.get.bind(kv);
    const fullSaveReads: string[] = [];
    kv.get = (async (key: string) => {
        if (key.startsWith('save:')) fullSaveReads.push(key);
        return originalGet(key);
    }) as typeof kv.get;
    try {
        const res = mockRes();
        await handler({
            method: 'GET', query: { playerName: 'viewerok' }, body: undefined,
            headers: { 'x-player-name': 'viewerok', 'x-player-token': token, 'x-forwarded-for': '10.93.0.1' }, socket: { remoteAddress: '127.0.0.1' },
        } as never, res as never);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal((res.body as Json).ok, true);
        assert.equal(res.headers['cache-control'], 'private, no-store');
        assert.deepEqual(fullSaveReads, []);

        await kv.set('save:viewerok', { character: { name: 'Viewer Ok' } });
        const clanless = mockRes();
        await handler({
            method: 'GET', query: { playerName: 'viewerok' }, body: undefined,
            headers: { 'x-player-name': 'viewerok', 'x-player-token': token, 'x-forwarded-for': '10.93.0.1' }, socket: { remoteAddress: '127.0.0.1' },
        } as never, clanless as never);
        assert.equal(clanless.statusCode, 400);
        assert.deepEqual(clanless.body, { error: 'Join a clan before forming an operation party.' });
    } finally {
        kv.get = originalGet as typeof kv.get;
    }
});
