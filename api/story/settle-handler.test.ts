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
