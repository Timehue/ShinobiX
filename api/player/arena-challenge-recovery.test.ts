import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const SESSION_SECRET = 'arena-recovery-participant-test-secret';
process.env.SESSION_SECRET = SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const CHALLENGER = 'recovery-challenger';
const RESPONDER = 'recovery-responder';
const OUTSIDER = 'recovery-outsider';
const CHALLENGE_ID = 'accepted-recovery-contract-0001';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

const setup = {
    stance: 'balanced',
    doctrine: 'vanguard',
    buyPolicy: 'balanced',
    deployment: ['top', 'mid', 'bottom', 'flex'],
    buildPackage: 'escort-rite',
    coachOrder: 'trade',
    objectiveTechnique: 'secure',
    counterstrike: 'cross-map',
};

function pets(prefix: string) {
    return Array.from({ length: 4 }, (_, index) => ({
        id: `${prefix}-${index}`,
        name: `${prefix} pet ${index}`,
        rarity: 'standard',
        level: 20,
        hp: 400 + index,
        attack: 50 + index,
        defense: 35 + index,
        speed: 30 + index,
        element: ['Fire', 'Water', 'Earth', 'Wind'][index],
        role: ['defender', 'tracker', 'assassin', 'sage'][index],
        jutsus: [{ name: 'Strike', kind: 'damage', power: 50, cooldown: 3 }],
    }));
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./challenge.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'challenges:recovery-*',
        'challenge-outgoing:recovery-*',
        `arena-challenge-setup:${CHALLENGE_ID}`,
        `arena-match-recovery:${CHALLENGE_ID}`,
        'challenge-terminal:recovery-*',
        'pvp:challenge-notice-*',
        'ratelimit:*',
    ]) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await Promise.all([
        kv.set(`save:${CHALLENGER}`, { character: { name: CHALLENGER, patreon: { active: true }, pets: pets('blue') } }),
        kv.set(`save:${RESPONDER}`, { character: { name: RESPONDER, patreon: { active: true }, pets: pets('red') } }),
        kv.set(`save:${OUTSIDER}`, { character: { name: OUTSIDER, patreon: { active: true }, pets: pets('gray') } }),
    ]);
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function request(
    name: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    query: Record<string, unknown> = {},
): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    // Other no-isolation handler suites intentionally clean up their own test
    // secret. Reassert this suite's secret at the request boundary so file
    // ordering cannot turn a participant-auth test into anonymous traffic.
    process.env.SESSION_SECRET = SESSION_SECRET;
    const token = issuePlayerToken(name);
    assert.ok(token);
    await handler({
        method,
        body,
        query,
        headers: { 'x-player-token': token, 'content-type': 'application/json' },
        socket: { remoteAddress: `127.0.0.${name === CHALLENGER ? 1 : name === RESPONDER ? 2 : 3}` },
    } as never, res);
    return out;
}

describe('accepted Arena recovery privacy', { concurrency: false }, () => {
    it('stores only an opaque realtime notice while both participants recover the full sealed match', async () => {
        const blue = pets('blue');
        const red = pets('red');
        const createdAt = Date.now();
        const opened = await request(CHALLENGER, 'POST', {
            targetName: RESPONDER,
            challenge: {
                id: CHALLENGE_ID,
                fromName: CHALLENGER,
                toName: RESPONDER,
                mode: 'clanWarPet',
                arenaMatch: true,
                arenaSize: 4,
                challengerTeamIds: blue.map((pet) => pet.id),
                challengerWarfrontSetup: setup,
                createdAt,
            },
        });
        assert.equal(opened.statusCode, 200);

        const accepted = await request(RESPONDER, 'POST', {
            targetName: CHALLENGER,
            challenge: {
                id: CHALLENGE_ID,
                fromName: RESPONDER,
                toName: CHALLENGER,
                mode: 'clanWarPet',
                arenaMatch: true,
                accepted: true,
                declined: false,
                responderTeam: red,
                responderWarfrontSetup: setup,
                createdAt,
            },
        });
        assert.equal(accepted.statusCode, 200);
        const directReveal = accepted.body?.challenge as Record<string, unknown>;
        assert.equal(typeof directReveal.petBattleSeed, 'number',
            'the authenticated responder POST still receives the full reveal');
        assert.equal(Array.isArray(directReveal.challengerTeamIds), true);
        assert.equal(Array.isArray(directReveal.responderTeam), true);

        const challengerInbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${CHALLENGER}`);
        assert.deepEqual(challengerInbox, [{
            id: CHALLENGE_ID,
            arenaMatch: true,
            accepted: true,
            declined: false,
            fromName: RESPONDER,
            toName: CHALLENGER,
            challengerSetupSealed: true,
            recoveryRequired: true,
        }]);
        const serializedInbox = JSON.stringify(challengerInbox);
        for (const forbidden of [
            'petBattleSeed', 'challengerTeamIds', 'responderTeam',
            'challengerWarfrontSetup', 'responderWarfrontSetup',
        ]) assert.equal(serializedInbox.includes(forbidden), false, `${forbidden} must not enter the public inbox`);
        assert.equal(Object.hasOwn(challengerInbox![0], 'challenger'), false,
            'the character projection must not enter the public accepted notice');

        const challengerRecovery = await request(CHALLENGER, 'GET', undefined, { challengeId: CHALLENGE_ID });
        const responderRecovery = await request(RESPONDER, 'GET', undefined, { challengeId: CHALLENGE_ID });
        assert.equal(challengerRecovery.statusCode, 200);
        assert.equal(responderRecovery.statusCode, 200);
        assert.deepEqual(challengerRecovery.body?.challenge, directReveal);
        assert.deepEqual(responderRecovery.body?.challenge, directReveal);

        const outsiderRecovery = await request(OUTSIDER, 'GET', undefined, { challengeId: CHALLENGE_ID });
        assert.equal(outsiderRecovery.statusCode, 403);
        assert.equal(await kv.get(`arena-match-recovery:${CHALLENGE_ID}`) !== null, true,
            'recovery durability is independent from the public notice lifecycle');
    });

    it('replaces forged generic challenger and responder pets with bounded save projections', async () => {
        const id = 'server-sourced-pet-notice-0002';
        const unaffiliated = await request(OUTSIDER, 'POST', {
            targetName: CHALLENGER,
            challenge: {
                id,
                fromName: OUTSIDER,
                toName: CHALLENGER,
                mode: 'clanWarPet',
                accepted: true,
                responderPetId: 'gray-0',
            },
        });
        assert.equal(unaffiliated.statusCode, 409);
        assert.equal(unaffiliated.body?.code, 'challenge-terminal-not-authorized');
        assert.equal(await kv.get(`challenges:${CHALLENGER}`), null);

        const opened = await request(CHALLENGER, 'POST', {
            targetName: RESPONDER,
            challenge: {
                id,
                fromName: 'forged-sender',
                toName: RESPONDER,
                mode: 'clanWarPet',
                challengerPetId: 'blue-0',
                petBattleSeed: 12345,
                createdAt: Date.now(),
                challenger: {
                    name: 'Injected',
                    ryo: 999_999_999,
                    pets: [{ id: 'blue-0', attack: 99_999, image: `data:image/png;base64,${'A'.repeat(20_000)}` }],
                },
            },
        });
        assert.equal(opened.statusCode, 200);
        const incoming = opened.body?.challenge as Record<string, unknown>;
        const incomingCharacter = incoming.challenger as Record<string, unknown>;
        assert.equal(incoming.fromName, CHALLENGER);
        assert.equal(incomingCharacter.name, CHALLENGER);
        assert.equal('ryo' in incomingCharacter, false);
        const incomingPets = incomingCharacter.pets as Array<Record<string, unknown>>;
        assert.equal(incomingPets.length, 1);
        assert.equal(incomingPets[0].attack, 50);
        assert.equal('image' in incomingPets[0], false);

        for (const attempt of [
            { actor: OUTSIDER, attemptedId: id, petId: 'gray-0' },
            { actor: RESPONDER, attemptedId: `${id}-wrong`, petId: 'red-0' },
        ]) {
            const rejected = await request(attempt.actor, 'POST', {
                targetName: CHALLENGER,
                challenge: {
                    ...incoming,
                    id: attempt.attemptedId,
                    fromName: attempt.actor,
                    toName: CHALLENGER,
                    accepted: true,
                    responderPetId: attempt.petId,
                },
            });
            assert.equal(rejected.statusCode, 409);
            assert.equal(rejected.body?.code, 'challenge-terminal-not-authorized');
            assert.equal(await kv.get(`challenges:${CHALLENGER}`), null,
                'an unauthorized terminal transition must not write the target inbox');
        }

        const acceptedBody = {
            targetName: CHALLENGER,
            challenge: {
                ...incoming,
                fromName: RESPONDER,
                toName: CHALLENGER,
                accepted: true,
                responderPetId: 'red-0',
                responderPet: {
                    id: 'red-0',
                    attack: 99_999,
                    privateBlob: 'x'.repeat(20_000),
                },
            },
        };
        const accepted = await request(RESPONDER, 'POST', acceptedBody);
        assert.equal(accepted.statusCode, 200);
        const terminal = accepted.body?.challenge as Record<string, unknown>;
        const responderPet = terminal.responderPet as Record<string, unknown>;
        assert.equal(terminal.fromName, RESPONDER);
        assert.equal(terminal.toName, CHALLENGER);
        assert.equal(responderPet.id, 'red-0');
        assert.equal(responderPet.attack, 50);
        assert.equal('privateBlob' in responderPet, false);
        assert.ok(Buffer.byteLength(JSON.stringify(terminal), 'utf8') < 32 * 1024,
            'one bounded notice cannot amplify a client blob into a large inbox row');

        const replay = await request(RESPONDER, 'POST', {
            ...acceptedBody,
            challenge: {
                ...(acceptedBody.challenge as Record<string, unknown>),
                responderPet: { id: 'red-0', attack: 1, changedOnRetry: true },
            },
        });
        assert.equal(replay.statusCode, 200);
        assert.deepEqual(replay.body?.challenge, terminal,
            'a retry replays the first immutable server projection');
        const terminalInbox = await kv.get<Array<Record<string, unknown>>>(`challenges:${CHALLENGER}`);
        assert.equal(terminalInbox?.filter((notice) => notice.id === id).length, 1,
            'terminal retries are exact-once in the inbox');
    });

    it('routes battleId notices only from the exact active server-session role', async () => {
        const battleId = 'challenge-notice-sector-session';
        const notice = {
            id: 'session-owned-notice-0003',
            fromName: CHALLENGER,
            toName: RESPONDER,
            challenger: { name: 'forged' },
            createdAt: Date.now(),
            mode: 'standard',
            sectorAttack: true,
            battleId,
        };
        const send = (actor: string, targetName: string, challenge: Record<string, unknown>) => request(actor, 'POST', {
            targetName,
            challenge,
        });

        const missing = await send(CHALLENGER, RESPONDER, notice);
        assert.equal(missing.statusCode, 409);
        assert.equal(missing.body?.code, 'challenge-battle-session-invalid');
        assert.equal(await kv.get(`challenges:${RESPONDER}`), null);

        const session = {
            battleId,
            status: 'active',
            winner: null,
            p1: { name: CHALLENGER, character: { name: CHALLENGER } },
            p2: { name: RESPONDER, character: { name: RESPONDER } },
            realFighters: { p1: true, p2: true },
        };
        await kv.set(`pvp:${battleId}`, session, { ex: 15 * 60 });

        const reversed = await send(RESPONDER, CHALLENGER, {
            ...notice, fromName: RESPONDER, toName: CHALLENGER,
        });
        assert.equal(reversed.statusCode, 409);
        assert.equal(reversed.body?.code, 'challenge-battle-session-invalid');
        const nonparticipant = await send(OUTSIDER, RESPONDER, {
            ...notice, fromName: OUTSIDER,
        });
        assert.equal(nonparticipant.statusCode, 409);
        assert.equal(nonparticipant.body?.code, 'challenge-battle-session-invalid');
        assert.equal(await kv.get(`challenges:${RESPONDER}`), null);

        await kv.set(`pvp:${battleId}`, { ...session, realFighters: { p1: true, p2: false } }, { ex: 15 * 60 });
        const npcRole = await send(CHALLENGER, RESPONDER, notice);
        assert.equal(npcRole.statusCode, 409);
        assert.equal(npcRole.body?.code, 'challenge-battle-session-invalid');
        assert.equal(await kv.get(`challenges:${RESPONDER}`), null);

        await kv.set(`pvp:${battleId}`, session, { ex: 15 * 60 });
        const legitimateSectorNotice = await send(CHALLENGER, RESPONDER, notice);
        assert.equal(legitimateSectorNotice.statusCode, 200);
        const routed = legitimateSectorNotice.body?.challenge as Record<string, unknown>;
        assert.equal(routed.battleId, battleId);
        assert.equal(routed.fromName, CHALLENGER);
        assert.equal(routed.toName, RESPONDER);
        assert.equal((await kv.get<Array<Record<string, unknown>>>(`challenges:${RESPONDER}`))?.length, 1);
    });
});
