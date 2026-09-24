import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo.js';
import { riftTargetSector } from '../sector/_rift-quest.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';

// Rift entry used to demand 4 carried pets and a saved 40-card deck. The intro
// rift is offered at level 12 and the Card Hall opens at 17, so its own
// audience accepted the quest, travelled to the rift and was refused at the
// door. Entry now asks only what the quest already sealed.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hollow-gate-rift-readiness-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

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

async function postStart(playerName: string, requestId: string, cardClashDeck?: readonly string[]): Promise<Out> {
    const out = response();
    await handler({
        method: 'POST',
        body: { playerName, requestId, variantId: 'rift-legacy-echo', ...(cardClashDeck ? { cardClashDeck } : {}) },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName)!,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, out.res);
    return out.out;
}

function unpreparedSave(playerName: string) {
    const targetSector = riftTargetSector(playerName, 'rift-legacy-echo');
    return {
        _saveVersion: 1,
        currentSector: targetSector,
        activeRiftQuestSeal: { id: 'rift-legacy-echo', targetSector, baseline: 0, at: Date.now(), geoV: WORLD_GEO_VERSION },
        character: {
            // The intro rift's own audience: level 12, no companions, and a
            // Card Hall that stays sealed until the level-17 Scribe.
            name: playerName, level: 12, hp: 300, maxHp: 300, ryo: 250,
            pets: [], tileCards: [],
            itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }],
        },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./start.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a level-12 player with no pets and no deck enters the intro rift', async () => {
    const playerName = 'rift-novice-player';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    const original = unpreparedSave(playerName);
    await kv.set(saveKey, original);

    const started = await postStart(playerName, 'rift-novice-request-1');
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.ok(started.body?.token, 'the rift mints its run');
    assert.equal(started.body?.variantId, 'rift-legacy-echo');
    assert.equal(await kv.get(countKey), 1);

    const saved = await kv.get<{ character: Record<string, unknown> }>(saveKey);
    assert.deepEqual(saved?.character.itemStacks, original.character.itemStacks, 'a rift spends no Hollow Gate key');
    assert.deepEqual(saved?.character.tileCards, [], 'entry grants no cards');
    assert.equal(saved?.character.cardClashDeck, undefined, 'entry writes no deck');
    assert.deepEqual(saved?.character.pets, [], 'entry needs no companions');
    const run = await kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, String(started.body?.token)));
    assert.equal(run?.variantId, 'rift-legacy-echo');
    assert.equal(run?.floorDepth, 1);

    // A lost response replays the same paid run instead of using a second entry.
    const replay = await postStart(playerName, 'rift-novice-request-1');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.token, started.body?.token);
    assert.equal(await kv.get(countKey), 1);
});

test('a deck sent by an older client is ignored rather than committed', async () => {
    const playerName = 'rift-old-client-player';
    const saveKey = `save:${playerName}`;
    await kv.set(saveKey, unpreparedSave(playerName));

    // Older builds attached the Card Hall selection so the gate could see it.
    // The gate checked it against owned cards PLUS a starter floor the player
    // might not own yet, then wrote it. Nothing from the request may reach the
    // save any more.
    const started = await postStart(playerName, 'rift-old-client-request', CHRONICLE_FIXED_FALLBACK_DECK);
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const saved = await kv.get<{ character: Record<string, unknown> }>(saveKey);
    assert.equal(saved?.character.cardClashDeck, undefined);
    assert.deepEqual(saved?.character.tileCards, []);
});
