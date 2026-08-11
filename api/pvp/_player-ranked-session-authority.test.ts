import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'player-ranked-session-authority-test-secret';
process.env.ENABLE_PLAYER_RANKED_V2 = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let mint: typeof import('../_ranked-match-token.js').mintPlayerRankedMatchToken;

const names = ['rankedsessionalice', 'rankedsessionbob', 'rankedsessioncara', 'rankedsessiondan', 'rankedsessionerin', 'rankedsessionfinn'];

function character(name: string) {
    return {
        name,
        level: 24,
        rankedRating: 1000,
        hp: 200,
        maxHp: 200,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        stats: { strength: 20, defense: 20, speed: 20, intelligence: 20, chakra: 20 },
        jutsu: [],
        // Deliberately grandfather a built-in thrown definition under `hand`.
        // Old move workers classify the catalog definition, not this slot key.
        equipment: { hand: 'thrown-shuriken' },
        inventory: ['thrown-shuriken'],
        itemStacks: [],
    };
}

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(player: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function sessionRequest(a: string, b: string, matchId?: string, seasonId = 1, seasonEpoch = 1) {
    const out = response();
    await handler(request(a, {
        p1Character: { name: a },
        p2Character: { name: b },
        ranked: true,
        rankedKind: 'player',
        ...(matchId ? {
            rankedMatchId: matchId,
            rankedSeasonId: seasonId,
            rankedSeasonEpoch: seasonEpoch,
        } : {}),
    }), out.res);
    return out.out;
}

async function pair(a: string, b: string, matchId: string) {
    return mint({
        a, b, aLevel: 24, bLevel: 24, aRating: 1000, bRating: 1000,
        matchId,
    });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ mintPlayerRankedMatchToken: mint } = await import('../_ranked-match-token.js'));
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    await startRankedSeason(Date.now());
    await Promise.all(names.map((name) => kv.set(`save:${name}`, { _saveVersion: 1, character: character(name) })));
    handler = (await import('./session.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_PLAYER_RANKED_V2;
});

test('ranked request without exact match proof returns 409 and never becomes casual', async () => {
    const out = await sessionRequest(names[0], names[1]);
    assert.equal(out.statusCode, 409);
    assert.match(String(out.body?.error), /ranked match proof/i);
    assert.equal(out.body?.session, undefined);
});

test('session binds exact matchId, pair, season, and epoch', async () => {
    const matchId = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
    await pair(names[0], names[1], matchId);
    const out = await sessionRequest(names[0], names[1], matchId);
    assert.equal(out.statusCode, 200);
    assert.equal(out.body?.session?.ranked, false);
    assert.equal(out.body?.session?.baseRewards, false);
    assert.equal(out.body?.session?.playerRankedAuthorityVersion, 2);
    assert.equal(out.body?.session?.rankedKind, 'player');
    assert.equal(out.body?.session?.rankedMatchId, matchId);
    assert.equal(out.body?.session?.rankedSeasonId, 1);
    assert.equal(out.body?.session?.rankedSeasonEpoch, 1);
    assert.equal(out.body?.session?.rewardAuthority, 'ranked');
    assert.equal(
        out.body?.session?.itemCharges?.p1?.['thrown-shuriken'],
        0,
        'even a grandfathered hand->thrown definition is legacy-worker inert',
    );
    assert.equal(
        out.body?.session?.itemCharges?.p2?.['thrown-shuriken'],
        0,
    );
});

test('session admission precommit failure leaves queued proof retryable', async () => {
    const matchId = 'player-ranked-22345678-1234-4123-8123-1234567890ab';
    await pair(names[2], names[3], matchId);
    const original = kv.compareSet.bind(kv);
    let failed = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const gate = value as { playerAdmissions?: Array<{ matchId?: string; phase?: string }> };
        if (key === 'ranked:season:authority'
            && gate.playerAdmissions?.some((entry) => entry.matchId === matchId && entry.phase === 'active')
            && !failed) {
            failed = true;
            throw new Error('activation-precommit');
        }
        return original(key, expected, value, options);
    }) as typeof kv.compareSet;
    const originalError = console.error;
    console.error = () => undefined;
    try {
        const interrupted = await sessionRequest(names[2], names[3], matchId);
        assert.equal(interrupted.statusCode, 503);
    } finally {
        kv.compareSet = original as typeof kv.compareSet;
        console.error = originalError;
    }
    const retry = await sessionRequest(names[2], names[3], matchId);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body?.session?.rankedMatchId, matchId);
});

test('session recognizes activation and session-publication lost acknowledgements', async () => {
    const matchId = 'player-ranked-32345678-1234-4123-8123-1234567890ab';
    await pair(names[4], names[5], matchId);
    const originalCas = kv.compareSet.bind(kv);
    const originalSet = kv.set.bind(kv);
    let lostActivation = false;
    let lostSession = false;
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const committed = await originalCas(key, expected, value, options);
        const gate = value as { playerAdmissions?: Array<{ matchId?: string; phase?: string }> };
        if (committed
            && key === 'ranked:season:authority'
            && gate.playerAdmissions?.some((entry) => entry.matchId === matchId && entry.phase === 'active')
            && !lostActivation) {
            lostActivation = true;
            throw new Error('activation-lost-ack');
        }
        return committed;
    }) as typeof kv.compareSet;
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        const result = await originalSet(key, value, options);
        if (key.startsWith('pvp:pvp-') && !lostSession) {
            lostSession = true;
            throw new Error('session-lost-ack');
        }
        return result;
    }) as typeof kv.set;
    try {
        const out = await sessionRequest(names[4], names[5], matchId);
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.session?.rankedMatchId, matchId);
        assert.equal(lostActivation, true);
        assert.equal(lostSession, true);
    } finally {
        kv.compareSet = originalCas as typeof kv.compareSet;
        kv.set = originalSet as typeof kv.set;
    }
});

test('mismatched client season or epoch returns 409 without consuming the queued admission', async () => {
    const matchId = 'player-ranked-52345678-1234-4123-8123-1234567890ab';
    const a = 'rankedsessionirene';
    const b = 'rankedsessionjules';
    await Promise.all([
        kv.set(`save:${a}`, { _saveVersion: 1, character: character(a) }),
        kv.set(`save:${b}`, { _saveVersion: 1, character: character(b) }),
    ]);
    await pair(a, b, matchId);

    const stale = await sessionRequest(a, b, matchId, 1, 999);
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body?.session, undefined);

    const retry = await sessionRequest(a, b, matchId, 1, 1);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body?.session?.rankedMatchId, matchId);
});

test('active retry rejects a battle row whose season authority was corrupted', async () => {
    const matchId = 'player-ranked-42345678-1234-4123-8123-1234567890ab';
    const a = 'rankedsessiongrace';
    const b = 'rankedsessionhugo';
    await Promise.all([
        kv.set(`save:${a}`, { _saveVersion: 1, character: character(a) }),
        kv.set(`save:${b}`, { _saveVersion: 1, character: character(b) }),
    ]);
    await pair(a, b, matchId);
    const created = await sessionRequest(a, b, matchId);
    assert.equal(created.statusCode, 200);
    const battleId = String(created.body?.battleId);
    const session = await kv.get<Record<string, unknown>>(`pvp:${battleId}`);
    assert.ok(session);
    await kv.set(`pvp:${battleId}`, { ...session, rankedSeasonEpoch: 999 }, { ex: 900 });

    const originalError = console.error;
    console.error = () => undefined;
    try {
        const retry = await sessionRequest(a, b, matchId);
        assert.equal(retry.statusCode, 503);
        assert.match(String(retry.body?.error), /confirm the ranked session/i);
    } finally {
        console.error = originalError;
        await kv.set(`pvp:${battleId}`, session, { ex: 900 });
    }
});
