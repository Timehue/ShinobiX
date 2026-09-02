import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The end-to-end shape of the bug that has now broken twice: read your own save,
 * then autosave, and get a 409 for a divergence that never existed.
 *
 * Everything else about this is pinned at unit level — `_elapsed-state-persistence`
 * proves a projection-only settle does not bump, `_elapsed-vital-consumers` proves
 * admissions still read the regenerated vitals, `_foreign-read-no-write` proves a
 * foreign read never writes at all. None of them drives the actual route, so none
 * of them would have caught the merge (`d9ef64aa9`) that dropped the guard: the
 * player-visible contract is a GET followed by a POST, and that pair was untested.
 *
 * Both directions matter. If the settle bumps, the first test fails. If someone
 * "fixes" that by weakening the concurrency guard so nothing 409s, the second test
 * fails instead.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'owner-read-version-stability-secret-with-entropy';
process.env.ENABLE_LEGACY = '0';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;

const TEST_PREFIX = 'ownerreadversion';
const WORLD_GEO_VERSION = 2;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let PET_BREEDING_MIGRATION_VERSION: number;

function character(name: string): Json {
    return {
        name,
        level: 1,
        xp: 0,
        experience: 0,
        ryo: 0,
        rank: 'Academy Student',
        rankTitle: 'Academy Student',
        village: '',
        stats: {},
        inventory: [],
        itemStacks: [],
        pets: [],
        equipment: {},
        earnedTitles: [],
        serverTitles: [],
        // Stamped so the one-time pet migration cannot be what moves the version —
        // that IS durable and legitimately bumps, which would mask the real answer.
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        hp: 0, maxHp: 100,
        chakra: 0, maxChakra: 100,
        stamina: 0, maxStamina: 100,
    };
}

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function headers(name: string, token: string) {
    return {
        'x-player-name': name,
        'x-player-token': token,
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.77',
    };
}

async function readOwnSave(name: string, token: string) {
    const response = fakeRes();
    await handler({
        method: 'GET',
        query: { name },
        headers: headers(name, token),
        socket: { remoteAddress: '203.0.113.77' },
    } as never, response.res);
    return response.out;
}

async function autosave(name: string, token: string, baseVersion: number) {
    const response = fakeRes();
    await handler({
        method: 'POST',
        query: { name },
        body: { _baseSaveVersion: baseVersion, character: character(name) },
        headers: headers(name, token),
        socket: { remoteAddress: '203.0.113.77' },
    } as never, response.res);
    return response.out;
}

async function seed(name: string, saveVersion: number) {
    await kv.set(`save:${name}`, {
        _saveVersion: saveVersion,
        _saveAt: Date.now() - 60_000, // a minute of unclaimed regen
        worldGeoV: WORLD_GEO_VERSION,
        currentSector: 12,
        currentBiome: 'central',
        character: character(name),
    });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
});

after(async () => {
    for (const key of await kv.keys(`*${TEST_PREFIX}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('an owner GET leaves the version that its own next autosave will echo', async () => {
    const name = `${TEST_PREFIX}stable`;
    const token = issuePlayerToken(name);
    assert.ok(token);
    await seed(name, 5);

    const read = await readOwnSave(name, token);
    assert.equal(read.statusCode, 200, JSON.stringify(read.body));
    const served = (read.body as Json)._saveVersion;
    const servedCharacter = (read.body as Json).character as Json;

    // Guard against a vacuous pass: the settle must really have done something.
    assert.ok(Number(servedCharacter.stamina) > 0, 'the read projects a minute of regen');
    const stored = await kv.get<Json>(`save:${name}`);
    assert.equal(
        (stored?.character as Json).stamina,
        servedCharacter.stamina,
        'and persists it, so admissions reading the raw row debit from the same number',
    );

    assert.equal(served, 5, 'a projection-only settle must not publish a new version');

    const saved = await autosave(name, token, Number(served));
    assert.equal(saved.statusCode, 200,
        'the autosave that follows an owner read must be accepted, not 409ed');
});

test('the stale-write guard is still armed after an owner read', async () => {
    // Distinct player: an accepted save charges the one-per-3s save-burst budget,
    // and a 409 charges the separate save-conflict bucket.
    const name = `${TEST_PREFIX}guard`;
    const token = issuePlayerToken(name);
    assert.ok(token);
    await seed(name, 5);

    const read = await readOwnSave(name, token);
    assert.equal(read.statusCode, 200, JSON.stringify(read.body));

    const stale = await autosave(name, token, Number((read.body as Json)._saveVersion) - 1);
    assert.equal(stale.statusCode, 409, 'a genuinely stale base version must still conflict');
    assert.equal((stale.body as Json).currentVersion, 5);
});
