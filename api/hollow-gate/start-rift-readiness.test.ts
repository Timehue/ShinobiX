import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo.js';
import { riftTargetSector } from '../sector/_rift-quest.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';

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

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./start.js')).default as unknown as Handler;
});

test('a valid selected deck is committed with rift entry even before autosave', async () => {
    const playerName = 'rift-local-deck-player';
    const saveKey = `save:${playerName}`;
    const targetSector = riftTargetSector(playerName, 'rift-legacy-echo');
    await kv.set(saveKey, {
        _saveVersion: 1,
        currentSector: targetSector,
        activeRiftQuestSeal: { id: 'rift-legacy-echo', targetSector, baseline: 0, at: Date.now(), geoV: WORLD_GEO_VERSION },
        character: {
            name: playerName, level: 20, hp: 500, maxHp: 500,
            pets: Array.from({ length: 4 }, (_, index) => ({ id: `rift-local-pet-${index}` })),
            tileCards: [],
        },
    });

    const started = await postStart(playerName, 'rift-local-deck-request', CHRONICLE_FIXED_FALLBACK_DECK);
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const saved = await kv.get<{ character: { cardClashDeck?: string[] } }>(saveKey);
    assert.deepEqual(saved?.character.cardClashDeck, CHRONICLE_FIXED_FALLBACK_DECK);

    const token = String(started.body?.token ?? '');
    const runKey = hollowGateRunKey(playerName, token);
    const run = await kv.get<HollowGateRunToken>(runKey);
    assert.ok(run);
    const nodeId = 'floor:1:ambush:threat-v1';
    await kv.set(runKey, { ...run, pendingAmbush: { nodeId, kind: 'card' } });
    const cardStart = (await import('./card-start.js')).default as unknown as Handler;
    const out = response();
    await cardStart({
        method: 'POST', body: { playerName, token, nodeId },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, out.res);
    assert.equal(out.out.statusCode, 200, JSON.stringify(out.out.body));
    assert.ok(out.out.body?.matchId, 'the selected deck starts the bound card ambush');
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('rift start refuses missing pets or deck before using an entry and admits a prepared party', async () => {
    const playerName = 'rift-readiness-player';
    const saveKey = `save:${playerName}`;
    const countKey = `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;
    const targetSector = riftTargetSector(playerName, 'rift-legacy-echo');
    const seal = { id: 'rift-legacy-echo', targetSector, baseline: 0, at: Date.now(), geoV: WORLD_GEO_VERSION };
    const pets = Array.from({ length: 4 }, (_, index) => ({ id: `rift-pet-${index + 1}` }));
    const original = {
        _saveVersion: 1,
        currentSector: targetSector,
        activeRiftQuestSeal: seal,
        character: {
            name: playerName,
            level: 20,
            hp: 500,
            maxHp: 500,
            pets: pets.slice(0, 3),
            tileCards: [],
            cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK],
            itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }],
        },
    };
    await kv.set(saveKey, original);

    const missingPet = await postStart(playerName, 'rift-readiness-request-1');
    assert.equal(missingPet.statusCode, 409);
    assert.equal(missingPet.body?.error, 'rift-entry-not-ready');
    assert.deepEqual(await kv.get(saveKey), original);
    assert.equal(await kv.get(countKey), null);

    const noDeck = { ...original, character: { ...original.character, pets, cardClashDeck: [] } };
    await kv.set(saveKey, noDeck);
    const missingDeck = await postStart(playerName, 'rift-readiness-request-1');
    assert.equal(missingDeck.statusCode, 409);
    assert.equal(missingDeck.body?.error, 'rift-entry-not-ready');
    assert.deepEqual(await kv.get(saveKey), noDeck);
    assert.equal(await kv.get(countKey), null);

    const illegalDeck = { ...original, character: { ...original.character, pets, cardClashDeck: Array(40).fill('tc-01') } };
    await kv.set(saveKey, illegalDeck);
    const invalidDeck = await postStart(playerName, 'rift-readiness-request-1');
    assert.equal(invalidDeck.statusCode, 409);
    assert.equal(invalidDeck.body?.error, 'rift-entry-not-ready');
    assert.deepEqual(await kv.get(saveKey), illegalDeck);
    assert.equal(await kv.get(countKey), null);

    await kv.set(saveKey, { ...original, character: { ...original.character, pets } });
    const started = await postStart(playerName, 'rift-readiness-request-1');
    assert.equal(started.statusCode, 200);
    assert.ok(started.body?.token);
    assert.equal(await kv.get(countKey), 1);
    const saved = await kv.get<{ character: { itemStacks: unknown[]; lastHollowGateStart: { requestId: string } } }>(saveKey);
    assert.deepEqual(saved?.character.itemStacks, original.character.itemStacks, 'a rift spends no Hollow Gate key');
    assert.equal(saved?.character.lastHollowGateStart.requestId, 'rift-readiness-request-1');

    // A paid run remains recoverable even if the roster or saved deck changes.
    await kv.set(saveKey, {
        ...await kv.get<Record<string, unknown>>(saveKey),
        character: { ...(saved?.character ?? {}), pets: [], cardClashDeck: [] },
    });
    const replay = await postStart(playerName, 'rift-readiness-request-1');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.token, started.body?.token);
    assert.equal(await kv.get(countKey), 1);
});
