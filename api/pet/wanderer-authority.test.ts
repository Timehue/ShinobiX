import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Road beasts are fought only in the Colosseum (POST /api/pet/showdown, action
 * 'wanderer' — see wanderer-showdown.test.ts), which fields the species the
 * World Map shows (shared/wanderer-beast.ts). battle-start used to run its own
 * wanderer duel against a fixed level-tier beast. That duel is retired, and
 * these pin the two doors it left behind shut:
 *   - battle-start refuses a wanderer request before it touches anything, so a
 *     stale tab cannot fall through into an ordinary AI duel;
 *   - battle-result retires a leftover wanderer token, releasing its battle
 *     lock, instead of settling it as a casual fight.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wanderer-pet-authority-test-secret';

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

function request(body: Record<string, unknown>, token: string, suffix: number) {
    return {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: `198.51.100.${suffix}` },
    } as never;
}

function pet(id: string) {
    return {
        id, name: 'Proof Hound', rarity: 'rare', element: 'Earth', level: 32,
        xp: 0, maxLevel: 100, hp: 510, attack: 90, defense: 78, speed: 54,
        jutsus: [{ name: 'Proof Fang', power: 88, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true,
    };
}

async function savePlayer(playerName: string) {
    const character = {
        name: playerName, level: 32, currentSector: 7, starterCardsClaimed: true,
        ryo: 77, totalPetWins: 5, dailyPetWins: 2, tileCards: [], pets: [pet(`${playerName}-pet`)],
    };
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: 7, character });
    return character;
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
});

test('battle-start refuses a road beast before it writes anything', async () => {
    const playerName = 'wanderpetretired';
    const character = await savePlayer(playerName);
    const auth = issuePlayerToken(playerName)!;
    const started = response();
    await startHandler(request({
        playerName, mode: '1v1', playerPetIds: [character.pets[0].id],
        wanderer: { id: 'w-7-1-0', sector: 7 },
    }, auth, 41), started.res);
    assert.equal(started.out.statusCode, 410);
    assert.match(String(started.out.body?.error), /Colosseum/);
    assert.equal(started.out.body?.token, undefined, 'no battle token is minted');
    assert.equal(await kv.get(`pet:battle-active:${playerName}`), null, 'no battle lock is taken');
    const saved = await kv.get<Record<string, any>>(`save:${playerName}`);
    assert.equal(saved?._saveVersion, 1);
    assert.equal(saved?.character.wandererCooldowns, undefined, 'the beast is not spent');
});

test('battle-result retires a leftover road beast token without settling it', async () => {
    const playerName = 'wanderpetleftover';
    const character = await savePlayer(playerName);
    const auth = issuePlayerToken(playerName)!;
    const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const tokenKey = `pet:battle-token:${playerName}:${token}`;
    await kv.set(tokenKey, {
        playerName, reportKey: `pet:${token}`, opponentLevel: 32, rewardRyo: 64, seed: 9, mode: '1v1',
        createdAt: Date.now(), playerPetIds: [character.pets[0].id], opponentPetIds: ['generic-ai-pet-guardhound'],
        wanderer: { id: 'w-7-1-0', sector: 7, verb: 'petDuel' },
        settlementPolicy: 'casual-no-progression', authoritativeOutcome: 'win',
    }, { ex: 900 });
    await kv.set(`pet:battle-active:${playerName}`, token, { ex: 900 });

    const reported = response();
    await resultHandler(request({
        playerName, outcome: 'win', battleToken: token, reportKey: `pet:${token}`,
    }, auth, 42), reported.res);
    assert.equal(reported.out.statusCode, 410);
    assert.match(String(reported.out.body?.error), /retired/);
    assert.equal(await kv.get(tokenKey), null, 'the leftover token is retired');
    assert.equal(await kv.get(`pet:battle-active:${playerName}`), null, 'its battle lock is released');
    const saved = await kv.get<Record<string, any>>(`save:${playerName}`);
    assert.equal(saved?._saveVersion, 1);
    assert.equal(saved?.character.ryo, 77, 'nothing is paid');
    assert.equal(saved?.character.totalPetWins, 5, 'no win is recorded');
});
