import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'story-settle-handler-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type StoredSave = { _saveVersion: number; character: Record<string, unknown> };

const PLAYER = 'storysettleowner';
const OTHER = 'storysettleother';
const RUN_ID = 'story-handler-run-0001';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
let otherToken = '';

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

function request(runId: string, authToken: string) {
    return {
        method: 'POST',
        body: { playerName: PLAYER, runId, kind: 'storyBoss' },
        headers: {
            'content-type': 'application/json',
            'x-player-token': authToken,
            'x-forwarded-for': '198.51.100.77',
        },
        socket: { remoteAddress: '198.51.100.77' },
    } as never;
}

function fighter(name: string, hp: number, pos: number): PvpFighter {
    return {
        name, hp, maxHp: 100, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], pos,
        character: {
            level: 50, specialty: 'Taijutsu',
            stats: { taijutsuOffense: 200, taijutsuDefense: 150 },
            jutsu: [], pvpItems: [], equipment: {},
        },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    otherToken = auth.issuePlayerToken(OTHER)!;
    handler = (await import('./settle.js')).default as unknown as Handler;
    const story = await import('./_authoritative-story-combat.js');
    const store = await import('../solo-pve/_store.js');

    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, village: 'Stormveil Village', level: 50,
            storyProgress: 0, ryo: 100, auraDust: 0, unspentStats: 0,
            hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
            chakra: 100, maxChakra: 100, inventory: [],
            starterCardsClaimed: true, tileCards: [],
        },
    });
    const binding = story.createStoryCombatBinding({
        runId: RUN_ID,
        playerName: PLAYER,
        village: 'Stormveil Village',
        progressIndex: 0,
    });
    const active = createSoloPveSession({
        sessionId: RUN_ID,
        ownerSlug: PLAYER,
        encounter: {
            kind: 'story-boss', id: 'Stormveil Village:0',
            sourceId: binding.opponentId, bindingId: RUN_ID,
        },
        player: fighter(PLAYER, 40, 62),
        enemy: fighter('Story Boss', 0, 63),
        now: Date.now(),
    });
    const completed: SoloPveSession = {
        ...active,
        status: 'done', winner: 'player', outcome: 'win',
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: 'story-final-move',
            finalVersion: 2, finalEventSeq: 1, winner: 'player', outcome: 'win',
            itemsUsed: {}, settlementState: 'pending',
        },
    };
    await store.writeSoloPveSession(completed);
    await kv.set(story.storyCombatBindingKey(RUN_ID), binding, { ex: story.STORY_COMBAT_SESSION_TTL_SECONDS });
});

after(async () => {
    const rateKeys = await kv.keys('ratelimit:story-settle:*');
    await kv.del(
        `save:${PLAYER}`,
        `story-combat-binding:${RUN_ID}`,
        `solo-pve:${RUN_ID}`,
        ...rateKeys,
    );
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('real story settle handler rejects another account before touching the sealed run', async () => {
    const beforeSave = await kv.get<StoredSave>(`save:${PLAYER}`);
    const { res, out } = response();
    await handler(request(RUN_ID, otherToken), res);
    assert.ok(out.statusCode === 401 || out.statusCode === 403);
    assert.deepEqual(await kv.get(`save:${PLAYER}`), beforeSave);
});

test('real story settle handler grants one authoritative Chronicle record and replays exactly once', async () => {
    const first = response();
    await handler(request(RUN_ID, token), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.ok, true);
    assert.equal(first.out.body?.replayed, false);
    assert.equal(first.out.body?._saveVersion, 2);
    assert.deepEqual(first.out.body?.chronicleCards, ['story-story-ai-stormveil-village-4']);
    const character = first.out.body?.character as Record<string, unknown>;
    assert.equal(character.storyProgress, 1);
    assert.deepEqual(character.elderWinDays, [{ day: new Date().toISOString().slice(0, 10), village: 'stormveilvillage', pvp: 0, pve: 1 }]);
    assert.equal(character.ryo, 175);
    assert.deepEqual(character.tileCards, ['story-story-ai-stormveil-village-4']);

    const stored = await kv.get<StoredSave>(`save:${PLAYER}`);
    assert.equal(stored?._saveVersion, 2);
    assert.deepEqual(stored?.character, character, 'the response must equal the locked persisted character');

    const replay = response();
    await handler(request(RUN_ID, token), replay.res);
    assert.equal(replay.out.statusCode, 200);
    assert.equal(replay.out.body?.replayed, true);
    assert.equal(replay.out.body?._saveVersion, 2);
    assert.deepEqual(replay.out.body?.character, character);
    assert.deepEqual(await kv.get(`save:${PLAYER}`), stored, 'lost-response replay must not pay or version-bump twice');
});

test('committed reward remains visible when Legacy delivery fails, then reconciles without another grant', async () => {
    const originalGet = kv.get;
    process.env.ENABLE_LEGACY = '1';
    kv.get = (async (key: string) => {
        if (key === `legacy:stats:${PLAYER}`) throw new Error('fixture: Legacy unavailable');
        return originalGet.call(kv, key);
    }) as typeof kv.get;
    const beforeSave = await kv.get<StoredSave>(`save:${PLAYER}`);
    try {
        const partial = response();
        await handler(request(RUN_ID, token), partial.res);
        assert.equal(partial.out.statusCode, 503);
        assert.equal(partial.out.body?.rewardCommitted, true);
        const committed = partial.out.body?.settlement as Record<string, unknown>;
        assert.deepEqual(committed.delivery, {
            battle: 'confirmed', personalReward: 'committed', combatRecord: 'confirmed', legacyRecord: 'pending',
        });
        assert.equal(committed.ryo, 75);
        assert.deepEqual(committed.character, beforeSave?.character);
        assert.deepEqual(await kv.get(`save:${PLAYER}`), beforeSave);
    } finally { kv.get = originalGet; }
    try {
        const retried = response();
        await handler(request(RUN_ID, token), retried.res);
        assert.equal(retried.out.statusCode, 200);
        assert.equal(retried.out.body?.replayed, true);
        assert.equal((retried.out.body?.delivery as Record<string, string>).legacyRecord, 'confirmed');
        assert.deepEqual(await kv.get(`save:${PLAYER}`), beforeSave);
        const credited = await kv.get(`legacy:stats:${PLAYER}`);
        await handler(request(RUN_ID, token), response().res);
        assert.deepEqual(await kv.get(`legacy:stats:${PLAYER}`), credited, 'the run receipt deduplicates Legacy delivery');
    } finally { delete process.env.ENABLE_LEGACY; }
});

test('a failed combat metadata write returns the committed receipt and remains repairable', async () => {
    const bindingKey = `story-combat-binding:${RUN_ID}`;
    const binding = await kv.get<Record<string, unknown>>(bindingKey);
    const beforeSave = await kv.get<StoredSave>(`save:${PLAYER}`);
    // Simulate a reward whose binding acknowledgement was interrupted.
    await kv.set(bindingKey, { ...binding, status: 'active', settledAt: undefined });
    const originalSet = kv.set;
    kv.set = (async (key: string, ...args: unknown[]) => {
        if (key === bindingKey) throw new Error('fixture: binding write unavailable');
        return Reflect.apply(originalSet, kv, [key, ...args]);
    }) as typeof kv.set;
    try {
        const partial = response();
        await handler(request(RUN_ID, token), partial.res);
        assert.equal(partial.out.statusCode, 503);
        assert.equal(partial.out.body?.rewardCommitted, true);
        const committed = partial.out.body?.settlement as Record<string, unknown>;
        assert.deepEqual(committed.delivery, {
            battle: 'confirmed', personalReward: 'committed', combatRecord: 'unavailable', legacyRecord: 'not-applicable',
        });
        assert.deepEqual(committed.character, beforeSave?.character);
    } finally { kv.set = originalSet; }
    const repaired = response();
    await handler(request(RUN_ID, token), repaired.res);
    assert.equal(repaired.out.statusCode, 200);
    assert.equal((repaired.out.body?.delivery as Record<string, string>).combatRecord, 'confirmed');
    assert.deepEqual(await kv.get(`save:${PLAYER}`), beforeSave, 'repair must not apply rewards or costs again');
});

test('unavailable authority records are not fabricated as confirmed or pending', async () => {
    const beforeSave = await kv.get<StoredSave>(`save:${PLAYER}`);
    await kv.del(`story-combat-binding:${RUN_ID}`, `solo-pve:${RUN_ID}`);
    const replay = response();
    await handler(request(RUN_ID, token), replay.res);
    assert.equal(replay.out.statusCode, 200);
    assert.deepEqual(replay.out.body?.delivery, {
        battle: 'confirmed', personalReward: 'committed', combatRecord: 'unavailable', legacyRecord: 'not-applicable',
    });
    assert.deepEqual(await kv.get(`save:${PLAYER}`), beforeSave);
});
