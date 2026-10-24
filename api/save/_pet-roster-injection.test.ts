import assert from 'node:assert/strict';
import { before, test, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-roster-injection-test-secret';
process.env.ENABLE_LEGACY = '0';

/*
 * I-2 replay (2026-10 economy rebalance) through the real save handler: a
 * player with an empty roster posts a generic save carrying forged pets (a
 * mythic Boonbringer with forged growth stats). The stored roster stays
 * empty in BOTH ledger modes, so the fix does not depend on
 * STRICT_RAW_SAVE_LEDGER being set on the host.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

function character(name: string): Record<string, unknown> {
    return {
        name, level: 1, xp: 0, experience: 0, ryo: 0,
        rank: 'Academy Student', rankTitle: 'Academy Student', village: '',
        stats: {}, inventory: [], itemStacks: [], pets: [], equipment: {},
        earnedTitles: [], serverTitles: [],
    };
}

const forgedPets = [1, 2, 3, 4, 5].map((n) => ({
    id: `forged-${n}`, name: 'Forged', rarity: 'mythic', trait: 'Boonbringer',
    hp: 100, attack: 100, defense: 100, speed: 100,
    growthBaseStats: { hp: 9999, attack: 9999, defense: 9999, speed: 9999 },
}));

async function post(name: string, token: string, body: Record<string, unknown>) {
    const out = { status: 200, body: undefined as Record<string, unknown> | undefined };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', query: { name }, body,
        headers: { 'x-player-name': name, 'x-player-token': token, 'content-type': 'application/json' },
        socket: { remoteAddress: '203.0.113.72' },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./[name].js')).default as unknown as Handler;
});

function mockClock(t: TestContext, start: number) {
    let now = start;
    t.mock.method(Date, 'now', () => now);
    return { advance(ms: number) { now += ms; } };
}

for (const strictFlag of ['0', '1']) {
    test(`a generic save cannot inject pets into an empty roster (STRICT_RAW_SAVE_LEDGER=${strictFlag})`, async (t) => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        process.env.STRICT_RAW_SAVE_LEDGER = strictFlag;
        try {
            const name = `petinject${strictFlag}`;
            await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
            const token = issuePlayerToken(name)!;
            // The session token is minted with a 24h expiry from the real clock.
            const clock = mockClock(t, Date.now());
            const created = await post(name, token, { character: character(name), _baseSaveVersion: 0 });
            assert.equal(created.status, 200, JSON.stringify(created.body));
            clock.advance(10_000); // past the one-save-per-window burst limit

            const forged = await post(name, token, {
                character: { ...character(name), pets: forgedPets, activePetId: 'forged-1' },
                _baseSaveVersion: Number(created.body?._saveVersion),
            });
            assert.equal(forged.status, 200, JSON.stringify(forged.body));
            const stored = await kv.get<Record<string, any>>(`save:${name}`);
            assert.deepEqual(stored!.character.pets, [], 'a generic save can never add a pet (I-2)');
            assert.equal(stored!.character.activePetId ?? undefined, undefined);
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
}
