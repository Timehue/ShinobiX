import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-session-consumable-authority-test';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./session.js').default;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function character(name: string) {
    return {
        name,
        level: 20,
        village: 'Leaf',
        maxHp: 500,
        maxChakra: 500,
        maxStamina: 500,
        hp: 500,
        chakra: 500,
        stamina: 500,
        stats: {},
        equipment: { thrown: 'thrown-shuriken' },
        inventory: ['thrown-shuriken', 'thrown-shuriken'],
        itemStacks: [],
        jutsu: [],
        jutsuMastery: [],
    };
}

function createRequest(
    playerName: string,
    p1: string,
    p2: string,
    battleId: string,
    ip = '127.0.0.1',
) {
    return {
        method: 'POST',
        body: {
            battleId,
            p1Character: { name: p1 },
            p2Character: { name: p2 },
        },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(playerName),
            'x-forwarded-for': ip,
        },
        socket: { remoteAddress: ip },
    } as never;
}

async function seedPlayers(...names: string[]) {
    for (const name of names) {
        await kv.set(`save:${name}`, { _saveVersion: 1, character: character(name) });
    }
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./session.js')).default as unknown as typeof handler;
});

test('new real-player casual sessions stamp v1 and expose zero consumable charges', async () => {
    await kv.set('save:casualone', { _saveVersion: 1, character: character('Casual One') });
    await kv.set('save:casualtwo', { _saveVersion: 1, character: character('Casual Two') });
    const token = issuePlayerToken('casualone');
    assert.ok(token);
    const req = {
        method: 'POST',
        body: {
            p1Character: { name: 'Casual One' },
            p2Character: { name: 'Casual Two' },
        },
        query: {},
        headers: {
            'x-player-token': token,
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    const { out, res } = response();
    await handler(req, res);
    assert.equal(out.statusCode, 200);
    const session = out.body?.session;
    assert.equal(session?.pvpConsumableAuthorityVersion, 1);
    assert.equal(session?.vanguardRewardAuthorityVersion, 2);
    assert.deepEqual(session?.realFighters, { p1: true, p2: true });
    assert.equal(session?.itemCharges?.p1?.['thrown-shuriken'], 0);
    assert.equal(session?.itemCharges?.p2?.['thrown-shuriken'], 0);
    assert.deepEqual(session?.itemsUsed, { p1: {}, p2: {} });
});

test('a stable create capability resumes one session and never indexes the unsolicited opponent', async () => {
    const creator = 'pointercreator';
    const opponent = 'pointeropponent';
    const battleId = 'pvp-11111111-1111-4111-8111-111111111111';
    await seedPlayers(creator, opponent);

    const first = response();
    await handler(createRequest(creator, creator, opponent, battleId, '127.0.0.2'), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.battleId, battleId);
    const creatorPointer = JSON.parse(String(await kv.get(`pvp:pending-session:${creator}`)));
    assert.equal(creatorPointer.battleId, battleId);
    assert.equal(creatorPointer.phase, 'active');
    assert.equal(await kv.get(`pvp:pending-session:${opponent}`), null);

    const lostResponseRetry = response();
    await handler(createRequest(creator, creator, opponent, battleId, '127.0.0.2'), lostResponseRetry.res);
    assert.equal(lostResponseRetry.out.statusCode, 200);
    assert.equal(lostResponseRetry.out.body?.battleId, battleId);
    assert.equal(lostResponseRetry.out.body?.resumed, true);
});

test('pointer activation failure rolls back to a same-capability replaceable tombstone', async () => {
    const creator = 'activationcreator';
    const opponent = 'activationopponent';
    const battleId = 'pvp-22222222-2222-4222-8222-222222222222';
    await seedPlayers(creator, opponent);
    const originalCompareSet = kv.compareSet.bind(kv);
    let failActivation = true;
    (kv as any).compareSet = async (key: string, expected: unknown, next: unknown, options?: unknown) => {
        if (failActivation && key === `pvp:pending-session:${creator}` && typeof next === 'string') {
            const parsed = JSON.parse(next) as { phase?: string };
            if (parsed.phase === 'active') {
                failActivation = false;
                throw new Error('forced-pointer-activation-precommit');
            }
        }
        return originalCompareSet(key, expected, next, options as never);
    };
    try {
        const first = response();
        await handler(createRequest(creator, creator, opponent, battleId, '127.0.0.3'), first.res);
        assert.equal(first.out.statusCode, 503);
        assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.version,
            'pvp-session-publication-tombstone-v1');

        const retry = response();
        await handler(createRequest(creator, creator, opponent, battleId, '127.0.0.3'), retry.res);
        assert.equal(retry.out.statusCode, 200);
        assert.equal(retry.out.body?.battleId, battleId);
        assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.status, 'active');
    } finally {
        (kv as any).compareSet = originalCompareSet;
    }
});

test('a creator paused past its pointer lease cannot leave an orphan after a successor wins', async () => {
    const creator = 'leasecreator';
    const firstOpponent = 'leaseopponentone';
    const secondOpponent = 'leaseopponenttwo';
    const firstBattle = 'pvp-33333333-3333-4333-8333-333333333333';
    const secondBattle = 'pvp-44444444-4444-4444-8444-444444444444';
    await seedPlayers(creator, firstOpponent, secondOpponent);

    const originalSet = kv.set.bind(kv);
    const originalNow = Date.now;
    let clock = 1_800_000_000_000;
    let releaseFirst!: () => void;
    let observeFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => { observeFirst = resolve; });
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let paused = false;
    Date.now = () => clock;
    (kv as any).set = async (key: string, value: unknown, options?: unknown) => {
        if (!paused && key === `pvp:${firstBattle}`) {
            paused = true;
            observeFirst();
            await firstReleased;
        }
        return originalSet(key, value, options as never);
    };
    try {
        const first = response();
        const firstCreate = handler(
            createRequest(creator, creator, firstOpponent, firstBattle, '127.0.0.4'),
            first.res,
        );
        await firstPaused;
        clock += 31_000;

        const successor = response();
        await handler(
            createRequest(creator, creator, secondOpponent, secondBattle, '127.0.0.5'),
            successor.res,
        );
        assert.equal(successor.out.statusCode, 200);
        releaseFirst();
        await firstCreate;
        assert.equal(first.out.statusCode, 503);

        const pointer = JSON.parse(String(await kv.get(`pvp:pending-session:${creator}`)));
        assert.equal(pointer.battleId, secondBattle);
        assert.equal((await kv.get<Record<string, unknown>>(`pvp:${secondBattle}`))?.status, 'active');
        assert.equal((await kv.get<Record<string, unknown>>(`pvp:${firstBattle}`))?.version,
            'pvp-session-publication-tombstone-v1');
    } finally {
        releaseFirst?.();
        Date.now = originalNow;
        (kv as any).set = originalSet;
    }
});
