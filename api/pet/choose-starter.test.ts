import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'choose-starter-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

// The signed Academy starter exactly as the client submits it (api/pet/_starter.ts
// checks its digest), copied from _starter.test.ts.
const FIRE = {
    id: 'starter-fire', name: 'Cinder Cub', rarity: 'standard', level: 1, xp: 0, maxLevel: 100,
    hp: 280, attack: 56, defense: 22, speed: 38, moveRange: 3, element: 'Fire', trait: 'Aggressive',
    unlockedForPve: false,
    description: "A hot-tempered fox kit whose fur smolders when it's spoiling for a fight.",
    jutsus: [
        { name: 'Cinder Pounce', power: 48, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        { name: 'Searing Wound', power: 30, cooldown: 4, currentCooldown: 0, kind: 'wound', rounds: 2 },
        { name: 'Flame Burst', power: 58, cooldown: 3, currentCooldown: 0, kind: 'damage', signature: true },
        { name: 'Ember Dash', power: 0, cooldown: 3, currentCooldown: 0, kind: 'move' },
    ],
};

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(playerName: string, body: Record<string, unknown>) {
    return {
        method: 'POST', body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function choose(playerName: string, body: Record<string, unknown>) {
    const { res, out } = response();
    await handler(request(playerName, body), res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./choose-starter.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a replayed starter choice is answered with the save as it stands, not a refusal', async () => {
    // The client treats any refusal as "not saved": it strips the pet, resets
    // the onboarding step and replays the cinematic, and the next pick was
    // refused the same way. A lost reply therefore looped a new player forever.
    const player = 'starterreplay';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 1, pets: [], onboardingStep: 'academyIntro' } });

    const first = await choose(player, { pet: FIRE });
    assert.equal(first.statusCode, 200);
    const firstCharacter = first.body?.character as Record<string, unknown>;
    const pets = firstCharacter.pets as Array<Record<string, unknown>>;
    assert.equal(pets.length, 1);
    assert.equal(first.body?.alreadyChosen, false);

    const replay = await choose(player, { pet: FIRE });
    assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
    assert.equal(replay.body?.alreadyChosen, true);
    const replayed = replay.body?.character as Record<string, unknown>;
    assert.deepEqual((replayed.pets as Array<Record<string, unknown>>).map((pet) => pet.id), pets.map((pet) => pet.id));
    assert.equal(replay.body?._saveVersion, first.body?._saveVersion, 'a replay writes nothing');
});

test('other refusals carry a sentence for the player and the code for the client', async () => {
    const player = 'starterlate';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 3, pets: [], onboardingStep: 'logbook' } });
    const refused = await choose(player, { pet: FIRE });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.body?.code, 'starter-not-available');
    assert.match(String(refused.body?.error), /Academy introduction/);
});
