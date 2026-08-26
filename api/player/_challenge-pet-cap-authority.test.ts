import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'challenge-pet-cap-authority-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let kv: typeof import('../_storage.js').kv;

const pet = (id: string) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 20,
    xp: 0,
    maxLevel: 100,
    hp: 300,
    attack: 60,
    defense: 40,
    speed: 35,
    jutsus: [],
});

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

async function post(player: string, body: Record<string, unknown>, address: string): Promise<Out> {
    const { res, out } = response();
    await handler({
        method: 'POST',
        body,
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(player) ?? '',
        },
        socket: { remoteAddress: address },
    } as never, res);
    return out;
}

async function seedPlayer(name: string, supporter = false) {
    const pets = Array.from({ length: 6 }, (_, index) => pet(`${name}-pet-${index + 1}`));
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: {
            name,
            level: 20,
            activePetId: pets[0].id,
            activePetId2v2: pets[1].id,
            patreon: { active: supporter },
            pets,
        },
    });
    return pets;
}

async function sendPetChallenge(
    challenger: string,
    responder: string,
    id: string,
    petId: string,
    address: string,
): Promise<Out> {
    return post(challenger, {
        targetName: responder,
        challenge: {
            id,
            fromName: challenger,
            toName: responder,
            mode: 'clanWarPet',
            challengerPetId: petId,
        },
    }, address);
}

async function acceptPetChallenge(
    challenger: string,
    responder: string,
    id: string,
    petId: string,
    address: string,
): Promise<Out> {
    return post(responder, {
        targetName: challenger,
        challenge: {
            id,
            fromName: responder,
            toName: challenger,
            accepted: true,
            responderPetId: petId,
        },
    }, address);
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./challenge.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a Supporter challenge publishes all six eligible pets, then rejects a lapsed overflow selection at accept time', async () => {
    const challenger = 'challengecaplapseone';
    const responder = 'challengecaplapsetwo';
    const challengerPets = await seedPlayer(challenger, true);
    const responderPets = await seedPlayer(responder);
    const id = 'challenge-cap-lapse-001';

    const sent = await sendPetChallenge(challenger, responder, id, challengerPets[5].id, '127.0.0.71');
    assert.equal(sent.statusCode, 200);
    const inbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${responder}`);
    const projected = inbox?.[0]?.challenger as { pets?: Array<{ id: string }> } | undefined;
    assert.deepEqual(projected?.pets?.map(({ id: petId }) => petId), challengerPets.map(({ id: petId }) => petId));

    const stored = await kv.get<Record<string, unknown>>(`save:${challenger}`);
    const character = stored?.character as Record<string, unknown>;
    await kv.set(`save:${challenger}`, {
        ...stored,
        character: { ...character, patreon: { active: false } },
    });

    const accepted = await acceptPetChallenge(challenger, responder, id, responderPets[0].id, '127.0.0.72');
    assert.equal(accepted.statusCode, 409);
    assert.match(String(accepted.body?.error), /reselect eligible, combat-ready carried pets/i);
    assert.equal((await kv.get<Record<string, unknown>>(`challenges:record:${id}`))?.status, 'pending');
});

test('a lapse still allows an originally selected pet that remains inside the Base four-pet projection', async () => {
    const challenger = 'challengecapeligibleone';
    const responder = 'challengecapeligibletwo';
    const challengerPets = await seedPlayer(challenger, true);
    const responderPets = await seedPlayer(responder);
    const id = 'challenge-cap-eligible-001';

    const sent = await sendPetChallenge(challenger, responder, id, challengerPets[3].id, '127.0.0.75');
    assert.equal(sent.statusCode, 200);

    const stored = await kv.get<Record<string, unknown>>(`save:${challenger}`);
    const character = stored?.character as Record<string, unknown>;
    await kv.set(`save:${challenger}`, {
        ...stored,
        character: { ...character, patreon: { active: false } },
    });

    const accepted = await acceptPetChallenge(challenger, responder, id, responderPets[0].id, '127.0.0.76');
    assert.equal(accepted.statusCode, 200);
    assert.equal((await kv.get<Record<string, unknown>>(`challenges:record:${id}`))?.status, 'accepted');

    const inbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${challenger}`);
    const projected = inbox?.at(-1)?.challenger as { pets?: Array<{ id: string }> } | undefined;
    assert.deepEqual(
        projected?.pets?.map(({ id: petId }) => petId),
        challengerPets.slice(0, 4).map(({ id: petId }) => petId),
    );
});

test('acceptance rejects a challenger pet that became busy after the invitation was sent', async () => {
    const challenger = 'challengecapbusyone';
    const responder = 'challengecapbusytwo';
    const challengerPets = await seedPlayer(challenger);
    const responderPets = await seedPlayer(responder);
    const id = 'challenge-cap-busy-001';

    const sent = await sendPetChallenge(challenger, responder, id, challengerPets[2].id, '127.0.0.73');
    assert.equal(sent.statusCode, 200);

    const stored = await kv.get<Record<string, unknown>>(`save:${challenger}`);
    const character = stored?.character as Record<string, unknown>;
    const pets = (character.pets as Array<Record<string, unknown>>).map((value) =>
        value.id === challengerPets[2].id
            ? { ...value, training: { type: 'strength', endsAt: Date.now() + 60_000 } }
            : value,
    );
    await kv.set(`save:${challenger}`, { ...stored, character: { ...character, pets } });

    const accepted = await acceptPetChallenge(challenger, responder, id, responderPets[0].id, '127.0.0.74');
    assert.equal(accepted.statusCode, 409);
    assert.match(String(accepted.body?.error), /reselect eligible, combat-ready carried pets/i);
    assert.equal((await kv.get<Record<string, unknown>>(`challenges:record:${id}`))?.status, 'pending');
});

test('new legacy ranked-pet notices stay retired even when private engine flags are enabled', async () => {
    const challenger = 'challengerankedretiredone';
    const responder = 'challengerankedretiredtwo';
    const challengerPets = await seedPlayer(challenger);
    await seedPlayer(responder);
    const id = 'challenge-ranked-retired-001';
    process.env.ENABLE_PET_RANKED_SERVER_V1 = '1';
    process.env.ENABLE_PET_RANKED_PUBLIC_CHALLENGES_V1 = '1';
    try {
        const sent = await post(challenger, {
            targetName: responder,
            challenge: {
                id,
                fromName: challenger,
                toName: responder,
                mode: 'rankedPet',
                challengerPetId: challengerPets[0].id,
            },
        }, '127.0.0.77');
        assert.equal(sent.statusCode, 410);
        assert.match(String(sent.body?.error), /legacy ranked pet challenges are unavailable/i);
        assert.equal(await kv.get(`challenges:record:${id}`), null);
        assert.equal(await kv.get(`challenges:${responder}`), null);
    } finally {
        delete process.env.ENABLE_PET_RANKED_SERVER_V1;
        delete process.env.ENABLE_PET_RANKED_PUBLIC_CHALLENGES_V1;
    }
});

test('Warfront acceptance preserves both sealed plans and a server-minted seed', async () => {
    const challenger = 'challengewarfrontplanone';
    const responder = 'challengewarfrontplantwo';
    const challengerPets = await seedPlayer(challenger);
    const responderPets = await seedPlayer(responder);
    const id = 'challenge-warfront-plan-001';
    const challengerWarfrontPlan = { buyPolicy: 'offense', stance: 'jungle', doctrine: 'warden-pact' };
    const responderWarfrontPlan = { buyPolicy: 'defense', stance: 'turtle', doctrine: 'bulwark' };

    const sent = await post(challenger, {
        targetName: responder,
        challenge: {
            id, fromName: challenger, toName: responder, mode: 'clanWarPet',
            arenaMatch: true, arenaSize: 4, challengerTeamIds: challengerPets.slice(0, 4).map(({ id: petId }) => petId),
            challengerWarfrontPlan,
            petBattleSeed: 777,
        },
    }, '127.0.0.78');
    assert.equal(sent.statusCode, 200);
    const responderInbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${responder}`);
    const invitation = responderInbox?.find((entry) => entry.id === id);
    assert.deepEqual(invitation?.challengerWarfrontPlan, challengerWarfrontPlan);
    assert.ok(Number.isSafeInteger(invitation?.petBattleSeed) && Number(invitation?.petBattleSeed) > 0);
    assert.notEqual(invitation?.petBattleSeed, 777, 'the API replaces a client seed with server authority');

    const accepted = await post(responder, {
        targetName: challenger,
        challenge: {
            ...invitation,
            id, fromName: responder, toName: challenger, accepted: true,
            responderTeam: responderPets.slice(0, 4),
            responderWarfrontPlan,
        },
    }, '127.0.0.79');
    assert.equal(accepted.statusCode, 200);
    const challengerInbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${challenger}`);
    const notice = challengerInbox?.find((entry) => entry.id === id);
    assert.equal(notice?.petBattleSeed, invitation?.petBattleSeed);
    assert.deepEqual(notice?.challengerWarfrontPlan, challengerWarfrontPlan);
    assert.deepEqual(notice?.responderWarfrontPlan, responderWarfrontPlan);
});
