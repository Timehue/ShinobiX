import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

/*
 * Two Weekly Boss guards from the 2026-10 economy rebalance that need the real
 * handler and storage:
 *   - BRF-3: the payout ranking leaves the staff actor out. That filter is a
 *     backstop: a staff start reads save:admin, and no such save exists, so the
 *     fight is refused before any damage can be banked under 'admin'.
 *   - BRF-4: the payout is recorded in the economy ledger exactly once, by
 *     the committed credit, and a later read of the settled spawn adds nothing.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'weekly-boss-admin-actor-full-admin-password';
process.env.ADMIN_SESSION_SECRET = 'weekly-boss-admin-actor-session-secret-32b';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const BOSS_KEY = 'game:weekly-boss-state';
const PLAYER = 'weeklyadminactorplayer';

let kv: typeof import('./_storage.js').kv;
let handler: Handler;
let drainBackgroundWork: typeof import('./_background-work.js').drainBackgroundWork;
let ECON_TXN_LIST_KEY: string;

async function invoke(method: 'GET' | 'POST', body: Json = {}): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(json: Json) { out.body = json; return res; },
        end: () => res,
    };
    await handler({
        method,
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        body,
        socket: { remoteAddress: '127.0.0.86' },
    } as never, res as never);
    return out;
}

function boss(expired: boolean, damageByPlayer: Record<string, number>): Json {
    const now = Date.now();
    return {
        spawnId: `admin-actor-${expired ? 'expired' : 'live'}`,
        weekKey: '2026-W42',
        aiId: 'moonshadow-oni',
        bossName: 'Moonshadow Oni',
        hpMax: 129_800,
        hpRemaining: 129_800,
        scaleFactor: 2,
        damageByPlayer,
        attemptsByPlayer: {},
        startedAt: now - 73 * 60 * 60_000,
        expiresAt: expired ? now - 1_000 : now + 60 * 60_000,
    };
}

async function clearMemoryKv() {
    const keys = await kv.keys('*');
    if (keys.length > 0) await kv.del(...keys);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ drainBackgroundWork } = await import('./_background-work.js'));
    ({ ECON_TXN_LIST_KEY } = await import('./_economy.js'));
    handler = (await import('./weekly-boss.js')).default as unknown as Handler;
});

beforeEach(clearMemoryKv);

after(async () => {
    await drainBackgroundWork();
    await clearMemoryKv();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
});

test('a staff start finds no save:admin and is refused before any damage is banked', async () => {
    await kv.set(BOSS_KEY, boss(false, {}));
    const refused = await invoke('POST', { kind: 'startFight' });
    assert.equal(refused.statusCode, 404);
    assert.equal(refused.body?.error, 'Player save not found.');
    const state = await kv.get<Json>(BOSS_KEY);
    assert.deepEqual(state?.damageByPlayer, {});
    assert.deepEqual(state?.attemptsByPlayer, {}, 'no attempt was reserved');
});

test('the payout is recorded once in the ledger, and admin damage takes no share', async () => {
    await kv.set(BOSS_KEY, boss(true, { admin: 900_000, [PLAYER]: 100_000 }));
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 3,
        character: {
            name: PLAYER, level: 1, unspentStats: 0, spentStats: {}, examsPassed: [], ryo: 100, inventory: [],
            maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 10, chakra: 10, stamina: 10,
        },
    });

    const first = await invoke('GET');
    assert.equal(first.statusCode, 200);
    const summary = (first.body?.boss as Json)?.distributionSummary as Json[];
    assert.deepEqual(summary.map((entry) => entry.name), [PLAYER], 'admin is not a paid contributor');
    assert.equal(summary[0]!.isMvp, true);
    assert.equal(summary[0]!.ryo, 90_000);
    assert.equal((await kv.get<{ character?: Json }>(`save:${PLAYER}`))?.character?.ryo, 90_100);

    await invoke('GET');
    await drainBackgroundWork();
    const txns = (await kv.get<Json[]>(ECON_TXN_LIST_KEY)) ?? [];
    const payouts = txns.filter((txn) => txn.source === 'weeklyboss.payout');
    assert.deepEqual(payouts.map((txn) => [txn.player, txn.currency, txn.delta, txn.txnId]),
        [[PLAYER, 'ryo', 90_000, `weekly-boss:2026-W42:${PLAYER}:ryo`]]);
});
