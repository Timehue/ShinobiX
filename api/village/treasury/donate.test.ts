import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-donate-test-secret';

/*
 * Village Merit is a KAGE-CHALLENGE gate, so the ryo-value basis a donation
 * earns merit on is balance, not plumbing.
 *
 * Village Stores routing (ration-pack -> provisions, CRAFT_POINTS materials ->
 * materialPoints) briefly re-based routed donations on `routed.ryoValue`
 * (craft points x CRAFT_POINT_RYO_VALUE 4). For a hunt-torn-hide that is 3
 * points -> 12 ryo-equivalent against the 500 an item donation has always been
 * worth: a ~42x collapse, and an unapproved balance change. Every ITEM donation
 * earns on the same flat per-item basis, routed or not, rations included.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;
let meritForDonation: typeof import('../_village-merit.js').meritForDonation;
let donate: Handler;

const PLAYER = 'meritdonor';
const VILLAGE = 'Leaf';
const VILLAGE_KEY = 'game:village-state:leaf';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ meritForDonation } = await import('../_village-merit.js'));
    donate = (await import('./donate.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [`save:${PLAYER}*`, `${VILLAGE_KEY}*`, 'ratelimit:*', 'lock:*', 'economy-tx:*', 'audit:village-treasury-donate:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    await kv.set(VILLAGE_KEY, { village: VILLAGE, treasury: { ryo: 0, items: [] } });
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
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

async function post(body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await donate({
        method: 'POST',
        body: { playerName: PLAYER, village: VILLAGE, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(PLAYER) ?? '' },
        socket: { remoteAddress: '127.4.0.9' },
    } as never, output.res);
    return output.out;
}

async function seedDonor(character: Record<string, unknown>) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, village: VILLAGE, level: 30, hp: 100, maxHp: 100,
            ryo: 100_000, inventory: [], itemStacks: [], ...character,
        },
    });
}

const meritOf = async () => Number((await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`))?.character.villageMerit ?? 0);

describe('village treasury donation merit', () => {
    it('pays a routed MATERIAL donation the same flat per-item merit as any other item', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'hunt-torn-hide', count: 10 }] });
        const out = await post({ itemId: 'hunt-torn-hide', count: 10 });
        assert.equal(out.statusCode, 200);
        // Routing still happened — the stack landed in materialPoints, not as a
        // loose treasury item (10 x 3 craft points).
        assert.deepEqual(out.body?.stores, { provisions: 0, materialPoints: 30 });
        assert.equal(await meritOf(), meritForDonation(10 * 500), '10 items = 5,000 ryo-equivalent = 5 merit');
        assert.equal(await meritOf(), 5);
        assert.notEqual(await meritOf(), meritForDonation(30 * 4), 'NOT the craft-point ryo value (120 -> 0 merit)');
    });

    it('pays a routed RATION donation on that same per-item basis', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'ration-pack', count: 4 }] });
        const out = await post({ itemId: 'ration-pack', count: 4 });
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.stores, { provisions: 4, materialPoints: 0 });
        assert.equal(await meritOf(), meritForDonation(4 * 500), '4 rations = 2,000 ryo-equivalent = 2 merit');
        assert.equal(await meritOf(), 2);
    });

    it('leaves an UNROUTED item donation and a currency donation exactly as they were', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'item-smoke-bomb', count: 6 }] });
        const loose = await post({ itemId: 'item-smoke-bomb', count: 6 });
        assert.equal(loose.statusCode, 200);
        assert.equal(loose.body?.stores, undefined, 'an unrouted item stays a loose treasury item');
        assert.equal(await meritOf(), 3);

        await seedDonor({ ryo: 100_000 });
        const currency = await post({ currency: 'ryo', amount: 7_500 });
        assert.equal(currency.statusCode, 200);
        assert.equal(await meritOf(), meritForDonation(7_500), 'currency donations bill their own amount');
        assert.equal(await meritOf(), 7);
    });
});

describe('village treasury donation under lock contention', () => {
    it('answers a contended treasury with a retryable 503, not "Internal server error"', async () => {
        await seedDonor({ ryo: 100_000 });
        // Another donor is mid-write on the village-state row. `withKvLock(...,
        // { failClosed: true })` aborts rather than racing a currency write, and
        // that abort used to fall through to the generic 500 — which reads to a
        // player as "the game is broken" instead of "someone beat you to it".
        await kv.set(`lock:${VILLAGE_KEY}`, 'someone-else', { ex: 30 });
        try {
            const out = await post({ currency: 'ryo', amount: 1_000 });
            assert.equal(out.statusCode, 503);
            assert.equal(out.body?.retryable, true);
            assert.match(String(out.body?.error), /retry/i);
            assert.doesNotMatch(String(out.body?.error), /internal server error/i);

            // Nothing moved: the abort lands before any mutation.
            const donor = await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`);
            assert.equal(donor?.character.ryo, 100_000);
            const state = await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY);
            assert.equal(state?.treasury.ryo, 0);
        } finally {
            await kv.del(`lock:${VILLAGE_KEY}`);
        }
    });
});
