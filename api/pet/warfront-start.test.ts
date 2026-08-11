import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'warfront-start-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let playerSequence = 0;
let PLAYER = 'wfstartprobe0';
const PET_IDS = ['war-pet-1', 'war-pet-2', 'war-pet-3', 'war-pet-4'];
const AUTHORED_SETUP = {
    stance: 'siege',
    doctrine: 'vanguard',
    buyPolicy: 'offense',
    deployment: ['top', 'mid', 'bottom', 'flex'],
    buildPackage: 'hold-line',
    coachOrder: 'contest',
    objectiveTechnique: 'zone',
    counterstrike: 'fortify',
};

let startHandler: Handler;
let resultHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let playerToken = '';

const pet = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 24,
    xp: 0,
    maxLevel: 100,
    hp: 640,
    attack: 76,
    defense: 48,
    speed: 62,
    element: 'Fire',
    jutsus: [],
    unlockedForPve: true,
    ...patch,
});

const character = (patch: Record<string, unknown> = {}) => ({
    name: PLAYER,
    level: 24,
    ryo: 0,
    professionRank: 0,
    patreon: { active: true },
    pets: PET_IDS.map((id) => pet(id)),
    ...patch,
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function prepare(): Promise<Out> {
    const prepared = response();
    await startHandler(request({ playerName: PLAYER, action: 'prepare' }), prepared.res);
    assert.equal(prepared.out.statusCode, 200);
    assert.match(String(prepared.out.body?.prepareToken), /^[A-Za-z0-9]{16,128}$/);
    return prepared.out;
}

function authorizationBody(prepareToken: string, patch: Record<string, unknown> = {}) {
    return {
        playerName: PLAYER,
        action: 'start',
        prepareToken,
        playerPetIds: PET_IDS,
        ...AUTHORED_SETUP,
        ...patch,
    };
}

async function mature(out: Out): Promise<void> {
    const token = String(out.body?.token ?? '');
    const key = `pet:battle-token:${PLAYER}:${token}`;
    const stored = await kv.get<Record<string, unknown>>(key);
    assert.ok(stored, 'the server-minted settlement token exists');
    await kv.set(key, { ...stored, notBefore: Date.now() - 1 });
}

async function settle(out: Out): Promise<Out> {
    const result = response();
    await resultHandler(request({
        playerName: PLAYER,
        outcome: out.body?.outcome,
        reportKey: out.body?.reportKey,
        battleToken: out.body?.token,
    }), result.res);
    return result.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    issuePlayerToken = auth.issuePlayerToken;
    startHandler = (await import('./warfront-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
});

beforeEach(async () => {
    PLAYER = `wfstartprobe${++playerSequence}`;
    playerToken = issuePlayerToken(PLAYER)!;
    for (const pattern of [
        `pet:warfront-active:${PLAYER}`,
        `pet:warfront-prepared:${PLAYER}`,
        `pet:warfront-authorization:${PLAYER}:*`,
        `pet:battle-active:${PLAYER}`,
        `pet:battle-token:${PLAYER}:*`,
        'ratelimit:*',
    ]) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character() });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('Warfront prepare hides its seed while authorization ignores caller identifiers and replays one sealed receipt', async () => {
    const prepared = await prepare();
    assert.equal('seed' in (prepared.body ?? {}), false, 'scouting cannot expose a seed-shopping oracle');
    assert.equal('outcome' in (prepared.body ?? {}), false, 'scouting cannot expose an outcome-shopping oracle');
    const prepareToken = String(prepared.body?.prepareToken);
    const body = authorizationBody(prepareToken, {
        seed: 0,
        reportKey: 'caller-selected',
    });
    const first = response();
    await startHandler(request(body), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.match(String(first.out.body?.token), /^[a-f0-9]{32}$/);
    assert.ok(Number.isSafeInteger(first.out.body?.seed));
    assert.ok(Number(first.out.body?.seed) > 0, 'the caller-supplied zero seed was ignored');
    assert.equal(first.out.body?.reportKey, `${String(first.out.body?.seed)}:tactical`);
    assert.ok(['win', 'loss', 'draw'].includes(String(first.out.body?.outcome)));
    assert.equal(first.out.body?.idempotentReplay, false);

    const stored = await kv.get<{
        playerName?: string;
        opponentLevel?: number;
        rewardRyo?: number;
        reportKey?: string;
        mode?: string;
        playerPetIds?: string[];
        authoritativeOutcome?: string;
        warfrontAuthorization?: { seed?: number; token?: string; prepareToken?: string };
    }>(`pet:battle-token:${PLAYER}:${String(first.out.body?.token)}`);
    assert.equal(stored?.playerName, PLAYER);
    assert.equal(stored?.mode, 'warfront');
    assert.equal(stored?.warfrontAuthorization?.seed, first.out.body?.seed);
    assert.equal(stored?.warfrontAuthorization?.token, first.out.body?.token);
    assert.equal(stored?.warfrontAuthorization?.prepareToken, prepareToken);
    assert.equal(stored?.reportKey, first.out.body?.reportKey);
    assert.deepEqual(stored?.playerPetIds, PET_IDS);
    assert.ok(Number.isSafeInteger(stored?.opponentLevel) && Number(stored?.opponentLevel) >= 1 && Number(stored?.opponentLevel) <= 100);
    assert.ok(Number.isSafeInteger(stored?.rewardRyo) && Number(stored?.rewardRyo) >= 20 && Number(stored?.rewardRyo) <= 250);
    assert.ok(['win', 'loss', 'draw'].includes(String(stored?.authoritativeOutcome)));
    assert.equal(await kv.get(`pet:warfront-active:${PLAYER}`), first.out.body?.token);

    const resumed = response();
    await startHandler(request({ ...body, seed: 2_147_483_647, reportKey: 'also-ignored' }), resumed.res);
    assert.equal(resumed.out.statusCode, 200);
    assert.equal(resumed.out.body?.idempotentReplay, true);
    assert.equal(resumed.out.body?.token, first.out.body?.token);
    assert.equal(resumed.out.body?.seed, first.out.body?.seed);

    const replayedAfterPickerChange = response();
    await startHandler(request({ ...body, playerPetIds: [...PET_IDS].reverse() }), replayedAfterPickerChange.res);
    assert.equal(replayedAfterPickerChange.out.statusCode, 200);
    assert.equal(replayedAfterPickerChange.out.body?.idempotentReplay, true);
    assert.equal(replayedAfterPickerChange.out.body?.token, first.out.body?.token,
        'a lost response recovers its immutable authorization even if the local picker changed');
    assert.deepEqual(
        (replayedAfterPickerChange.out.body?.blue as Array<{ pet?: { id?: string } }>).map((slot) => slot.pet?.id),
        PET_IDS,
    );

    await mature(first.out);
    const settled = await settle(first.out);
    assert.equal(settled.statusCode, 200);
    assert.equal(await kv.get(`pet:warfront-active:${PLAYER}`), null);
    assert.equal(await kv.get(`pet:battle-token:${PLAYER}:${String(first.out.body?.token)}`), null);

    const nextPrepared = await prepare();
    const next = response();
    await startHandler(request(authorizationBody(String(nextPrepared.body?.prepareToken))), next.res);
    assert.equal(next.out.statusCode, 200, 'settling any authoritative outcome releases the start gate');
    assert.notEqual(next.out.body?.token, first.out.body?.token);
    await kv.delIfEqual(`pet:warfront-active:${PLAYER}`, String(next.out.body?.token));
    await kv.del(`pet:battle-token:${PLAYER}:${String(next.out.body?.token)}`);
});

test('Warfront rejects breeding, training, and expedition-busy selections before minting a receipt', async () => {
    const cases = [
        {
            label: 'breeding',
            patch: {},
            characterPatch: {
                petBreeding: { state: 'breeding', parentIds: ['war-pet-1', 'war-pet-2'], readyAt: Date.now() + 60_000 },
            },
        },
        { label: 'training', patch: { training: { type: 'strength', endsAt: Date.now() + 60_000 } }, characterPatch: {} },
        { label: 'expedition', patch: { expedition: { type: 'scout', startedAt: 1, endsAt: Date.now() + 60_000, durationMs: 60_000 } }, characterPatch: {} },
    ];

    for (const busy of cases) {
        const pets = PET_IDS.map((id, index) => pet(id, index === 0 ? busy.patch : {}));
        await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character({ pets, ...busy.characterPatch }) });
        const prepared = await prepare();
        const out = response();
        await startHandler(request(authorizationBody(String(prepared.body?.prepareToken))), out.res);
        assert.equal(out.out.statusCode, 409, busy.label);
        assert.match(String(out.out.body?.error), /breeding, training, or an expedition/i);
        assert.equal(await kv.get(`pet:warfront-active:${PLAYER}`), null);
        assert.deepEqual(await kv.keys(`pet:battle-token:${PLAYER}:*`), []);
    }
});

test('Warfront validates its roster before reservation and then seals one active receipt pointer', async () => {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: character() });
    const prepared = await prepare();
    const prepareToken = String(prepared.body?.prepareToken);
    const activeKey = `pet:warfront-active:${PLAYER}`;
    const originalGet = kv.get.bind(kv);
    let leaseAtSaveRead: unknown = null;
    kv.get = (async (key: string) => {
        if (key === `save:${PLAYER}`) leaseAtSaveRead = await originalGet(activeKey);
        return originalGet(key);
    }) as typeof kv.get;
    const started = response();
    try {
        await startHandler(request(authorizationBody(prepareToken)), started.res);
    } finally {
        kv.get = originalGet as typeof kv.get;
    }
    assert.equal(started.out.statusCode, 200);
    assert.equal(leaseAtSaveRead, null,
        'availability validation does not hold an active reservation before the authoritative roster read');
    const battleToken = String(started.out.body?.token);
    assert.equal(await kv.get(activeKey), battleToken);
    assert.equal((await kv.get<{ reportKey?: string }>(`pet:battle-token:${PLAYER}:${battleToken}`))?.reportKey, started.out.body?.reportKey);
    assert.equal(
        (await kv.get<{ token?: string }>(`pet:warfront-authorization:${PLAYER}:${prepareToken}`))?.token,
        battleToken,
    );
    await kv.delIfEqual(activeKey, battleToken);
    await kv.del(`pet:battle-token:${PLAYER}:${battleToken}`);
});
