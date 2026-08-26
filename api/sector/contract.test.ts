/*
 * Handler integration for /api/sector/contract.
 *
 * The pure board logic and the status folding have their own unit tests; what
 * this pins is that the parts are actually WIRED — the real handler, the real
 * release flag, the real KV keys, the real save lock, the real payout. Every
 * assertion below runs the shipped code path against the in-memory KV backend
 * (the same one scripts/release-certification.mjs uses), so it needs no
 * database and no secrets.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contractSectorsForDay, sectorContractFor, utcDayOf } from '../../shared/sector-contracts.js';
import { WILD_SECTOR_IDS } from '../../shared/sector-geo.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-contract-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let contractProgressKey: typeof import('../_sector-contracts.js').contractProgressKey;
let contractClaimKey: typeof import('../_sector-contracts.js').contractClaimKey;

const PLAYER = 'contractor';
const SAVE_KEY = `save:${PLAYER}`;
const DAY = utcDayOf(Date.now());
const BOARD = contractSectorsForDay(DAY);
const POSTED = BOARD[0];
const UNPOSTED = WILD_SECTOR_IDS.find((sector) => !BOARD.includes(sector))!;
const CONTRACT = sectorContractFor(POSTED, DAY)!;
const START_RYO = 1_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ contractProgressKey, contractClaimKey } = await import('../_sector-contracts.js'));
    handler = (await import('./contract.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(SAVE_KEY, { character: { name: PLAYER, ryo: START_RYO }, _saveVersion: 1 });
    await kv.del(contractProgressKey(PLAYER, POSTED, DAY));
    await kv.del(contractClaimKey(PLAYER, POSTED, DAY));
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(method: 'GET' | 'POST', payload: Record<string, unknown>) {
    return {
        method,
        body: method === 'POST' ? payload : undefined,
        query: method === 'GET' ? payload : undefined,
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function call(method: 'GET' | 'POST', payload: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(method, payload), res);
    return out;
}

async function ryoOnSave(): Promise<number> {
    const record = await kv.get<Record<string, unknown>>(SAVE_KEY);
    return Number((record?.character as Record<string, unknown> | undefined)?.ryo ?? 0);
}

describe('/api/sector/contract', () => {
    it('serves the shared board verbatim for a posted sector', async () => {
        const out = await call('GET', { playerName: PLAYER, sector: POSTED });
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.contract, CONTRACT);
        assert.equal(out.body?.progress, 0);
        assert.equal(out.body?.claimable, false);
    });

    it('reports no contract on an unposted sector', async () => {
        const out = await call('GET', { playerName: PLAYER, sector: UNPOSTED });
        assert.equal(out.body?.contract, null);
        assert.equal(out.body?.claimable, false);
    });

    it('refuses a claim before the work is done, and pays nothing', async () => {
        await kv.set(contractProgressKey(PLAYER, POSTED, DAY), CONTRACT.target - 1);
        const out = await call('POST', { playerName: PLAYER, sector: POSTED });
        assert.equal(out.body?.ok, false);
        assert.equal(out.body?.reason, 'incomplete');
        assert.equal(await ryoOnSave(), START_RYO);
    });

    it('pays the sealed bounty once the work is done, and echoes the save version', async () => {
        await kv.set(contractProgressKey(PLAYER, POSTED, DAY), CONTRACT.target);
        const out = await call('POST', { playerName: PLAYER, sector: POSTED });
        assert.equal(out.body?.ok, true);
        assert.equal(out.body?.ryo, CONTRACT.ryo);
        assert.equal(out.body?.totalRyo, START_RYO + CONTRACT.ryo);
        assert.equal(await ryoOnSave(), START_RYO + CONTRACT.ryo, 'the payout must reach the save');
        // ryo is client-owned: without the echo the next autosave undoes the bounty.
        assert.ok(Number(out.body?._saveVersion) > 1, 'the committed save version must be echoed');
    });

    it('pays exactly once — a replayed claim is refused and mints nothing', async () => {
        await kv.set(contractProgressKey(PLAYER, POSTED, DAY), CONTRACT.target);
        await call('POST', { playerName: PLAYER, sector: POSTED });
        const paid = await ryoOnSave();

        const second = await call('POST', { playerName: PLAYER, sector: POSTED });
        assert.equal(second.body?.ok, false);
        assert.equal(second.body?.reason, 'already-claimed');
        assert.equal(await ryoOnSave(), paid);
    });

    it('never pays from the request body — a forged reward is ignored', async () => {
        await kv.set(contractProgressKey(PLAYER, POSTED, DAY), CONTRACT.target);
        const out = await call('POST', {
            playerName: PLAYER,
            sector: POSTED,
            ryo: 9_999_999,
            target: 1,
            contract: { ryo: 9_999_999, target: 1 },
            day: '1999-01-01',
        });
        assert.equal(out.body?.ryo, CONTRACT.ryo, 'the payout is recomputed from the sealed sector and day');
        assert.equal(await ryoOnSave(), START_RYO + CONTRACT.ryo);
    });

    it('refuses a claim on a sector carrying no contract', async () => {
        const out = await call('POST', { playerName: PLAYER, sector: UNPOSTED });
        assert.equal(out.body?.ok, false);
        assert.equal(out.body?.reason, 'no-contract');
        assert.equal(await ryoOnSave(), START_RYO);
    });

    it('rejects a malformed sector rather than guessing one', async () => {
        for (const sector of ['', 'abc', 0, -3]) {
            const out = await call('GET', { playerName: PLAYER, sector });
            assert.equal(out.statusCode, 400, `sector ${JSON.stringify(sector)}`);
        }
    });

    it('404s while the incident valve is set, and settles nothing', async () => {
        await kv.set(contractProgressKey(PLAYER, POSTED, DAY), CONTRACT.target);
        process.env.DISABLE_SECTOR_CONTRACTS = '1';
        try {
            assert.equal((await call('GET', { playerName: PLAYER, sector: POSTED })).statusCode, 404);
            assert.equal((await call('POST', { playerName: PLAYER, sector: POSTED })).statusCode, 404);
            assert.equal(await ryoOnSave(), START_RYO, 'a disabled feature must not settle');
        } finally {
            delete process.env.DISABLE_SECTOR_CONTRACTS;
        }
    });
});
