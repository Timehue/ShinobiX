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

    const replay = await post(player, {
        event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'investigate',
    }, '127.0.0.92');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.ryoEarned, first.body?.ryoEarned);
    assert.equal(replay.body?.story, first.body?.story);
    const replayCharacter = replay.body?.character as Record<string, unknown>;
    assert.equal(replayCharacter.ryo, firstCharacter.ryo, 'replay cannot pay twice');
});

test('claim cap leaves the completed lease ready and rejects invalid choices', async () => {
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
    const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
    const pet = (((saved?.character as Record<string, unknown>).pets) as Array<Record<string, unknown>>)[0];
    assert.equal((pet.expedition as Record<string, unknown>).token, token, 'capped claim remains collectable tomorrow');

    const invalid = await post(player, { event: 'expedition', petId: 'pet-1', expeditionToken: token, returnChoice: 'gamble' }, '127.0.0.94');
    assert.equal(invalid.statusCode, 400);
    assert.match(String(invalid.body?.error), /return choice/i);
});
