process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'incapacitated-gates-test-secret-32-bytes';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The ONE definition of "too hurt to start something new" (api/_elapsed-state.ts
 * isIncapacitated) and the gate it now backs on the Hollow Gate dive entry.
 *
 * Why the dive entry specifically: /api/hollow-gate/start spends a Hollow Gate
 * key and a slot off the daily cap, while /api/hollow-gate/combat-start refuses
 * every fight inside the dive for a hospitalized character. Starting while
 * admitted therefore burned a capped entry on a run that could not be played,
 * and the resulting open run suppressed vitals regen on top of the admission.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let isIncapacitated: typeof import('./_elapsed-state.js').isIncapacitated;
let start: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'divergatetest';
let ipSeed = 0;
let ids = 0;
const nextId = () => `hg-start-req-${String(++ids).padStart(6, '0')}`;

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

async function startDive(requestId = nextId()) {
    const token = issuePlayerToken(PLAYER);
    const ip = `10.71.0.${++ipSeed}`;
    const { out, res } = response();
    await start({
        method: 'POST',
        body: { playerName: PLAYER, requestId },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return { ...out, requestId };
}

async function seed(character: Json = {}) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        _regenAt: Date.now(),
        currentSector: 1,
        character: {
            name: PLAYER, level: 40, village: 'Mist',
            hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            ryo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            stats: {}, inventory: [], itemStacks: [{ itemId: 'hollow-gate-key', count: 5 }],
            ...character,
        },
    });
}

/** The daily counter the dive entry decrements. 0 while nothing has been spent. */
async function divesSpent(): Promise<number> {
    const keys = await kv.keys('hg-runs:*');
    let total = 0;
    for (const key of keys) total += Math.max(0, Math.floor(Number(await kv.get<number>(key)) || 0));
    return total;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ isIncapacitated } = await import('./_elapsed-state.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./pet/_owned-pet.js'));
    start = (await import('./hollow-gate/start.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await seed();
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('isIncapacitated — the shared predicate', { concurrency: false }, () => {
    const NOW = 1_800_000_000_000;

    it('reads the admission flag, a live admission timer, and zero HP', () => {
        assert.equal(isIncapacitated({ hp: 100, maxHp: 100 }, NOW), false, 'a healthy character is free to act');
        assert.equal(isIncapacitated({ hp: 100, hospitalized: true }, NOW), true, 'the flag alone admits');
        assert.equal(isIncapacitated({ hp: 100, hospitalizedUntil: NOW + 30_000 }, NOW), true, 'a live timer admits even without the flag');
        assert.equal(isIncapacitated({ hp: 0, maxHp: 100 }, NOW), true, 'authoritative zero HP counts, mid-settlement');
    });

    it('releases once the admission timer has run out', () => {
        assert.equal(isIncapacitated({ hp: 50, hospitalizedUntil: NOW - 1 }, NOW), false, 'an expired timer does not hold anyone');
        assert.equal(isIncapacitated({ hp: 50, hospitalizedUntil: 0 }, NOW), false);
    });

    it('fails OPEN on a record that predates the fields', () => {
        // Same call presence-gating.ts makes for an unknown level: a missing
        // field must never cost a legitimate player the ability to play.
        assert.equal(isIncapacitated(null, NOW), false);
        assert.equal(isIncapacitated(undefined, NOW), false);
        assert.equal(isIncapacitated({}, NOW), false, 'no hp field is treated as alive');
        assert.equal(isIncapacitated({ level: 5 }, NOW), false);
    });

    it('is not fooled by a truthy non-boolean flag', () => {
        assert.equal(isIncapacitated({ hp: 100, hospitalized: 'no' }, NOW), false, 'strict === true, matching combat-start');
    });
});

describe('hollow-gate/start — admission gate before anything is spent', { concurrency: false }, () => {
    it('refuses a hospitalized diver and spends NO daily entry', async () => {
        await seed({ hospitalized: true, hp: 0, hospitalizedUntil: Date.now() + 60_000 });

        const refused = await startDive();
        assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
        assert.equal(refused.body?.error, 'hospitalized');

        assert.equal(await divesSpent(), 0, 'the daily-capped entry survives the refusal');
        const char = (await kv.get<Json>(`save:${PLAYER}`))?.character as Json;
        assert.equal(char.hollowGateRun, undefined, 'no unplayable run was written onto the save');
        const stacks = char.itemStacks as Array<{ itemId: string; count: number }>;
        assert.equal(stacks.find((s) => s.itemId === 'hollow-gate-key')?.count, 5, 'the Hollow Gate key was not consumed');
    });

    it('refuses on zero HP even when the admission flag has not landed yet', async () => {
        await seed({ hp: 0 });
        const refused = await startDive();
        assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
        assert.equal(refused.body?.error, 'hospitalized');
        assert.equal(await divesSpent(), 0);
    });

    it('lets a healthy diver through', async () => {
        const ok = await startDive();
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal(await divesSpent(), 1, 'a real start does spend its entry');
    });

    it('still replays an already-started dive after the diver is hospitalized', async () => {
        // The gate sits AFTER the replay branch on purpose: that run is already
        // paid for, so refusing its idempotent retry would strand it.
        const first = await startDive();
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const spentAfterStart = await divesSpent();

        const save = await kv.get<Json>(`save:${PLAYER}`);
        await kv.set(`save:${PLAYER}`, {
            ...save,
            character: { ...(save?.character as Json), hospitalized: true, hp: 0, hospitalizedUntil: Date.now() + 60_000 },
        });

        const replay = await startDive(first.requestId);
        assert.equal(replay.statusCode, 200, `an owned run must still resolve: ${JSON.stringify(replay.body)}`);
        assert.equal(await divesSpent(), spentAfterStart, 'the replay spends nothing further');
    });
});
