import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';
import { runtimeModeById } from '../../shared/runtime-mode-registry.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coliseum-single-owner-test-secret-32';
process.env.ENABLE_LEGACY = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
let startHandler: Handler;
let resultHandler: Handler;
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

function request(body: Record<string, unknown>, authToken: string, remoteAddress: string) {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress },
    } as never;
}

function battlePet(id: string, strength: 'strong' | 'weak' = 'strong') {
    const dominant = strength === 'strong';
    return {
        id,
        name: dominant ? 'Guardian' : 'Sparrow',
        rarity: 'standard',
        level: 20,
        xp: 0,
        maxLevel: 100,
        hp: dominant ? 100_000 : 1,
        attack: dominant ? 10_000 : 1,
        defense: dominant ? 10_000 : 0,
        speed: dominant ? 1_000 : 1,
        jutsus: [{ name: dominant ? 'Verdict' : 'Peck', power: dominant ? 1_000 : 1, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true,
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    startHandler = (await import('./battle-start.js')).default as unknown as Handler;
    resultHandler = (await import('./battle-result.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_LEGACY;
});

test('the product surface and registry expose Showdown as the sole paid Pet Coliseum entry', () => {
    const arenaSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'PetArena.tsx'), 'utf8');
    const startSource = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-start.ts'), 'utf8');

    assert.doesNotMatch(arenaSource, /setOpponentMode\("ai"\)|opponentMode === "ai"|Choose both contenders/);
    assert.match(arenaSource, /setScreen\("petColiseum"\)/);
    assert.match(arenaSource, /Paid Colosseum bouts use the server-owned Showdown/);
    assert.match(startSource, /pick-your-opponent Pet Colosseum is retired/);

    const paid = runtimeModeById('pet-coliseum');
    assert.equal(paid?.authorityEngine, 'pet-showdown');
    assert.equal(paid?.rewardPolicy, 'server-capped');
    for (const id of ['pet-arena-ai-1v1', 'pet-arena-ai-2v2']) {
        const retired = runtimeModeById(id);
        assert.equal(retired?.authorityEngine, null);
        assert.equal(retired?.status, 'surface-gap');
        assert.equal(retired?.rewardPolicy, 'none');
        assert.deepEqual(retired?.routes, []);
    }
});

test('new generic-AI admission is rejected without publishing a battle proof', async () => {
    const playerName = 'closedlegacyai';
    const authToken = issuePlayerToken(playerName)!;
    const pet = battlePet('closed-pet');
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: { name: playerName, level: 20, ryo: 0, pets: [pet] },
    });

    const rejected = response();
    await startHandler(request({
        playerName,
        mode: '1v1',
        playerPetIds: [pet.id],
        opponentPetIds: ['generic-ai-pet-sparrow'],
    }, authToken, '198.51.100.10'), rejected.res);

    assert.equal(rejected.out.statusCode, 410);
    assert.equal(await kv.get(`pet:battle-active:${playerName}`), null);
});

test('new real-player cinematic sparring settles its sealed win without paid progression', async () => {
    const playerName = 'casualpolicywinner';
    const opponentName = 'casualpolicytarget';
    const authToken = issuePlayerToken(playerName)!;
    const pet = battlePet('casual-winner', 'strong');
    const opponentPet = battlePet('casual-target', 'weak');
    await Promise.all([
        kv.set(`save:${playerName}`, {
            _saveVersion: 1,
            character: {
                name: playerName, level: 20, ryo: 17, totalPetWins: 8, dailyPetWins: 3,
                lastDailyReset: new Date().toISOString().slice(0, 10), starterCardsClaimed: true,
                tileCards: [], pets: [pet],
            },
        }),
        kv.set(`save:${opponentName}`, {
            _saveVersion: 1,
            character: { name: opponentName, level: 20, ryo: 0, pets: [opponentPet] },
        }),
    ]);

    const started = response();
    await startHandler(request({
        playerName,
        opponentName,
        mode: '1v1',
        playerPetIds: [pet.id],
        opponentPetIds: [opponentPet.id],
    }, authToken, '198.51.100.20'), started.res);
    assert.equal(started.out.statusCode, 200);

    const battleToken = String(started.out.body?.token ?? '');
    const token = await kv.get<Record<string, unknown>>(`pet:battle-token:${playerName}:${battleToken}`);
    assert.equal(token?.settlementPolicy, 'casual-no-progression');
    assert.equal(token?.authoritativeOutcome, 'win', 'the fixture must exercise the win branch');

    const settled = response();
    await resultHandler(request({
        playerName,
        outcome: 'loss',
        reportKey: started.out.body?.reportKey,
        battleToken,
    }, authToken, '198.51.100.21'), settled.res);

    assert.equal(settled.out.statusCode, 200);
    assert.equal(settled.out.body?.outcome, 'win');
    assert.equal(settled.out.body?.reason, 'casual-sparring');
    assert.equal(settled.out.body?.reward, 0);
    assert.equal(settled.out.body?.totalPetWins, 8);
    assert.equal(settled.out.body?.dailyPetWins, 3);
    assert.deepEqual(settled.out.body?.chronicleCards, []);
    assert.deepEqual(settled.out.body?.witnessedPets, []);
    assert.deepEqual(settled.out.body?.livingWitnessProgress, []);
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const character = save?.character as Record<string, unknown>;
    assert.equal(character.ryo, 17);
    assert.equal(character.totalPetWins, 8);
    assert.equal(character.dailyPetWins, 3);
    assert.equal(await kv.get(`legacy:stats:${playerName}`), null);
});

test('a pre-cutover win at the cap cannot farm counters, witness deeds, or Legacy on report or replay', async () => {
    const playerName = 'legacycapclosed';
    const authToken = issuePlayerToken(playerName)!;
    const pet = { ...battlePet('cap-pet'), element: 'Water', nickname: 'Cap Mizu', chronicleArenaWins: 9 };
    const today = new Date().toISOString().slice(0, 10);
    const battleToken = 'LegacyCappedReceipt01';
    const reportKey = `pet:${battleToken}`;
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        character: {
            name: playerName, level: 20, ryo: 90, totalPetWins: 44,
            dailyPetWins: SHOWDOWN_DAILY_WIN_CAP, lastDailyReset: today,
            starterCardsClaimed: true, tileCards: [], pets: [pet],
        },
    });
    await Promise.all([
        kv.set(`pet:battle-token:${playerName}:${battleToken}`, {
            playerName,
            reportKey,
            opponentLevel: 20,
            rewardRyo: 40,
            playerPetIds: [pet.id],
            opponentPetIds: ['retired-opponent'],
            authoritativeOutcome: 'win',
            mode: '1v1',
            // No policy is the supported already-issued compatibility shape.
        }, { ex: 15 * 60 }),
        kv.set(`pet:battle-active:${playerName}`, battleToken, { ex: 15 * 60 }),
    ]);

    const settled = response();
    await resultHandler(request({ playerName, outcome: 'win', reportKey, battleToken }, authToken, '198.51.100.30'), settled.res);
    assert.equal(settled.out.statusCode, 200);
    assert.equal(settled.out.body?.capped, true);
    assert.equal(settled.out.body?.reward, 0);
    assert.equal(settled.out.body?.totalPetWins, 44);
    assert.equal(settled.out.body?.dailyPetWins, SHOWDOWN_DAILY_WIN_CAP);
    assert.deepEqual(settled.out.body?.chronicleCards, []);
    assert.deepEqual(settled.out.body?.witnessedPets, []);
    assert.deepEqual(settled.out.body?.livingWitnessProgress, []);

    const afterFirst = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const firstCharacter = afterFirst?.character as Record<string, unknown>;
    const firstPet = (firstCharacter.pets as Array<Record<string, unknown>>)[0];
    assert.equal(firstCharacter.ryo, 90);
    assert.equal(firstCharacter.totalPetWins, 44);
    assert.equal(firstPet.chronicleArenaWins, 9);
    assert.deepEqual(firstCharacter.tileCards, []);
    assert.equal(await kv.get(`legacy:stats:${playerName}`), null);

    const realNow = Date.now;
    Date.now = () => realNow() + 6_000;
    try {
        const replayed = response();
        await resultHandler(request({ playerName, outcome: 'win', reportKey, battleToken }, authToken, '198.51.100.31'), replayed.res);
        assert.equal(replayed.out.statusCode, 200);
        assert.equal(replayed.out.body?.replayed, true);
        assert.deepEqual(replayed.out.body?.chronicleCards, []);
        assert.deepEqual(replayed.out.body?.witnessedPets, []);
        assert.deepEqual(replayed.out.body?.livingWitnessProgress, []);
    } finally {
        Date.now = realNow;
    }

    const afterReplay = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    assert.equal(afterReplay?._saveVersion, afterFirst?._saveVersion, 'receipt replay must not rewrite the save');
    assert.equal(await kv.get(`legacy:stats:${playerName}`), null);
});
