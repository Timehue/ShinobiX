import assert from 'node:assert/strict';
import { afterEach, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'clan-lock-order-memory-only';
delete process.env.SESSION_SECRET;

/*
 * Lock ORDER for the clan row and a member's save.
 *
 * Several endpoints hold `save:clan-<slug>` and `save:<player>` at once. Locks
 * are failClosed and not reentrant, so two requests that take the pair in
 * opposite orders each hold one row and wait for the other until both give up
 * (~0.8 s) and return 500. Nothing moves — the throw lands before any write —
 * but a legitimate gift or purchase fails for no reason.
 *
 * The one order is clan row first, then the player save. The clan row lives in
 * the same `save:` namespace as player saves, so a lexical sort is NOT the same
 * thing: `save:aoi` sorts before `save:clan-orderclan`, `save:zed` after it.
 * Both kinds of name are exercised.
 *
 * Known exception, deliberately not covered: deleting a PLAYER save holds that
 * save and then detaches the member from the clan roster (player → clan, see
 * api/_delete-player-account.ts detachFromClan). That detach is best-effort — a
 * contended clan lock is recorded as a failure and the deletion proceeds.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, unknown> };
type PathName = 'exchange' | 'transfer' | 'donate' | 'kick' | 'leave' | 'dissolve';

let kv: typeof import('../_storage.js').kv;
let originalSet: typeof kv.set;
let originalDelIfEqual: typeof kv.delIfEqual;
const handlers = {} as Record<PathName, Handler>;

const CLAN_NAME = 'Order Clan';
const CLAN_KEY = 'save:clan-orderclan';
const FOUNDER = 'orderfounder';
// One member on each side of `clan-` in lexical order.
const PLAYERS = ['aoi', 'zed'] as const;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handlers.exchange = (await import('./exchange/purchase.js')).default as unknown as Handler;
    handlers.transfer = (await import('./treasury/transfer.js')).default as unknown as Handler;
    handlers.donate = (await import('./treasury/donate.js')).default as unknown as Handler;
    handlers.kick = (await import('./kick.js')).default as unknown as Handler;
    handlers.leave = (await import('./leave.js')).default as unknown as Handler;
    handlers.dissolve = (await import('../save/[name].js')).default as unknown as Handler;
    originalSet = kv.set.bind(kv);
    originalDelIfEqual = kv.delIfEqual.bind(kv);
});

afterEach(() => {
    kv.set = originalSet;
    kv.delIfEqual = originalDelIfEqual;
});

async function call(handler: Handler, request: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> }): Promise<Reply> {
    const output: Reply = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(n: number) { output.status = n; return res; },
        json(payload: Record<string, unknown>) { output.body = payload; return res; },
        end() { return res; },
    };
    await handler({
        method: request.method ?? 'POST',
        body: request.body ?? {},
        query: request.query ?? {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.90' },
    } as never, res as never);
    return output;
}

const post = (handler: Handler, body: Record<string, unknown>) => call(handler, { body });

async function seed(player: string) {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set(CLAN_KEY, {
        name: CLAN_NAME,
        founderName: FOUNDER,
        level: 25,
        xp: 0,
        treasury: { ryo: 100_000, warSupply: 10 },
        members: [{ name: FOUNDER, isFounder: true }, { name: player, battleContrib: 20 }],
    });
    await kv.set(`save:${player}`, {
        _saveVersion: 1,
        character: { name: player, clan: CLAN_NAME, clanPoints: 4000, ryo: 50_000 },
    });
}

const exchangeRequestId = () => `cex-${Date.now()}-${'a'.repeat(32)}`;

// Every endpoint that holds the clan row and a member's save at the same time
// (other than the player-deletion detach noted above).
const PATHS: Record<PathName, (player: string) => Promise<Reply>> = {
    exchange: (player) => post(handlers.exchange, { playerName: player, clan: CLAN_NAME, itemId: 'warSupplyGrant', requestId: exchangeRequestId() }),
    transfer: (player) => post(handlers.transfer, { clanName: CLAN_NAME, recipientName: player, currency: 'ryo', amount: 1000 }),
    donate: (player) => post(handlers.donate, { playerName: player, clan: CLAN_NAME, currency: 'ryo', amount: 1000 }),
    kick: (player) => post(handlers.kick, { playerName: FOUNDER, clan: CLAN_NAME, targetName: player }),
    leave: (player) => post(handlers.leave, { playerName: player, clan: CLAN_NAME }),
    // Deleting the clan save dissolves it, clearing each member under the clan lock.
    dissolve: () => call(handlers.dissolve, { method: 'DELETE', query: { name: CLAN_KEY.slice('save:'.length) } }),
};

/**
 * Record every lock acquire (`+key`) and release (`-key`) through the real
 * lock primitives, which claim `lock:<target>` with an NX set and release it
 * with delIfEqual.
 */
function recordLocks(): string[] {
    const events: string[] = [];
    kv.set = async (key, value, options) => {
        const out = await originalSet(key, value, options);
        if (options?.nx && key.startsWith('lock:') && out) events.push(`+${key.slice('lock:'.length)}`);
        return out;
    };
    kv.delIfEqual = async (key, expected) => {
        const out = await originalDelIfEqual(key, expected);
        if (key.startsWith('lock:')) events.push(`-${key.slice('lock:'.length)}`);
        return out;
    };
    return events;
}

/** [outer, inner] the first time both keys are held at once, or null if never nested. */
function nestedOrder(events: string[], a: string, b: string): string[] | null {
    const held: string[] = [];
    for (const event of events) {
        const key = event.slice(1);
        if (key !== a && key !== b) continue;
        if (event.startsWith('+')) {
            held.push(key);
            if (held.includes(a) && held.includes(b)) return held.slice(-2);
        } else {
            held.splice(held.lastIndexOf(key), 1);
        }
    }
    return null;
}

describe('clan row + member save lock order', { concurrency: false }, () => {
    for (const player of PLAYERS) {
        test(`every endpoint that nests the pair takes the clan row before save:${player}`, async () => {
            const playerKey = `save:${player}`;
            const orders: Partial<Record<PathName, string[] | null>> = {};
            for (const [name, run] of Object.entries(PATHS) as Array<[PathName, (p: string) => Promise<Reply>]>) {
                await seed(player);
                const events = recordLocks();
                const reply = await run(player);
                kv.set = originalSet;
                kv.delIfEqual = originalDelIfEqual;
                assert.equal(reply.status, 200, `${name} must succeed to exercise its locks: ${JSON.stringify(reply.body)}`);
                orders[name] = nestedOrder(events, CLAN_KEY, playerKey);
            }
            const expected = Object.fromEntries(Object.keys(PATHS).map((name) => [name, [CLAN_KEY, playerKey]]));
            assert.deepEqual(orders, expected);
        });
    }

    test('a clan gift and an Exchange purchase for the same member, interleaved, both succeed', async () => {
        // `aoi` sorts before `clan-`, the case a lexical sort gets wrong.
        const player = 'aoi';
        await seed(player);
        const pairLocks = new Set([`lock:${CLAN_KEY}`, `lock:save:${player}`]);
        // Hold the first request on its first lock until the second request has
        // tried one of the pair. Opposite orders then each hold one row and wait
        // on the other; one shared order makes the second request wait instead.
        let firstTaken = false;
        let letFirstContinue: () => void = () => undefined;
        const secondArrived = new Promise<void>((resolve) => { letFirstContinue = () => resolve(); });
        kv.set = async (key, value, options) => {
            const out = await originalSet(key, value, options);
            if (options?.nx && pairLocks.has(key)) {
                if (!firstTaken && out) {
                    firstTaken = true;
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    await Promise.race([secondArrived, new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })]);
                    clearTimeout(timer);
                } else {
                    letFirstContinue();
                }
            }
            return out;
        };

        const [purchase, gift] = await Promise.all([PATHS.exchange(player), PATHS.transfer(player)]);
        assert.equal(purchase.status, 200, `exchange purchase: ${JSON.stringify(purchase.body)}`);
        assert.equal(gift.status, 200, `treasury gift: ${JSON.stringify(gift.body)}`);
    });
});
