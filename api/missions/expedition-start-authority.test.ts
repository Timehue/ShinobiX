import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-start-authority-secret-32-bytes';

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

function request(playerName: string, body: Record<string, unknown>, address = '127.0.0.1') {
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: address },
    } as never;
}

async function post(playerName: string, body: Record<string, unknown>, address?: string): Promise<Out> {
    const { res, out } = response();
    await handler(request(playerName, body, address), res);
    return out;
}

async function seedPlayer(playerName: string, options: { allowance?: number; pets?: number; petLevel?: number; happiness?: number; inventory?: string[] } = {}) {
    const pets = Array.from({ length: options.pets ?? 1 }, (_, index) => ({
        id: `pet-${index + 1}`,
        name: `Pet ${index + 1}`,
        rarity: 'standard',
        level: options.petLevel ?? 30,
        maxLevel: 100,
        xp: 0,
        hp: 300,
        attack: 60,
        defense: 40,
        speed: 35,
        jutsus: [],
        happiness: options.happiness ?? 50,
    }));
    const today = new Date().toISOString().slice(0, 10);
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: {
            name: playerName,
            level: 30,
            profession: 'petTamer',
            pets,
            inventory: options.inventory ?? [],
            ...(options.allowance == null
                ? {}
                : { expeditionStartAllowance: { date: today, count: options.allowance } }),
        },
    });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./expedition-start.js')).default as unknown as Handler;
});

beforeEach((context) => {
    // seedPlayer stamps the allowance with the UTC day from a no-argument
    // `new Date()`, and so does the legacy counter in the migration test.
    // expedition-start reads its own day the same way. A run that straddles
    // UTC midnight would seed a day the handler no longer counts, so the cap
    // would not bite and every count would restart at 1. Freeze Date
    // (Date.now and new Date alike) for each test.
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('concurrent starts for one pet commit one lease and consume one daily allowance', async () => {
    const player = 'expeditionatomicrace';
    await seedPlayer(player, { allowance: 4, petLevel: 80 });
    const [first, second] = await Promise.all([
        post(player, { petId: 'pet-1', expType: 'scout', launchId: '00000000-0000-4000-8000-000000000101' }, '127.0.0.11'),
        post(player, { petId: 'pet-1', expType: 'forage', launchId: '00000000-0000-4000-8000-000000000102' }, '127.0.0.12'),
    ]);
    assert.deepEqual([first.statusCode, second.statusCode].sort((a, b) => a - b), [200, 409]);
    const success = first.statusCode === 200 ? first : second;
    const failed = first.statusCode === 409 ? first : second;
    assert.ok(success.body?.token);
    assert.match(String(failed.body?.error), /already busy/i);

    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    const allowance = character.expeditionStartAllowance as Record<string, unknown>;
    const pets = character.pets as Array<Record<string, unknown>>;
    const receipts = character.expeditionStartReceipts as Array<Record<string, unknown>>;
    assert.equal(allowance.count, 5, 'only the committed launch consumes allowance');
    assert.equal(save?._saveVersion, 2, 'only the committed launch writes the save');
    assert.equal(receipts.length, 1);
    assert.equal((pets[0].expedition as Record<string, unknown>).token, success.body?.token);
    assert.deepEqual(await kv.keys(`pet-exp-token:${player}:*`), [`pet-exp-token:${player}:${String(success.body?.token)}`]);
});

test('a companion escorting a Sunscar caravan cannot be sent on an expedition', async () => {
    const player = 'expeditioncaravanescort';
    await seedPlayer(player, { allowance: 0, petLevel: 80 });
    const save = (await kv.get<Record<string, unknown>>(`save:${player}`))!;
    const character = save.character as Record<string, unknown>;
    await kv.set(`save:${player}`, { ...save, character: { ...character, sunscarCaravan: { current: { selectedPetId: 'pet-1' } } } });

    const out = await post(player, { petId: 'pet-1', expType: 'scout', launchId: '00000000-0000-4000-8000-000000000151' }, '127.0.0.15');
    assert.equal(out.statusCode, 409, JSON.stringify(out.body));
    assert.match(String(out.body?.error), /caravan/);
    const after = (await kv.get<Record<string, unknown>>(`save:${player}`))!;
    assert.equal(((after.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0].expedition, undefined);
});

test('lost-response retry with the same launchId returns the exact launch without another write or charge', async () => {
    const player = 'expeditionlostresponse';
    await seedPlayer(player, { allowance: 7, petLevel: 80 });
    const body = {
        petId: 'pet-1',
        expType: 'ruins',
        launchId: '00000000-0000-4000-8000-000000000201',
        materialRewards: [{ itemId: 'hunt-legendary-material', count: 999 }],
    };
    const first = await post(player, body, '127.0.0.21');
    const replay = await post(player, body, '127.0.0.22');
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.token, first.body?.token);
    assert.equal(replay.body?.endsAt, first.body?.endsAt);
    const firstPet = ((first.body?.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
    const firstSeal = ((firstPet.expedition as Record<string, unknown>).serverSeal as Record<string, unknown>);
    const rewards = firstSeal.materialRewards as Array<{ itemId: string; count: number }>;
    assert.equal(rewards.reduce((total, reward) => total + reward.count, 0), 18, 'Ruins base haul with the fixed Tamer bonus');
    assert.ok(rewards.every(reward => reward.count > 0 && reward.count <= 18), 'request cannot inject a 999-item stack');
    assert.ok(Number(firstSeal.fateShardReward) >= 2 && Number(firstSeal.fateShardReward) <= 4);
    const replayPet = ((replay.body?.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
    assert.deepEqual((replayPet.expedition as Record<string, unknown>).serverSeal, firstSeal, 'lost response cannot reroll the supply haul');
    const cached = await kv.get<Record<string, unknown>>(`pet-exp-token:${player}:${String(first.body?.token)}`);
    assert.deepEqual(cached?.materialRewards, rewards, 'cache and durable seal carry the same rewards');
    assert.equal(cached?.fateShardReward, firstSeal.fateShardReward);

    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    assert.equal(save?._saveVersion, 2, 'replay does not bump the save again');
    assert.equal((character.expeditionStartAllowance as Record<string, unknown>).count, 8);
    assert.equal((character.expeditionStartReceipts as unknown[]).length, 1);
});

test('cap boundary allows one committed launch and a losing concurrent launch consumes nothing', async () => {
    const player = 'expeditioncapboundary';
    await seedPlayer(player, { allowance: 11, pets: 2 });
    const [first, second] = await Promise.all([
        post(player, { petId: 'pet-1', expType: 'scout', launchId: '00000000-0000-4000-8000-000000000301' }, '127.0.0.31'),
        post(player, { petId: 'pet-2', expType: 'scout', launchId: '00000000-0000-4000-8000-000000000302' }, '127.0.0.32'),
    ]);
    const launches = [first, second].filter((out) => out.body?.token);
    const capped = [first, second].filter((out) => out.body?.reason === 'daily-mint-cap');
    assert.equal(launches.length, 1);
    assert.equal(capped.length, 1);
    assert.equal(capped[0].statusCode, 200);

    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    const pets = character.pets as Array<Record<string, unknown>>;
    assert.equal((character.expeditionStartAllowance as Record<string, unknown>).count, 12);
    assert.equal((character.expeditionStartReceipts as unknown[]).length, 1);
    assert.equal(pets.filter((pet) => !!pet.expedition).length, 1);
    assert.equal(save?._saveVersion, 2);
});

test('an invalid retry id fails before any allowance or pet mutation', async () => {
    const player = 'expeditionbadlaunchid';
    await seedPlayer(player);
    const out = await post(player, { petId: 'pet-1', expType: 'scout', launchId: 'predictable-id' }, '127.0.0.41');
    assert.equal(out.statusCode, 400);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    assert.equal(save?._saveVersion, 1);
    assert.equal(character.expeditionStartAllowance, undefined);
    assert.equal((character.pets as Array<Record<string, unknown>>)[0].expedition, undefined);
});

test('deployment migration honors today\'s higher legacy KV allowance without writing it again', async () => {
    const player = 'expeditionlegacymigration';
    await seedPlayer(player, { allowance: 3 });
    const today = new Date().toISOString().slice(0, 10);
    const legacyKey = `pet-exp-start-count:${player}:${today}`;
    await kv.set(legacyKey, 9, { ex: 25 * 60 * 60 });
    const out = await post(player, {
        petId: 'pet-1', expType: 'scout',
        launchId: '00000000-0000-4000-8000-000000000401',
    }, '127.0.0.51');
    assert.equal(out.statusCode, 200);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    assert.equal((character.expeditionStartAllowance as Record<string, unknown>).count, 10);
    assert.equal(await kv.get(legacyKey), 9, 'new launches do not mutate the deprecated split counter');
});

test('the saved pet level is sealed even when a client submits a forged level', async () => {
    const player = 'expeditionlevelauthority';
    await seedPlayer(player, { petLevel: 30 });
    const out = await post(player, {
        petId: 'pet-1', expType: 'scout', petLevel: 100,
        launchId: '00000000-0000-4000-8000-000000000501',
    }, '127.0.0.61');
    assert.equal(out.statusCode, 200);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const pet = ((save?.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
    const seal = ((pet.expedition as Record<string, unknown>).serverSeal as Record<string, unknown>);
    assert.equal(seal.petLevel, 30);
});

test('a provision is consumed exactly once and replay keeps the sealed route setup', async () => {
    const player = 'expeditionprovisionreplay';
    await seedPlayer(player, { inventory: ['ancient-pet-treat'], petLevel: 50 });
    const body = {
        petId: 'pet-1', expType: 'forage', risk: 'bold', provision: 'ancient-pet-treat',
        launchId: '00000000-0000-4000-8000-000000000601',
    };
    const first = await post(player, body, '127.0.0.71');
    const replay = await post(player, body, '127.0.0.72');
    assert.equal(first.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    const pet = (character.pets as Array<Record<string, unknown>>)[0];
    const expedition = pet.expedition as Record<string, unknown>;
    assert.deepEqual(character.inventory, []);
    assert.equal(expedition.risk, 'bold');
    assert.equal(expedition.provision, 'ancient-pet-treat');
    assert.equal((expedition.serverSeal as Record<string, unknown>).petLevel, 50);
    assert.equal((character.expeditionStartAllowance as Record<string, unknown>).count, 1);
});

test('bold routes require enough saved happiness and consume no allowance on rejection', async () => {
    const player = 'expeditionboldhappiness';
    await seedPlayer(player, { happiness: 4 });
    const out = await post(player, {
        petId: 'pet-1', expType: 'scout', risk: 'bold',
        launchId: '00000000-0000-4000-8000-000000000701',
    }, '127.0.0.81');
    assert.equal(out.statusCode, 409);
    assert.match(String(out.body?.error), /at least 5 happiness/i);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save?.character as Record<string, unknown>;
    assert.equal(character.expeditionStartAllowance, undefined);
    assert.equal((character.pets as Array<Record<string, unknown>>)[0].expedition, undefined);
});

for (const [expType, level] of [['scout', 20], ['forage', 50], ['ruins', 80]] as const) {
    test(`${expType} requires actual saved pet level ${level} and accepts that exact level`, async () => {
        const player = `expeditionlevel${expType}`;
        await seedPlayer(player, { petLevel: level - 1 });
        const refused = await post(player, { petId: 'pet-1', expType, petLevel: 100 }, '127.0.0.101');
        assert.equal(refused.statusCode, 409);
        assert.match(String(refused.body?.error), new RegExp(`level ${level}`));
        const before = (await kv.get<Record<string, unknown>>(`save:${player}`))?.character as Record<string, unknown>;
        assert.equal(before.expeditionStartAllowance, undefined);
        await seedPlayer(player, { petLevel: level });
        assert.equal((await post(player, { petId: 'pet-1', expType }, '127.0.0.102')).statusCode, 200);
    });
}

test('a growing non-Tamer pet earns the base lane and a high-level pet can choose a lower route', async () => {
    const player = 'expeditionordinaryrewards';
    await seedPlayer(player, { petLevel: 25 });
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    (save!.character as Record<string, unknown>).profession = 'vanguard';
    await kv.set(`save:${player}`, save);
    const result = await post(player, { petId: 'pet-1', expType: 'scout' }, '127.0.0.103');
    assert.equal(result.statusCode, 200);
    const pet = ((result.body?.character as Record<string, unknown>).pets as Array<Record<string, unknown>>)[0];
    const seal = (pet.expedition as Record<string, unknown>).serverSeal as Record<string, unknown>;
    assert.equal(seal.rewardScale, 1);
    assert.equal(seal.ryoReward, 36, 'scout route ryo 180 x the 0.2 expedition ryo scale');
    assert.equal(seal.petXpReward, 120);
    assert.ok((seal.materialRewards as unknown[]).length > 0);
    await seedPlayer('expeditionhigherscout', { petLevel: 100 });
    assert.equal((await post('expeditionhigherscout', { petId: 'pet-1', expType: 'scout' }, '127.0.0.104')).statusCode, 200);
});
