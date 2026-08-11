import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-level-authority-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'expeditionlevelauthorityprobe';
const PET_ID = 'expedition-level-pet';

let expeditionStart: Handler;
let reportPetEvent: Handler;
let kv: typeof import('../_storage.js').kv;
let playerToken = '';

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

function request(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': playerToken },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    playerToken = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    expeditionStart = (await import('./expedition-start.js')).default as unknown as Handler;
    reportPetEvent = (await import('./report-pet-event.js')).default as unknown as Handler;
});

after(async () => {
    await kv.del(`save:${PLAYER}`).catch(() => undefined);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('forged level 100 cannot inflate a level-20 Pet Tamer expedition reward', async () => {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER,
            level: 30,
            profession: 'petTamer',
            professionRank: 0,
            ryo: 0,
            pets: [{
                id: PET_ID,
                templateId: 'standard-0',
                name: 'Authority Pup',
                rarity: 'standard',
                element: 'Fire',
                level: 20,
                maxLevel: 100,
                xp: 0,
                hp: 320,
                attack: 40,
                defense: 28,
                speed: 30,
                jutsus: [],
                breedingUsesMax: 5,
                breedingUsesRemaining: 5,
            }],
        },
    });

    const started = response();
    await expeditionStart(request({
        playerName: PLAYER,
        petId: PET_ID,
        expType: 'scout',
        petLevel: 100,
    }), started.res);
    assert.equal(started.out.statusCode, 200);
    const token = String(started.out.body?.token ?? '');
    assert.ok(token);

    const tokenKey = `pet-exp-token:${PLAYER}:${token}`;
    const seal = await kv.get<Record<string, unknown>>(tokenKey);
    assert.equal(seal?.petLevel, 20, 'token seals the saved pet level, not the forged body level');

    const startedSave = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const startedPet = ((startedSave?.character as { pets?: Array<Record<string, unknown>> })?.pets ?? [])[0];
    const expedition = startedPet.expedition as Record<string, unknown>;
    assert.equal((expedition.serverSeal as Record<string, unknown>)?.petLevel, 20, 'durable lease seals the same authoritative level');

    await kv.set(tokenKey, { ...seal, endsAt: Date.now() - 120_000 }, { ex: 60 });

    const redeemed = response();
    await reportPetEvent(request({
        playerName: PLAYER,
        event: 'long-expedition',
        expeditionToken: token,
        petId: PET_ID,
        expType: 'ruins',
        durationMinutes: 240,
        petLevel: 100,
    }), redeemed.res);

    assert.equal(redeemed.out.statusCode, 200);
    assert.equal(redeemed.out.body?.ryoEarned, 531, 'reward uses the sealed level-20 scout formula');
    assert.equal((redeemed.out.body?.balances as Record<string, unknown>)?.ryo, 531);
});
