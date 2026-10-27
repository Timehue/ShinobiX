import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { KvCasOp } from '../_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wanderer-gift-unconfirmed-test-secret';

/*
 * /api/sector/wanderer-gift spends a daily slot and the wanderer's cooldown
 * inside the save mutation, ahead of the payout write.
 *
 * A write that LOST its compare-and-set already handed both back (onConflict).
 * A write that threw a transport error and never landed did not: there was no
 * onUnconfirmedWrite, so the player lost the slot and the cooldown for a gift
 * that was never paid. The hook hands them back only when the stored save
 * provably still holds the version the decision read; a write that DID land
 * (acknowledgement lost, read-back unreadable) keeps them spent, so the gift
 * cannot be claimed twice.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const FIXED_NOW = Date.UTC(2026, 7, 22, 18, 0, 0);
const PREFIX = 'unconfgift';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let roster: typeof import('../../shared/wanderer-roster.js');
let gift: Handler;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    roster = await import('../../shared/wanderer-roster.js');
    gift = (await import('./wanderer-gift.js')).default as unknown as Handler;
});

async function cleanup() {
    for (const pattern of [`save:${PREFIX}*`, `ratelimit:*${PREFIX}*`, 'lock:*', `wanderer-*${PREFIX}*`, `ledger:*${PREFIX}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) if (player.name.startsWith(PREFIX)) onlineStore.remove(player.name);
}
beforeEach(cleanup);
after(async () => {
    await cleanup();
    mock.timers.reset();
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function claim(playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await gift({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.5.0.${playerName.length}` },
    } as never, res as never);
    return out;
}

function liveGiftWanderer() {
    const bucket = roster.wandererDayBucketFromMs(Date.now());
    for (let sector = 1; sector <= roster.WANDERER_SECTOR_COUNT; sector++) {
        const w = roster.rollWanderers(sector, bucket).find(candidate => candidate.verb === 'gift');
        if (w) return { w, sector };
    }
    throw new Error('no gift wanderer in the frozen window');
}

async function seed(playerName: string, sector: number) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: sector,
        character: {
            name: playerName, village: 'Leaf', level: 40, ryo: 5_000,
            hp: 40, maxHp: 100, chakra: 40, maxChakra: 100, stamina: 40, maxStamina: 100,
            fateShards: 0, boneCharms: 0, inventory: [], itemStacks: [],
        },
    });
    onlineStore.upsert({ name: playerName, sector, character: { name: playerName, hp: 100, maxHp: 100 } });
}

const ryoOf = async (name: string) => ((await kv.get<{ character: { ryo: number } }>(`save:${name}`))!.character.ryo);
const dayKey = (name: string) => `wanderer-gift:${name}:${new Date().toISOString().slice(0, 10)}`;

type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;
const writesSave = (ops: readonly KvCasOp[], name: string) => ops.some(op => op.key === `save:${name}`);

describe('wanderer-gift and a save write that cannot be confirmed', { concurrency: false }, () => {
    it('a write that fails without landing hands back the cooldown and the daily slot, so the retry is a fresh claim', async t => {
        const name = `${PREFIX}failed`;
        const { w, sector } = liveGiftWanderer();
        await seed(name, sector);
        const body = { sector, wandererId: w.id };
        const original = kv.compareSetMany!.bind(kv) as Many;
        let armed = true;
        t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
            if (armed && writesSave(ops, name)) { armed = false; throw new Error('socket hang up'); }
            return original(ops);
        });

        const failed = await claim(name, body);
        assert.equal(failed.statusCode, 500);
        assert.equal(await ryoOf(name), 5_000, 'nothing was paid');
        assert.equal(await kv.get(`wanderer-use:${name}:${w.id}`), null, 'the wanderer cooldown was handed back');
        assert.ok(!(await kv.get<number>(dayKey(name))), 'the daily slot was handed back');

        const retry = await claim(name, body);
        assert.equal(retry.body?.ok, true, JSON.stringify(retry.body));
        assert.ok((await ryoOf(name)) > 5_000);
    });

    it('a write that landed but cannot be read back keeps the claim spent, so the gift is never paid twice', async t => {
        const name = `${PREFIX}landed`;
        const { w, sector } = liveGiftWanderer();
        await seed(name, sector);
        const body = { sector, wandererId: w.id };
        const originalMany = kv.compareSetMany!.bind(kv) as Many;
        const originalGet = kv.get.bind(kv);
        let armed = true;
        let unreadable = false;
        t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
            const landed = await originalMany(ops);
            if (armed && writesSave(ops, name)) { armed = false; unreadable = true; throw new Error('ack lost'); }
            return landed;
        });
        // The commit's own read-back of the save fails once, so the write stays unconfirmed.
        t.mock.method(kv, 'get', async (key: string) => {
            if (unreadable && key === `save:${name}`) { unreadable = false; throw new Error('read-back down'); }
            return originalGet(key);
        });

        const first = await claim(name, body);
        assert.equal(first.statusCode, 500);
        const paid = await ryoOf(name);
        assert.ok(paid > 5_000, 'the write did land');
        assert.ok(await kv.get(`wanderer-use:${name}:${w.id}`), 'the cooldown stays spent');
        assert.equal(await kv.get<number>(dayKey(name)), 1, 'the daily slot stays spent');

        const retry = await claim(name, body);
        assert.equal(retry.body?.ok, false);
        assert.equal(retry.body?.reason, 'cooldown');
        assert.equal(await ryoOf(name), paid, 'no second payout');
    });
});
