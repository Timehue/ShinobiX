import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-report-authority-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;

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

async function post(playerName: string, body: Record<string, unknown>, address: string): Promise<Out> {
    const { res, out } = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: address },
    } as never, res);
    return out;
}

function expedition(token: string, now: number) {
    return {
        type: 'scout', token, startedAt: now - 2_700_000, endsAt: now - 1_000, durationMs: 2_700_000,
        risk: 'bold', provision: 'pet-treat', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow',
        serverSeal: {
            petLevel: 100, expRewardMult: 1, expMaterialMult: 1, rewardScale: 0.5, tamer: false,
            risk: 'bold', provision: 'pet-treat', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow', choiceVersion: 1,
            materialRewards: [{ itemId: 'hunt-beast-meat', count: 2 }, { itemId: 'gather-river-fish', count: 1 }],
        },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./report-pet-event.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('invalid-token recovery preserves a real active trip and its sealed haul', async () => {
    const player = 'expeditionrecoveryguard';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 30, ryo: 0,
        pets: [{ id: 'pet-1', name: 'Kumo', level: 20, maxLevel: 100, happiness: 80 }],
    } });
    const start = (await import('./expedition-start.js')).default as unknown as Handler;
    const { res, out } = response();
    await start({ method: 'POST', body: { playerName: player, petId: 'pet-1', expType: 'scout' },
        headers: { 'x-player-token': issuePlayerToken(player) ?? '' }, socket: { remoteAddress: '127.0.0.121' } } as never, res);
    assert.equal(out.statusCode, 200);
    const committed = await kv.get(`save:${player}`);
    const { sanitizeCharacterSave } = await import('../save/[name].js');
    const forged = structuredClone(committed) as Record<string, unknown>;
    const forgedChar = forged.character as Record<string, unknown>;
    const forgedPet = (forgedChar.pets as Array<Record<string, unknown>>)[0];
    (forgedPet.expedition as Record<string, unknown>).serverSeal = { materialRewards: [{ itemId: 'hunt-legendary-material', count: 999 }], fateShardReward: 999 };
    forgedChar.expeditionStartAllowance = { date: '2000-01-01', count: 0 };
    const sanitized = sanitizeCharacterSave(forged, committed as Record<string, unknown>);
    const committedChar = (committed as Record<string, unknown>).character as Record<string, unknown>;
    assert.deepEqual((sanitized.character as Record<string, unknown>).pets, committedChar.pets, 'ordinary saves cannot alter the sealed haul');
    assert.deepEqual((sanitized.character as Record<string, unknown>).expeditionStartAllowance, committedChar.expeditionStartAllowance);
    for (const token of [undefined, 'STALETOKEN']) {
        const result = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token }, '127.0.0.122');
        assert.equal(result.statusCode, 200);
        assert.equal(result.body?.ryoEarned, 0);
        assert.deepEqual(await kv.get(`save:${player}`), committed, 'recovery cannot remove the trip or reroll its materials');
    }
});

test('a legacy trip with a valid cached seal is preserved when durable recovery is unavailable', async () => {
    const player = 'expeditionlegacycacheguard';
    const token = 'LEGACYCACHED';
    const now = Date.now();
    const trip = expedition(token, now);
    delete (trip as Record<string, unknown>).serverSeal;
    const seeded = { _saveVersion: 1, character: { name: player, level: 30, ryo: 0,
        pets: [{ id: 'pet-1', level: 20, maxLevel: 100, expedition: trip }] } };
    await kv.set(`save:${player}`, seeded);
    await kv.set(`pet-exp-token:${player}:${token}`, { playerName: player, petId: 'pet-1',
        expType: 'scout', durationMinutes: 45, endsAt: trip.endsAt, petLevel: 20, tamer: false, rewardScale: 0 });
    const result = await post(player, { event: 'expedition', petId: 'pet-1' }, '127.0.0.123');
    assert.equal(result.statusCode, 200);
    assert.deepEqual(await kv.get(`save:${player}`), seeded);
});

for (const capacity of ['quantity', 'keys'] as const) {
    test(`a full material inventory (${capacity}) preserves the complete haul until room is available`, async () => {
        const player = `expeditioncapacity${capacity}`;
        const token = `capacity${capacity}`;
        const now = Date.now();
        const itemStacks = capacity === 'quantity' ? [{ itemId: 'hunt-beast-meat', count: 9999 }]
            : Array.from({ length: 200 }, (_, index) => ({ itemId: `held-${index}`, count: 1 }));
        const seeded = { _saveVersion: 1, character: { name: player, level: 30, ryo: 100,
            itemStacks, pets: [{ id: 'pet-1', level: 100, maxLevel: 100, happiness: 80, expedition: expedition(token, now) }] } };
        await kv.set(`save:${player}`, seeded);
        const blocked = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token }, '127.0.0.124');
        assert.equal(blocked.statusCode, 409);
        assert.match(String(blocked.body?.error), /room/i);
        assert.deepEqual(await kv.get(`save:${player}`), seeded, 'no currency, happiness, materials, receipt, or lease changes');

        const withRoom = structuredClone(seeded);
        withRoom.character.itemStacks = capacity === 'quantity' ? [{ itemId: 'hunt-beast-meat', count: 9997 }] : itemStacks.slice(2);
        await kv.set(`save:${player}`, withRoom);
        const collected = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token }, '127.0.0.124');
        assert.equal(collected.statusCode, 200);
        assert.deepEqual(collected.body?.materialRewards, expedition(token, now).serverSeal.materialRewards);
        const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        const stacks = saved.itemStacks as Array<{ itemId: string; count: number }>;
        assert.ok(stacks.length <= 200);
        assert.ok(stacks.every(stack => stack.count <= 9999));
        const replay = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token }, '127.0.0.124');
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual((replay.body?.character as Record<string, unknown>).itemStacks, stacks);
    });
}

test('return settlement uses the sealed setup, records world story, charges bold happiness, and replays exactly', async () => {
    const player = 'expeditionreturnauthority';
    const token = 'returnauthority001';
    const now = Date.now();
    await kv.set(`save:${player}`, {
        _saveVersion: 1,
        character: {
            name: player, level: 30, ryo: 0, boneCharms: 0, auraStones: 0, fateShards: 0,
            pets: [{
                id: 'pet-1', name: 'Kumo', rarity: 'standard', level: 100, maxLevel: 100, xp: 0,
                hp: 300, attack: 60, defense: 40, speed: 35, happiness: 50, jutsus: [], expedition: expedition(token, now),
            }],
        },
    });

    const first = await post(player, {
        event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'secure',
        petLevel: 1, durationMinutes: 1, expType: 'ruins',
        materialRewards: [{ itemId: 'hunt-legendary-material', count: 999 }],
    }, '127.0.0.91');
    assert.equal(first.statusCode, 200);
    assert.equal(first.body?.ryoEarned, 404, 'saved level 100 + sealed scout/bold/half-rate determine ryo');
    assert.equal(first.body?.happinessCost, 5);
    assert.match(String(first.body?.story), /Moongrotto/);
    const firstCharacter = first.body?.character as Record<string, unknown>;
    const firstPet = (firstCharacter.pets as Array<Record<string, unknown>>)[0];
    assert.equal(firstPet.expedition, undefined);
    assert.equal(firstPet.happiness, 45);
    const log = firstCharacter.petExpeditionLog as Array<Record<string, unknown>>;
    assert.equal(log.length, 1);
    assert.equal(log[0].risk, 'bold');
    assert.equal(log[0].provision, 'pet-treat');
    assert.equal(log[0].place, 'Moongrotto');
    assert.deepEqual(first.body?.materialRewards, expedition(token, now).serverSeal.materialRewards);
    assert.deepEqual(firstCharacter.itemStacks, [{ itemId: 'hunt-beast-meat', count: 2 }, { itemId: 'gather-river-fish', count: 1 }]);
    assert.deepEqual(log[0].materialRewards, first.body?.materialRewards);

    const replay = await post(player, {
        event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'investigate',
    }, '127.0.0.92');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.ryoEarned, first.body?.ryoEarned);
    assert.equal(replay.body?.story, first.body?.story);
    const replayCharacter = replay.body?.character as Record<string, unknown>;
    assert.equal(replayCharacter.ryo, firstCharacter.ryo, 'replay cannot pay twice');
    assert.deepEqual(replay.body?.materialRewards, first.body?.materialRewards, 'replay returns the original material receipt');
    assert.deepEqual(replayCharacter.itemStacks, firstCharacter.itemStacks, 'replay cannot duplicate supplies or change its return choice');
});

test('claim cap leaves the completed lease ready and rejects invalid choices', async (t) => {
    // The seeded claim date and the handler's own day both come from
    // Date.now(), read at different moments. A run that straddles UTC
    // midnight would seed a day the handler no longer counts, so the claim
    // would pay out instead of hitting the cap. Freeze Date for the check.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'expeditionclaimcap';
    const token = 'claimcap001';
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    await kv.set(`save:${player}`, {
        _saveVersion: 1,
        character: {
            name: player, level: 30, ryo: 0, lastExpeditionClaimDate: today, expeditionsClaimedToday: 12,
            pets: [{ id: 'pet-1', name: 'Mori', level: 100, maxLevel: 100, happiness: 50, expedition: expedition(token, now) }],
        },
    });
    const capped = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'secure' }, '127.0.0.93');
    assert.equal(capped.statusCode, 200);
    assert.equal(capped.body?.reason, 'daily-expedition-cap');
    assert.deepEqual(capped.body?.materialRewards, []);
    const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
    const pet = (((saved?.character as Record<string, unknown>).pets) as Array<Record<string, unknown>>)[0];
    assert.equal((pet.expedition as Record<string, unknown>).token, token, 'capped claim remains collectable tomorrow');
    assert.equal((saved?.character as Record<string, unknown>).itemStacks, undefined, 'a capped claim grants no materials');

    const invalid = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'gamble' }, '127.0.0.94');
    assert.equal(invalid.statusCode, 400);
    assert.match(String(invalid.body?.error), /return choice/i);
});

test('a real mixed expedition survives cache loss, pays supplies once under concurrent claims, and grants no gathering XP', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'expeditionminingsupplies';
    await kv.set(`save:${player}`, {
        _saveVersion: 1, currentSector: 27,
        character: {
            name: player, level: 30, ryo: 0, inventory: [], itemStacks: [{ itemId: 'gather-iron-sand', count: 3 }],
            resourceGathering: { fishingXp: 0, miningXp: 0 },
            pets: [{ id: 'pet-1', name: 'Kumo', rarity: 'standard', level: 80, maxLevel: 100, xp: 0, happiness: 80 }],
        },
    });
    const start = (await import('./expedition-start.js')).default as unknown as Handler;
    const { res, out } = response();
    await start({ method: 'POST', body: { playerName: player, petId: 'pet-1', expType: 'ruins' },
        headers: { 'x-player-token': issuePlayerToken(player) ?? '' }, socket: { remoteAddress: '127.0.0.95' } } as never, res);
    assert.equal(out.statusCode, 200);
    const token = String(out.body?.token);
    const launched = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
    const launchedSeal = ((launched.pets as Array<Record<string, unknown>>)[0].expedition as Record<string, unknown>).serverSeal as Record<string, unknown>;
    const sealedHaul = launchedSeal.materialRewards as Array<{ itemId: string; count: number }>;
    assert.equal(sealedHaul.reduce((sum, item) => sum + item.count, 0), 12);
    const sealedFate = Number(launchedSeal.fateShardReward);
    assert.ok(sealedFate >= 2 && sealedFate <= 4);
    const premature = await post(player, { event: 'expedition', expeditionToken: token }, '127.0.0.96');
    assert.equal(premature.body?.reason, 'expedition-not-complete');
    assert.deepEqual(premature.body?.materialRewards, []);

    await kv.del(`pet-exp-token:${player}:${token}`);
    t.mock.timers.tick(4 * 60 * 60_000 + 1);
    // Force a Fate find; its sealed amount must survive cache loss and replay.
    t.mock.method(Math, 'random', () => 0);
    const claims = await Promise.all([
        post(player, { event: 'expedition', expeditionToken: token, returnChoice: 'secure', fateShardReward: 999, foundFate: 999 }, '127.0.0.97'),
        post(player, { event: 'expedition', expeditionToken: token, returnChoice: 'secure' }, '127.0.0.98'),
    ]);
    for (const claim of claims) {
        assert.equal(claim.statusCode, 200);
        assert.equal(claim.body?.ryoEarned, 2160, 'a growing non-Tamer earns the full base ryo lane');
        assert.equal(claim.body?.petXpEarned, 1280);
        assert.deepEqual(claim.body?.materialRewards, sealedHaul);
        assert.equal(claim.body?.foundFate, sealedFate);
    }
    const saved = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
    const expected = new Map([['gather-iron-sand', 3]]);
    for (const reward of sealedHaul) expected.set(reward.itemId, (expected.get(reward.itemId) ?? 0) + reward.count);
    assert.deepEqual(new Map((saved.itemStacks as Array<{ itemId: string; count: number }>).map(item => [item.itemId, item.count])), expected);
    assert.equal(saved.fateShards, sealedFate, 'the concurrent claim cannot double the shard payout');
    const { countOwned, consumeRecipeIngredients } = await import('../craft/_forge.js');
    for (const reward of sealedHaul) {
        const consumed = consumeRecipeIngredients(saved, [{ ids: [reward.itemId], count: 1, label: reward.itemId }]);
        assert.ok(consumed, `${reward.itemId} can be consumed by the existing crafting ingredient resolver`);
        assert.equal(countOwned(consumed, reward.itemId), countOwned(saved, reward.itemId) - 1);
    }
    assert.deepEqual(saved.resourceGathering, { fishingXp: 0, miningXp: 0 });
    assert.equal((saved.petExpeditionLog as unknown[]).length, 1);
});

test('new Tamer collections pay the fixed bonus on both the first and later expeditions', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'expeditionfixedtamer';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 30, profession: 'petTamer', professionRank: 10, professionXp: 32850, ryo: 0,
        pets: ['pet-1', 'pet-2'].map(id => ({ id, name: id, rarity: 'standard', level: 20, maxLevel: 100, xp: 0,
            hp: 300, attack: 60, defense: 40, speed: 35, happiness: 80, jutsus: [] })),
    } });
    const start = (await import('./expedition-start.js')).default as unknown as Handler;
    const tokens: string[] = [];
    for (const petId of ['pet-1', 'pet-2']) {
        const { res, out } = response();
        await start({ method: 'POST', body: { playerName: player, petId, expType: 'scout' },
            headers: { 'x-player-token': issuePlayerToken(player) ?? '' }, socket: { remoteAddress: '127.0.0.111' } } as never, res);
        assert.equal(out.statusCode, 200);
        tokens.push(String(out.body?.token));
    }
    t.mock.timers.tick(45 * 60_000 + 1);
    t.mock.method(Math, 'random', () => 0);
    for (const token of tokens) {
        const cache = await kv.get<Record<string, unknown>>(`pet-exp-token:${player}:${token}`);
        const result = await post(player, { event: 'expedition', expeditionToken: token }, '127.0.0.112');
        assert.equal(result.statusCode, 200);
        assert.equal(result.body?.ryoEarned, 270, '180 base ryo times the fixed 1.5 profession bonus');
        assert.equal(result.body?.petXpEarned, 180, '120 base pet XP times the fixed 1.5 profession bonus');
        assert.equal(result.body?.firstExpedition, false);
        assert.equal(result.body?.foundFate, cache?.fateShardReward, 'cached claims use the same sealed shard amount');
    }
});
