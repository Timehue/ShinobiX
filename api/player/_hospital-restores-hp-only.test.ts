process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hospital-hp-only-test-secret-32-bytes';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F1(A) + F1(C): the hospital treats INJURY.
 *
 * Discharge used to write hp/chakra/stamina all to max, free, 60 seconds after a
 * defeat — against a 100-ryo cafeteria Feast and (before the pooled-regen change)
 * a 2h46m rest at level 100. Dying was the fastest and cheapest full restore in
 * the game, which inverts the incentive the combat code was written for.
 *
 * Nothing is TAKEN from a defeated player by this change. Defeat simply stops
 * being a reward: HP comes back, and the chakra and stamina spent losing the
 * fight have to be recovered by resting or at the Cafeteria like anyone else's.
 *
 * F1(C) closes the door beside it: a Healer's self top-up was an uncapped,
 * uncooled free restore that did not even require being hurt.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let heal: Handler;

const PLAYER = 'wardsubject';
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function call(body: Json) {
    const token = issuePlayerToken(PLAYER);
    const ip = `10.73.0.${++ipSeed}`;
    const { out, res } = response();
    await heal({
        method: 'POST',
        body: { targetName: PLAYER, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function seed(character: Json = {}) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        character: {
            name: PLAYER, level: 100, village: 'Mist',
            hp: 0, maxHp: 10_000,
            chakra: 120, maxChakra: 10_000,
            stamina: 340, maxStamina: 10_000,
            ryo: 50_000, inventory: [], itemStacks: [], stats: {},
            ...character,
        },
    });
}

const charOf = async () => (await kv.get<Json>(`save:${PLAYER}`))?.character as Record<string, number>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    heal = (await import('./heal.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('hospital discharge restores HP only', { concurrency: false }, () => {
    it('gives back HP and leaves the chakra and stamina spent losing the fight', async () => {
        await seed({ hospitalized: true, hospitalizedUntil: Date.now() - 1_000 });

        const out = await call({});
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));

        const char = await charOf();
        assert.equal(char.hp, 10_000, 'injury is what the hospital treats');
        assert.equal(char.chakra, 120, 'exhaustion is not');
        assert.equal(char.stamina, 340);
        assert.equal(char.hospitalized as unknown as boolean, false);
    });

    it('is still free once the timer has run out', async () => {
        await seed({ hospitalized: true, hospitalizedUntil: Date.now() - 1_000 });
        const out = await call({});
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.chargedRyo, 0, 'the change removes a reward, it does not add a cost');
        assert.equal((await charOf()).ryo, 50_000, 'no ryo is taken on defeat');
    });

    it('still refuses an early discharge before the timer expires', async () => {
        await seed({ hospitalized: true, hospitalizedUntil: Date.now() + 60_000 });
        const out = await call({});
        assert.equal(out.statusCode, 429, JSON.stringify(out.body));
        assert.equal((await charOf()).hp, 0, 'and nothing is restored');
    });
});

describe('healer self top-up', { concurrency: false }, () => {
    it('restores HP only, and not chakra or stamina', async () => {
        await seed({ profession: 'healer', hp: 4_000, professionXp: 0 });
        const out = await call({ topUp: true });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const char = await charOf();
        assert.equal(char.hp, 10_000);
        assert.equal(char.chakra, 120, 'a Healer refills their own chakra by resting, like everyone else');
        assert.equal(char.stamina, 340);
    });

    it('is rate-limited by the same cooldown healing anyone else already has', async () => {
        await seed({ profession: 'healer', hp: 4_000, professionXp: 0 });

        const first = await call({ topUp: true });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));

        await kv.set(`save:${PLAYER}`, {
            ...(await kv.get<Json>(`save:${PLAYER}`)),
            character: { ...(await charOf()), hp: 4_000 },
        });

        const second = await call({ topUp: true });
        assert.equal(second.statusCode, 429, `an uncooled self-restore is the loop F1 closes: ${JSON.stringify(second.body)}`);
        assert.ok(Number(second.body?.retryAfterMs) > 0, 'a 0 hint reads as "ready" to the client and defeats the cooldown');
        assert.equal((await charOf()).hp, 4_000, 'and the second call restores nothing');
    });

    it('still refuses a non-Healer', async () => {
        await seed({ profession: 'vanguard', hp: 4_000 });
        const out = await call({ topUp: true });
        assert.equal(out.statusCode, 403, JSON.stringify(out.body));
    });
});
