import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'bloodline-owner-full-admin-password';
process.env.ADMIN_CONTENT_PASSWORD = 'bloodline-owner-content-admin-password';
process.env.ADMIN_SESSION_SECRET = 'bloodline-owner-admin-session-secret-32-bytes';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

const PLAYER_A = 'bloodlineownera';
const PLAYER_B = 'bloodlineownerb';
const ADMIN_PREFIX_PLAYER = 'adminfoo';
const BLOODLINE_ID = 'shared-bloodline-id';
const CLEANUP_KEYS = [
    `save:${PLAYER_A}`,
    `save:${PLAYER_B}`,
    `save:${ADMIN_PREFIX_PLAYER}`,
    'save:admin1',
    `admin-lock:${PLAYER_A}`,
    `admin-lock:${PLAYER_B}`,
    `reset-signal:${PLAYER_A}`,
    `reset-signal:${PLAYER_B}`,
    `admin-lock:${ADMIN_PREFIX_PLAYER}`,
    `reset-signal:${ADMIN_PREFIX_PLAYER}`,
    'admin:approvedBloodlines',
    'player:registry',
    'shared:imgfields:bloodline',
];

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let adminPlayersHandler: Handler;
let publicBloodlinesHandler: Handler;
let contentToken = '';

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(
    body: unknown,
    remoteAddress: string,
    headers: Record<string, string> = { 'x-admin-password': process.env.ADMIN_PASSWORD! },
): Promise<Out> {
    const { out, res } = response();
    await handler({
        method: 'POST',
        query: {},
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
        body,
        socket: { remoteAddress },
    } as never, res);
    return out;
}

function playerSave(name: string, bloodlineName: string): Json {
    return {
        _saveVersion: 7,
        character: { name, level: 40, ryo: 500 },
        savedBloodlines: [{
            id: BLOODLINE_ID,
            name: bloodlineName,
            rank: 'A Rank',
            jutsus: [],
            totalPoints: 10,
        }],
        savedImages: { [`bloodline:${BLOODLINE_ID}`]: '/images/original.webp' },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    contentToken = auth.issueAdminToken('content') ?? '';
    assert.ok(contentToken);
    handler = (await import('./bloodline-review.js')).default as unknown as Handler;
    adminPlayersHandler = (await import('./players.js')).default as unknown as Handler;
    publicBloodlinesHandler = (await import('../bloodlines/list.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.del(...CLEANUP_KEYS);
});

after(async () => {
    await kv.del(...CLEANUP_KEYS);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_CONTENT_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
});

test('same-id player bloodlines remain bound to the exact requested owner', async () => {
    const saveA = playerSave('Bloodline Owner A', 'Owner A Bloodline');
    const saveB = playerSave('Bloodline Owner B', 'Owner B Bloodline');
    await kv.set(`save:${PLAYER_A}`, saveA);
    await kv.set(`save:${PLAYER_B}`, saveB);
    const beforeB = JSON.stringify(await kv.get(`save:${PLAYER_B}`));

    const updated = await post({
        action: 'update',
        ownerKey: PLAYER_A,
        bloodlineId: BLOODLINE_ID,
        bloodline: { name: 'Owner A Updated', totalPoints: 99 },
    }, '127.0.0.91');

    assert.equal(updated.statusCode, 200);
    const afterA = await kv.get<Json>(`save:${PLAYER_A}`);
    const afterB = await kv.get<Json>(`save:${PLAYER_B}`);
    assert.equal(Number(afterA?._saveVersion), 8);
    assert.equal(
        ((afterA?.savedBloodlines as Json[])[0]).name,
        'Owner A Updated',
    );
    assert.equal(JSON.stringify(afterB), beforeB, 'the same-id bloodline in owner B must remain byte-identical');
    assert.equal(await kv.get(`admin-lock:${PLAYER_A}`), 1);
    assert.equal(await kv.get(`reset-signal:${PLAYER_A}`), 1);
    assert.equal(await kv.get(`admin-lock:${PLAYER_B}`), null);
    assert.equal(await kv.get(`reset-signal:${PLAYER_B}`), null);
    assert.deepEqual(afterA?.savedImages, saveA.savedImages, 'save-scoped images must survive the locked merge');
});

test('an absent owner-local id does not rewrite or signal that save', async () => {
    const saveA = playerSave('Bloodline Owner A', 'Different Bloodline');
    saveA.savedBloodlines = [{ ...(saveA.savedBloodlines as Json[])[0], id: 'different-id' }];
    await kv.set(`save:${PLAYER_A}`, saveA);
    const before = JSON.stringify(await kv.get(`save:${PLAYER_A}`));

    const result = await post({
        action: 'delete',
        ownerKey: PLAYER_A,
        bloodlineId: BLOODLINE_ID,
    }, '127.0.0.92');

    assert.equal(result.statusCode, 200);
    assert.equal(JSON.stringify(await kv.get(`save:${PLAYER_A}`)), before);
    assert.equal(await kv.get(`admin-lock:${PLAYER_A}`), null);
    assert.equal(await kv.get(`reset-signal:${PLAYER_A}`), null);
});

test('an update for a deleted owner-local id fails instead of reporting a phantom success', async () => {
    const saveA = playerSave('Bloodline Owner A', 'Different Bloodline');
    saveA.savedBloodlines = [{ ...(saveA.savedBloodlines as Json[])[0], id: 'different-id' }];
    await kv.set(`save:${PLAYER_A}`, saveA);
    const before = JSON.stringify(await kv.get(`save:${PLAYER_A}`));

    const result = await post({
        action: 'update',
        ownerKey: PLAYER_A,
        bloodlineId: BLOODLINE_ID,
        bloodline: { name: 'Phantom Update' },
    }, '127.0.0.93');

    assert.equal(result.statusCode, 409);
    assert.equal(JSON.stringify(await kv.get(`save:${PLAYER_A}`)), before);
    assert.equal(await kv.get('admin:approvedBloodlines'), null);
    assert.equal(await kv.get(`admin-lock:${PLAYER_A}`), null);
    assert.equal(await kv.get(`reset-signal:${PLAYER_A}`), null);
});

test('malformed owner and bloodline identities fail closed without touching saves or review state', async () => {
    const saveA = playerSave('Bloodline Owner A', 'Owner A Bloodline');
    await kv.set(`save:${PLAYER_A}`, saveA);
    const before = JSON.stringify(await kv.get(`save:${PLAYER_A}`));
    const malformedBodies: unknown[] = [
        null,
        [],
        { action: 'update', ownerKey: {}, bloodlineId: BLOODLINE_ID, bloodline: { name: 'Wrong' } },
        { action: 'update', ownerKey: '   ', bloodlineId: BLOODLINE_ID, bloodline: { name: 'Wrong' } },
        { action: 'update', ownerKey: PLAYER_A, bloodlineId: [], bloodline: { name: 'Wrong' } },
        { action: 'update', ownerKey: PLAYER_A, bloodlineId: '   ', bloodline: { name: 'Wrong' } },
        { action: 'update', ownerKey: PLAYER_A, bloodlineId: BLOODLINE_ID, bloodline: [] },
    ];

    for (let index = 0; index < malformedBodies.length; index += 1) {
        const result = await post(malformedBodies[index], `127.0.1.${index + 1}`);
        assert.equal(result.statusCode, 400);
    }
    assert.equal(JSON.stringify(await kv.get(`save:${PLAYER_A}`)), before);
    assert.equal(await kv.get('admin:approvedBloodlines'), null);
    assert.equal(await kv.get(`admin-lock:${PLAYER_A}`), null);
    assert.equal(await kv.get(`reset-signal:${PLAYER_A}`), null);
});

test('content-admin password and token retain exact-owner curation authority', async () => {
    const contentCredentials: Array<Record<string, string>> = [
        { 'x-admin-password': process.env.ADMIN_CONTENT_PASSWORD! },
        { 'x-admin-token': contentToken },
    ];
    for (const [index, headers] of contentCredentials.entries()) {
        await kv.set(`save:${PLAYER_A}`, playerSave('Bloodline Owner A', `Owner A Bloodline ${index}`));
        const result = await post({
            action: 'update',
            ownerKey: PLAYER_A,
            bloodlineId: BLOODLINE_ID,
            bloodline: { name: `Content Updated ${index}` },
        }, `127.0.2.${index + 1}`, headers);
        assert.equal(result.statusCode, 200);
        const saved = await kv.get<Json>(`save:${PLAYER_A}`);
        assert.equal(((saved?.savedBloodlines as Json[])[0]).name, `Content Updated ${index}`);
    }
});

test('a legitimate player whose slug starts with admin still receives the exact locked update', async () => {
    await kv.set(`save:${ADMIN_PREFIX_PLAYER}`, playerSave('Admin Foo', 'Admin Foo Bloodline'));
    await kv.set('save:admin1', playerSave('Admin 1', 'Admin Content Bloodline'));
    const result = await post({
        action: 'update',
        ownerKey: ADMIN_PREFIX_PLAYER,
        bloodlineId: BLOODLINE_ID,
        bloodline: { name: 'Admin Foo Updated' },
    }, '127.0.2.9');

    assert.equal(result.statusCode, 200);
    const saved = await kv.get<Json>(`save:${ADMIN_PREFIX_PLAYER}`);
    assert.equal(((saved?.savedBloodlines as Json[])[0]).name, 'Admin Foo Updated');
    assert.equal(await kv.get(`admin-lock:${ADMIN_PREFIX_PLAYER}`), 1);
    assert.equal(await kv.get(`reset-signal:${ADMIN_PREFIX_PLAYER}`), 1);
});

test('admin and public projections keep save-scoped art separate from an id-only shared fallback', async () => {
    const withOwnerImage = playerSave('Bloodline Owner A', 'Owner A Bloodline');
    (withOwnerImage.savedBloodlines as Json[])[0]!.image = '/api/img/player-a.webp';
    const withoutOwnerImage = playerSave('Bloodline Owner B', 'Owner B Bloodline');
    delete (withoutOwnerImage.savedBloodlines as Json[])[0]!.image;
    await kv.set(`save:${PLAYER_A}`, withOwnerImage);
    await kv.set(`save:${PLAYER_B}`, withoutOwnerImage);
    await kv.hset('player:registry', {
        [PLAYER_A]: JSON.stringify({ name: 'Bloodline Owner A', level: 40 }),
        [PLAYER_B]: JSON.stringify({ name: 'Bloodline Owner B', level: 40 }),
        [ADMIN_PREFIX_PLAYER]: JSON.stringify({ name: 'Admin Foo', level: 40 }),
    });
    await kv.set(`save:${ADMIN_PREFIX_PLAYER}`, playerSave('Admin Foo', 'Admin Foo Bloodline'));
    await kv.hset('shared:imgfields:bloodline', {
        [`bloodline:${BLOODLINE_ID}`]: '/api/img/admin-shared.webp',
    });

    const { out: adminOut, res: adminRes } = response();
    await adminPlayersHandler({
        method: 'POST',
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        body: {},
        socket: { remoteAddress: '127.0.3.1' },
    } as never, adminRes);
    assert.equal(adminOut.statusCode, 200);

    const { out: publicOut, res: publicRes } = response();
    await publicBloodlinesHandler({
        method: 'GET',
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.3.2' },
    } as never, publicRes);
    assert.equal(publicOut.statusCode, 200);

    for (const body of [adminOut.body, publicOut.body]) {
        const entries = body?.bloodlines as Json[];
        const ownerA = entries.find((entry) => entry.ownerKey === PLAYER_A);
        const ownerB = entries.find((entry) => entry.ownerKey === PLAYER_B);
        const adminPrefixPlayer = entries.find((entry) => entry.ownerKey === ADMIN_PREFIX_PLAYER);
        assert.equal(ownerA?.ownerImage, '/api/img/player-a.webp');
        assert.equal(ownerA?.image, '/api/img/player-a.webp');
        assert.equal(ownerB?.ownerImage, undefined);
        assert.equal(ownerB?.image, '/api/img/admin-shared.webp');
        assert.equal(adminPrefixPlayer?.ownerName, 'Admin Foo');
        assert.equal(entries.some((entry) => entry.ownerKey === 'admin1'), false, 'content slots are not player review owners');
    }
});
