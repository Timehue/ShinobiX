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
let purchaseHandler: Handler;
let declineHandler: Handler;
let catalog: typeof import('./_catalog.js').PET_CATALOG;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ PET_CATALOG: catalog } = await import('./_catalog.js'));
    wildHandler = (await import('./wild-binding.js')).default as unknown as Handler;
    befriendHandler = (await import('./befriend.js')).default as unknown as Handler;
    purchaseHandler = (await import('../shop/purchase.js')).default as unknown as Handler;
    declineHandler = (await import('./encounter-decline.js')).default as unknown as Handler;
});

/** Capture the discovery's pet, but fail the discovery close once, the way a
 * lock timeout or a restart after the battle saved would. */
async function captureWithFailedDiscoveryClose(attemptId: string) {
    assert.equal((await post(wildHandler, { action: 'start', petId: 'owned-fox-001' })).status, 200);
    const realDel = kv.del.bind(kv);
    let failed = false;
    kv.del = (async (...keys: string[]) => {
        if (!failed && keys.includes(`pet-encounter:${player}:${token}`)) {
            failed = true;
            throw new Error('simulated storage failure');
        }
        return realDel(...keys);
    }) as typeof kv.del;
    try {
        const captured = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId });
        assert.equal(captured.status, 500, 'the close failure surfaces as an error');
    } finally {
        kv.del = realDel;
    }
    assert.equal(failed, true);
    const battle = await kv.get<Record<string, unknown>>(`pet:wild-binding:${player}:${token}`);
    assert.equal(battle?.finished, true, 'the capture itself committed');
    assert.ok(await kv.get(`pet-encounter-active:${player}`), 'the discovery is still open and blocking Explore');
}

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

async function post(handler: Handler, body: Json, headers: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
    const output: { status: number; body: Json } = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { output.status = code; return res; },
        json: (value: Json) => { output.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', body: { playerName: player, token, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player), ...headers },
        socket: { remoteAddress: '127.0.0.83' },
    } as never, res as never);
    return output;
}

describe('server-authoritative wild binding', { concurrency: false }, () => {
    it('connects a freshly minted discovery to a scaled battle and level-1 capture', async () => {
        const startEncounter = (await import('./encounter-start.js')).default as unknown as Handler;
        const { onlineStore } = await import('../_realtime/online-store.js');
        const priorAdmin = process.env.ADMIN_PASSWORD;
        process.env.ADMIN_PASSWORD = 'wild-binding-discovery-qa';
        onlineStore.upsert({ name: player, sector: 65, character: { level: 1 }, tile: 5 });
        try {
            await kv.del(`pet-encounter-active:${player}`, `pet-encounter:${player}:${token}`,
                `pet-encounter-request:${player}:${requestId}`);
            const save = (await kv.get<{ character: { pets: Json[] } }>(`save:${player}`))!;
            save.character.pets[0].level = 50;
            await kv.set(`save:${player}`, save);
            const found = await post(startEncounter, { requestId, sector: 65 },
                { 'x-qa-wild-hit': process.env.ADMIN_PASSWORD });
            assert.equal(found.status, 200, JSON.stringify(found.body));
            assert.equal((found.body.pet as Json).level, 1, 'discovery retains the unscaled species baseline');
            const freshToken = String(found.body.token);
            const encounterKey = `pet-encounter:${player}:${freshToken}`;
            const encounter = (await kv.get<Json>(encounterKey))!;
            assert.equal(encounter.battleRequired, true);
            // Simulate Explore settlement using the receipt already in the saved character.
            await kv.set(encounterKey, { ...encounter, exploreReceiptId: exploreId });
            const started = await post(wildHandler, { action: 'start', token: freshToken, petId: 'owned-fox-001' });
            assert.equal(started.status, 200, JSON.stringify(started.body));
            const level = Number((started.body.state as { enemy: Json[] }).enemy[0].level);
            assert.ok(level >= 30 && level <= 50);
            const captured = await post(wildHandler, { action: 'capture', token: freshToken,
                sealId: 'beast-seal-reinforced', attemptId: 'freshdiscoverycapture01' });
            assert.equal(captured.status, 200, JSON.stringify(captured.body));
            assert.equal((captured.body.capture as { pet: Json }).pet.level, 1);
            assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
        } finally {
            onlineStore.remove(player);
            if (priorAdmin === undefined) delete process.env.ADMIN_PASSWORD;
            else process.env.ADMIN_PASSWORD = priorAdmin;
        }
    });

    it('stores a scaled wild capture in Sanctuary at level 1 and returns that same pet on retry', async () => {
        const { getPetFromSanctuary, listPetSanctuary } = await import('./_sanctuary.js');
        const save = (await kv.get<{ character: { pets: Json[] } }>(`save:${player}`))!;
        save.character.pets = Array.from({ length: 5 }, (_, index) => ({
            ...structuredClone(catalog['standard-0']), id: `full-roster-${index}`, level: 100,
        }));
        await kv.set(`save:${player}`, save);
        const started = await post(wildHandler, { action: 'start', petId: 'full-roster-0' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.ok(Number((started.body.state as { enemy: Json[] }).enemy[0].level) >= 80);
        const body = { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'sanctuarycapture001' };
        const captured = await post(wildHandler, body);
        assert.equal(captured.status, 200, JSON.stringify(captured.body));
        const capture = captured.body.capture as { pet: Json; destination: string };
        assert.equal(capture.destination, 'sanctuary');
        assert.equal(capture.pet.level, 1);
        assert.equal(capture.pet.xp, 0);
        assert.equal(capture.pet.growthPoints, 0);
        const stored = await getPetFromSanctuary(player, String(capture.pet.id));
        assert.deepEqual(stored?.pet, capture.pet);
        const retry = await post(wildHandler, body);
        assert.equal(retry.status, 200);
        assert.deepEqual((retry.body.capture as { pet: Json }).pet, capture.pet);
        assert.equal((await listPetSanctuary(player)).total, 1);
        const after = (await kv.get<typeof save>(`save:${player}`))!;
        assert.equal(after.character.pets.length, 5);
        assert.ok(after.character.pets.every((pet) => pet.level === 100));
    });

    it('scales to the selected companion, seals the roll across retries, and captures at level 1', async () => {
        const save = (await kv.get<{ character: { level: number; pets: Json[] } }>(`save:${player}`))!;
        save.character.pets.push({ ...structuredClone(catalog['standard-0']), id: 'high-level-fox', level: 100 });
        await kv.set(`save:${player}`, save);
        const started = await post(wildHandler, { action: 'start', petId: 'high-level-fox', level: 1 });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const enemy = (started.body.state as { enemy: Json[] }).enemy[0];
        const level = Number(enemy.level);
        assert.ok(level >= 80 && level <= 100, `unexpected wild level ${level}`);

        const session = (await kv.get<{ enemy: Json[]; wild: { pet: Json } }>(`pet:wild-binding:${player}:${token}`))!;
        assert.equal(session.wild.pet.level, level);
        assert.ok(Number(enemy.maxHp) > Number(catalog['standard-1'].hp), 'wild combat health grows with its level');
        const reopened = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(reopened.status, 200);
        assert.deepEqual(reopened.body.state, started.body.state, 'changing the selected pet cannot reroll an existing battle');

        const weakened = await post(wildHandler, { action: 'turn', expectedRound: 0,
            commands: [{ kind: 'move', petId: 'high-level-fox', moveIndex: 0 }] });
        assert.equal(weakened.status, 200, JSON.stringify(weakened.body));
        const wounded = (weakened.body.state as { enemy: Json[] }).enemy[0];
        assert.ok(Number(wounded.hp) > 0, 'the leveled wild pet survives a basic attack');
        assert.ok(Number(wounded.hp) < Number(wounded.maxHp), 'the companion can weaken it for capture');

        const captured = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'leveledcapture001' });
        assert.equal(captured.status, 200, JSON.stringify(captured.body));
        const reward = (captured.body.capture as { pet: Json }).pet;
        assert.equal(reward.level, 1);
        assert.equal(reward.xp, 0);
        assert.equal(reward.growthPoints, 0);
        const saved = (await kv.get<{ character: { pets: Json[] } }>(`save:${player}`))!;
        assert.equal(saved.character.pets.find((pet) => pet.id === reward.id)?.level, 1);
        const retry = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'leveledcapture001' });
        assert.equal((retry.body.capture as { pet: Json }).pet.level, 1);
    });

    it('lets a training companion enter and leave a wild battle without changing its training', async () => {
        const save = (await kv.get<{ character: { pets: Json[] } }>(`save:${player}`))!;
        const training = { type: 'strength', endsAt: Date.now() + 60_000, sealedXp: 30 };
        save.character.pets[0].training = training;
        await kv.set(`save:${player}`, save);
        const started = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal((await post(wildHandler, { action: 'forfeit' })).status, 200);
        const after = (await kv.get<typeof save>(`save:${player}`))!;
        assert.deepEqual(after.character.pets[0].training, training);
    });

    it('keeps expedition companions out of wild battles without consuming the encounter', async () => {
        const save = (await kv.get<{ character: { pets: Json[] } }>(`save:${player}`))!;
        save.character.pets[0].expedition = { endsAt: Date.now() + 60_000 };
        await kv.set(`save:${player}`, save);
        const started = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(started.status, 409);
        assert.match(String(started.body.error), /expedition/);
        assert.equal(await kv.get(`pet:wild-binding:${player}:${token}`), null);
        assert.ok(await kv.get(`pet-encounter-active:${player}`));
    });

    it('carries a bulk shop purchase into the encounter and spends one seal on capture', async () => {
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...save, character: { ...(save?.character as Record<string, unknown>), ryo: 2500 } });
        const purchase = { itemId: 'beast-seal-reinforced', qty: 9, requestId: 'bulksealpurchase001' };
        const bought = await post(purchaseHandler, purchase);
        assert.equal(bought.status, 200);
        assert.equal(((bought.body.purchase as Record<string, unknown>).qty), 9);
        assert.deepEqual((bought.body.character as Record<string, unknown>).itemStacks,
            [{ itemId: 'beast-seal-reinforced', count: 10 }]);
        const replay = await post(purchaseHandler, purchase);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.replayed, true);

        assert.equal((await post(wildHandler, { action: 'start', petId: 'owned-fox-001' })).status, 200);
        const captured = await post(wildHandler, { action: 'capture', sealId: 'beast-seal-reinforced', attemptId: 'bulkbindattempt001' });
        assert.equal(captured.status, 200);
        assert.equal((captured.body.capture as Record<string, unknown>).success, true);
        assert.deepEqual((captured.body.character as Record<string, unknown>).itemStacks,
            [{ itemId: 'beast-seal-reinforced', count: 9 }]);
        const stored = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.deepEqual(stored.itemStacks, [{ itemId: 'beast-seal-reinforced', count: 9 }]);
    });

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
        assert.equal((started.body.state as { enemy: Json[] }).enemy[0].level, 1);
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

    it('closes a finished battle\'s discovery when the battle is reopened', async () => {
        await captureWithFailedDiscoveryClose('reopenclosesdiscovery01');
        const reopened = await post(wildHandler, { action: 'start', petId: 'owned-fox-001' });
        assert.equal(reopened.status, 200);
        assert.equal((reopened.body.state as Record<string, unknown>).finished, true);
        assert.equal(await kv.get(`pet-encounter-active:${player}`), null, 'Explore is free again');
        assert.equal(await kv.get(`pet-encounter:${player}:${token}`), null);
        assert.equal((await kv.get<Record<string, unknown>>(`pet-encounter-request:${player}:${requestId}`))?.resolution, 'befriended');
        const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.equal((saved.pets as unknown[]).length, 2, 'the captured pet is kept exactly once');
    });

    it('lets the player leave the trail after a finished battle and records its real outcome', async () => {
        await captureWithFailedDiscoveryClose('leavetrailafterbattle01');
        const left = await post(declineHandler, {});
        assert.equal(left.status, 200);
        assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
        assert.equal((await kv.get<Record<string, unknown>>(`pet-encounter-request:${player}:${requestId}`))?.resolution, 'befriended');
        const replay = await post(declineHandler, {});
        assert.equal(replay.status, 200);
        assert.equal(replay.body.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>(`pet-encounter-request:${player}:${requestId}`))?.resolution, 'befriended',
            'a replayed leave keeps the recorded outcome');
    });

    it('still refuses to leave the trail while the wild battle is in progress', async () => {
        assert.equal((await post(wildHandler, { action: 'start', petId: 'owned-fox-001' })).status, 200);
        const left = await post(declineHandler, {});
        assert.equal(left.status, 409);
        assert.ok(await kv.get(`pet-encounter-active:${player}`));
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
