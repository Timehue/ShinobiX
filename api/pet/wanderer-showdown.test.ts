import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wanderer-showdown-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let resolveNaturalWorldWanderer: typeof import('../missions/_world-ai-fight.js').resolveNaturalWorldWanderer;
let wandererDayBucketFromMs: typeof import('../sector/_wanderer-encounter.js').wandererDayBucketFromMs;
let wandererShowdownFormat: typeof import('./_wanderer-showdown.js').wandererShowdownFormat;
let WANDERER_SECTOR_COUNT: number;

function findBeast(character: Record<string, unknown>) {
    const bucket = wandererDayBucketFromMs(Date.now());
    for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector += 1) {
        for (let index = 0; index <= 1; index += 1) {
            const id = `w-${sector}-${bucket}-${index}`;
            if (resolveNaturalWorldWanderer(id, character, sector, Date.now())?.verb === 'petDuel') return { id, sector };
        }
    }
    return null;
}

async function post(playerName: string, token: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = {
        setHeader: () => res,
        status: (value: number) => { out.status = value; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', body: { playerName, ...body },
        headers: { 'x-player-token': token },
        socket: { remoteAddress: '198.51.100.74' },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ resolveNaturalWorldWanderer } = await import('../missions/_world-ai-fight.js'));
    ({ wandererDayBucketFromMs, WANDERER_SECTOR_COUNT } = await import('../sector/_wanderer-encounter.js'));
    ({ wandererShowdownFormat } = await import('./_wanderer-showdown.js'));
    handler = (await import('./showdown.js')).default as unknown as Handler;
});

after(() => {
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('roadshowdown')) onlineStore.remove(player.name);
    }
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('random format remains within the number of ready pets', () => {
    assert.deepEqual([1, 2, 3].map((roll) => wandererShowdownFormat(1, roll)), ['1v1', '1v1', '1v1']);
    assert.deepEqual([1, 2, 3].map((roll) => wandererShowdownFormat(2, roll)), ['1v1', '2v2', '2v2']);
    assert.deepEqual([1, 2, 3].map((roll) => wandererShowdownFormat(5, roll)), ['1v1', '2v2', '3v3']);
});

test('road challenge enters one interactive, unpaid Colosseum session and resumes the same fight', async (t) => {
    const playerName = 'roadshowdownmain';
    const pets = Array.from({ length: 5 }, (_, i) => ({
        id: `road-pet-${i}`, name: `Road Pet ${i}`, rarity: 'rare', element: 'Earth', level: 32,
        xp: 0, maxLevel: 100, hp: 510, attack: 90, defense: 78, speed: 54,
        jutsus: [{ name: 'Proof Fang', power: 88, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true,
    }));
    const character = { name: playerName, level: 32, starterCardsClaimed: true, pets, ryo: 77, totalPetWins: 5, dailyPetWins: 2 };
    const wanderer = findBeast(character);
    if (!wanderer) return t.skip('No natural pet challenger rolled in the current wanderer window.');
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: wanderer.sector, character: { ...character, currentSector: wanderer.sector } });
    onlineStore.upsert({ name: playerName, sector: wanderer.sector, character: { name: playerName, hp: 100, maxHp: 100 } });
    const token = issuePlayerToken(playerName)!;

    const first = await post(playerName, token, { action: 'wanderer', wanderer });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const state = first.body.state;
    assert.ok(['1v1', '2v2', '3v3'].includes(state.format));
    const size = Number(state.format[0]);
    assert.equal(state.player.length, size);
    assert.equal(state.enemy.length, size);
    assert.equal(first.body.petIds.length, size);
    assert.equal(new Set(first.body.petIds).size, size);
    assert.ok(first.body.petIds.every((id: string) => pets.some((pet) => pet.id === id)));
    const session = await kv.get<Record<string, any>>(`pet:showdown:${playerName}:${state.sessionId}`);
    assert.equal(session?.rewardEligible, false);
    assert.equal(session?.finished, false);
    assert.equal(first.body._saveVersion, 2);
    assert.ok(Number(first.body.character.wandererCooldowns[wanderer.id]) > Date.now());
    assert.notEqual(first.body.character.wandererMoves[wanderer.id], wanderer.sector);

    const retry = await post(playerName, token, { action: 'wanderer', wanderer });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.state.sessionId, state.sessionId);
    assert.equal(retry.body._saveVersion, 2);
    assert.deepEqual(retry.body.petIds, first.body.petIds);

    const round = await post(playerName, token, {
        action: 'turn', sessionId: state.sessionId, expectedRound: state.round,
        commands: state.player.map((pet: { id: string }) => ({ kind: 'guard', petId: pet.id })),
    });
    assert.equal(round.status, 200, JSON.stringify(round.body));
    assert.equal(round.body.state.round, state.round + 1);
    const saved = await kv.get<Record<string, any>>(`save:${playerName}`);
    assert.equal(saved?.character.ryo, 77);
    assert.equal(saved?.character.totalPetWins, 5);
    assert.equal(saved?.character.dailyPetWins, 2);

    const steered = await post(playerName, token, { action: 'wanderer', wanderer, format: '1v1', petIds: [pets[0].id] });
    assert.equal(steered.status, 400);

    const conceded = await post(playerName, token, { action: 'forfeit', sessionId: state.sessionId });
    assert.equal(conceded.status, 200, JSON.stringify(conceded.body));
    assert.equal(conceded.body.conceded, true);
    const spent = await post(playerName, token, { action: 'wanderer', wanderer });
    assert.equal(spent.status, 409, 'the same beast must not mint a second fight after concession');
});

test('a busy lone pet leaves the encounter untouched, then starts a 1v1 when ready', async (t) => {
    const playerName = 'roadshowdownsolo';
    const pet = {
        id: 'solo-road-pet', name: 'Solo Road Pet', rarity: 'rare', element: 'Earth', level: 20,
        xp: 0, maxLevel: 100, hp: 400, attack: 70, defense: 60, speed: 45,
        jutsus: [{ name: 'Solo Fang', power: 55, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
        unlockedForPve: true, training: { endsAt: Date.now() + 60_000 },
    };
    const base = { name: playerName, level: 20, starterCardsClaimed: true, pets: [pet], ryo: 50 };
    const wanderer = findBeast(base);
    if (!wanderer) return t.skip('No natural pet challenger rolled in the current wanderer window.');
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: wanderer.sector, character: { ...base, currentSector: wanderer.sector } });
    onlineStore.upsert({ name: playerName, sector: wanderer.sector, character: { name: playerName, hp: 100, maxHp: 100 } });
    const token = issuePlayerToken(playerName)!;

    const busy = await post(playerName, token, { action: 'wanderer', wanderer });
    assert.equal(busy.status, 409);
    assert.equal(await kv.get(`pet:showdown:wanderer:${playerName}:${wanderer.id}`), null);
    const unchanged = await kv.get<Record<string, any>>(`save:${playerName}`);
    assert.equal(unchanged?._saveVersion, 1);
    assert.equal(unchanged?.character.wandererCooldowns, undefined);

    await kv.set(`save:${playerName}`, { ...unchanged, character: { ...unchanged?.character, pets: [{ ...pet, training: undefined }] } });
    const ready = await post(playerName, token, { action: 'wanderer', wanderer });
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(ready.body.state.format, '1v1');
    assert.equal(ready.body.petIds.length, 1);
});
