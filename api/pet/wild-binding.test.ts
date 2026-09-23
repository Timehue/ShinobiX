import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wild-binding-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
const player = 'wildbindingtester';
const token = 'wildbindingtoken001';
const requestId = 'wildbindingrequest001';
const exploreId = 'wildbindingexplore001';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let wildHandler: Handler;
let befriendHandler: Handler;
let catalog: typeof import('./_catalog.js').PET_CATALOG;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_CATALOG: catalog } = await import('./_catalog.js'));
    wildHandler = (await import('./wild-binding.js')).default as unknown as Handler;
    befriendHandler = (await import('./befriend.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    const own = { ...structuredClone(catalog['standard-0']), id: 'owned-fox-001' };
    const wild = { ...structuredClone(catalog['standard-1']), id: 'standard-1-17500000' };
    await kv.set(`save:${player}`, {
        character: {
            name: player, level: 1, xp: 0, ryo: 100,
            pets: [own], itemStacks: [{ itemId: 'beast-seal-reinforced', count: 1 }],
            redeemedPetEncounters: [], redeemedSectorExplorations: [{ id: exploreId }],
        },
    });
    await kv.set(`pet-encounter-active:${player}`, {
        playerName: player, requestId, outcome: 'hit', token, pet: wild,
        battleRequired: true, sector: 1, mintedAt: Date.now(),
    });
    await kv.set(`pet-encounter:${player}:${token}`, {
        playerName: player, token, pet: wild, battleRequired: true,
        sector: 1, exploreReceiptId: exploreId, requestId, mintedAt: Date.now(),
    });
    await kv.set(`pet-encounter-request:${player}:${requestId}`, {
        version: 1, playerName: player, requestId, sector: 1,
        day: new Date().toISOString().slice(0, 10), mintedAt: Date.now(),
        token, pet: wild, battleRequired: true,
    });
});

async function post(handler: Handler, body: Json): Promise<{ status: number; body: Json }> {
    const output: { status: number; body: Json } = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { output.status = code; return res; },
        json: (value: Json) => { output.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', body: { playerName: player, token, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: '127.0.0.83' },
    } as never, res as never);
    return output;
}

describe('server-authoritative wild binding', { concurrency: false }, () => {
    it('requires battle for a newly rolled discovery and seals a single tutorial fight', async () => {
        const direct = await post(befriendHandler, {});
        assert.equal(direct.status, 409);
        assert.equal(direct.body.error, 'wild-battle-required');

        const first = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(first.status, 200);
        const firstWild = first.body.wild as Record<string, unknown>;
        assert.equal(firstWild.tutorial, true);
        assert.equal(firstWild.resolvePercent, 35);
        assert.equal((firstWild.seals as Array<Record<string, unknown>>)[1].available, true);
        const again = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal((again.body.state as Record<string, unknown>).sessionId, (first.body.state as Record<string, unknown>).sessionId);
    });

    it('guarantees the first bind and consumes the gifted seal exactly once across retries', async () => {
        assert.equal((await post(wildHandler, { action: 'start', petId: 'owned-fox-001' })).status, 200);
        const first = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'firstbindattempt001' });
        assert.equal(first.status, 200);
        assert.equal((first.body.capture as Record<string, unknown>).success, true);
        const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.deepEqual(saved.itemStacks, []);
        assert.equal((saved.pets as unknown[]).length, 2);
        assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
        assert.equal((await kv.get<Record<string, unknown>>(`pet-encounter-request:${player}:${requestId}`))?.resolution, 'befriended');

        const retry = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'firstbindattempt001' });
        assert.equal(retry.status, 200);
        assert.equal((retry.body.capture as Record<string, unknown>).replayed, true);
        assert.equal((retry.body.capture as Record<string, unknown>).destination, 'roster');
        assert.equal(((retry.body.capture as Record<string, unknown>).pet as Record<string, unknown>).id, 'standard-1-17500000');
        const replaySave = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.equal((replaySave.pets as unknown[]).length, 2);
        assert.deepEqual(replaySave.itemStacks, []);
    });

    it('lends a battle companion when a new character has no pets yet', async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...save, character: { ...(save?.character as Record<string, unknown>), pets: [] } });
        const started = await post(wildHandler, { action: 'start', petId: '' });
        assert.equal(started.status, 200);
        assert.equal(((started.body.state as Record<string, unknown>).player as Array<Record<string, unknown>>)[0].name, 'Guild Fox');
        assert.equal((started.body.wild as Record<string, unknown>).tutorial, true);
        const captured = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'loanerbindattempt001' });
        assert.equal((captured.body.capture as Record<string, unknown>).success, true);
        const stored = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.equal((stored.pets as unknown[]).length, 1, 'the captured pet becomes the first owned companion');
    });

    it('rejects capture above the seal threshold without spending it', async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...save, character: {
            ...(save?.character as Record<string, unknown>),
            redeemedPetEncounters: ['previous-wild-token'],
        } });
        const start = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(start.status, 200);
        assert.equal((start.body.wild as Record<string, unknown>).resolvePercent, 100);
        const attempt = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'earlybindattempt001' });
        assert.equal(attempt.status, 409);
        const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.deepEqual(saved.itemStacks, [{ itemId: 'beast-seal-reinforced', count: 1 }]);
    });

    it('advances the existing battle engine and lowers Resolve without granting a pet', async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...save, character: {
            ...(save?.character as Record<string, unknown>), redeemedPetEncounters: ['previous-wild-token'],
        } });
        const started = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(started.status, 200);
        const before = (started.body.wild as Record<string, unknown>).resolvePercent as number;
        const turned = await post(wildHandler, { action: 'turn', expectedRound: 0,
            commands: [{ kind: 'rest', petId: 'owned-fox-001' }] });
        assert.equal(turned.status, 200);
        assert.ok(((turned.body.state as Record<string, unknown>).round as number) > 0);
        assert.ok(((turned.body.wild as Record<string, unknown>).resolvePercent as number) < before);
        const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.equal((saved.pets as unknown[]).length, 1);
        assert.deepEqual(saved.itemStacks, [{ itemId: 'beast-seal-reinforced', count: 1 }]);
    });

    it('uses the sealed trait to shape Resolve during a real wild turn', async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...save, character: {
            ...(save?.character as Record<string, unknown>), redeemedPetEncounters: ['previous-wild-token'],
        } });
        const encounterKey = `pet-encounter:${player}:${token}`;
        const encounter = await kv.get<Record<string, unknown>>(encounterKey);
        const pet = { ...(encounter?.pet as Record<string, unknown>), trait: 'Loyal' };
        await kv.set(encounterKey, { ...encounter, pet });
        const started = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(started.status, 200);
        assert.equal((started.body.wild as Record<string, unknown>).trait, 'Loyal');
        assert.match(String((started.body.wild as Record<string, unknown>).traitHint), /Rest/);
        const turned = await post(wildHandler, { action: 'turn', expectedRound: 0,
            commands: [{ kind: 'rest', petId: 'owned-fox-001' }] });
        assert.equal(turned.status, 200);
        assert.equal((turned.body.wild as Record<string, unknown>).resolvePercent, 70);
    });
});
