import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'war-tax-settlement-test-admin';
process.env.SESSION_SECRET = 'war-tax-settlement-test-secret-32-bytes!';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_VILLAGE_TAX;

/*
 * The daily occupation tax on the real assessment path and storage adapter.
 * The treasury share used to be credited after the debit, best-effort and
 * without failClosed: a failed credit lost the share for good (the day was
 * already stamped), and a contended village-row lock ran the credit UNLOCKED,
 * where it could overwrite another writer's change to that row.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Save = { _saveVersion?: number; character: { ryo: number; bankRyo?: number; lastTaxDate?: string } };

const PLAYER = 'taxedvillager';
const SAVE_KEY = `save:${PLAYER}`;
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const TODAY = '2026-09-26';

let kv: typeof import('./_storage.js').kv;
let tax: typeof import('./_war-tax-apply.js');
let kageKey: (village: string) => string;
let village: string;
let stateKey: string;
let reconcile: Handler;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    tax = await import('./_war-tax-apply.js');
    ({ kageKey } = await import('./village/_kage-settle.js'));
    const { villageWarSlug } = await import('./_war-state.js');
    reconcile = (await import('./admin/economy-reconcile.js')).default as unknown as Handler;
    village = (await import('./_war-map-sectors.js')).WAR_VILLAGES[0];
    stateKey = `game:village-state:${villageWarSlug(village)}`;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    // Nine sectors held: one past the home eight, the first taxed tier.
    for (let sector = 1; sector <= 9; sector += 1) {
        await kv.set(`world:territory:${sector}`, { ownerVillage: village });
    }
    await kv.set(kageKey(village), { kageSystemUnlocked: true, seatedKage: 'taxkage' });
    await kv.set(stateKey, { village, treasury: { ryo: 1_000 } });
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village, level: 50, ryo: 1_000_000, bankRyo: 0 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
});

async function balances(): Promise<{ ryo: number; treasury: number; lastTaxDate?: string }> {
    const save = await kv.get<Save>(SAVE_KEY);
    const state = await kv.get<{ treasury?: { ryo?: number } }>(stateKey);
    return { ryo: Number(save?.character.ryo), treasury: Number(state?.treasury?.ryo), lastTaxDate: save?.character.lastTaxDate };
}

describe('village tax: the treasury share settles exactly once', { concurrency: false }, () => {
    test('one assessment debits the player and credits the treasury share once, and a repeat moves nothing', async () => {
        const first = await tax.assessVillageTax(PLAYER, NOW);
        assert.equal(first.applied, true);
        assert.ok(first.toTreasury > 0);
        const after = await balances();
        assert.equal(after.ryo, 1_000_000 - first.taxed);
        assert.equal(after.treasury, 1_000 + first.toTreasury);
        assert.equal(after.lastTaxDate, TODAY);
        assert.equal(first.toBurn + first.toTreasury, first.taxed);

        const again = await tax.assessVillageTax(PLAYER, NOW);
        assert.equal(again.applied, false);
        assert.deepEqual(await balances(), after);
    });

    test('concurrent assessments tax once', async () => {
        const results = await Promise.all(Array.from({ length: 5 }, () => tax.assessVillageTax(PLAYER, NOW)));
        const applied = results.filter((r) => r.applied);
        assert.equal(applied.length, 1);
        const after = await balances();
        assert.equal(after.ryo, 1_000_000 - applied[0].taxed);
        assert.equal(after.treasury, 1_000 + applied[0].toTreasury);
    });

    test('a failed treasury write keeps the share owed, and the next assessment credits it once', async () => {
        const originalSet = kv.set.bind(kv);
        let armed = true;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (armed && key === stateKey) {
                armed = false;
                throw new Error('injected: village row write failed');
            }
            return originalSet(key, value, options as never);
        }) as typeof kv.set;
        let first;
        try {
            first = await tax.assessVillageTax(PLAYER, NOW);
        } finally {
            kv.set = originalSet;
        }
        assert.equal(first.applied, false, 'the call could not finish');
        const mid = await balances();
        assert.equal(mid.lastTaxDate, TODAY, 'the debit landed and stamped the day');
        assert.equal(mid.treasury, 1_000, 'the share has not arrived yet');
        const charged = 1_000_000 - mid.ryo;
        assert.ok(charged > 0);

        // Before the fix the share was simply gone: the day was stamped, so no
        // later assessment would touch it again.
        await tax.assessVillageTax(PLAYER, NOW + 60_000);
        const after = await balances();
        assert.equal(after.ryo, mid.ryo, 'not charged again');
        assert.ok(after.treasury > 1_000, 'the owed share arrived');
        const share = after.treasury - 1_000;
        await tax.assessVillageTax(PLAYER, NOW + 120_000);
        assert.equal((await balances()).treasury, 1_000 + share, 'and only once');
    });

    test('a contended village row is never written without its lock', async () => {
        await kv.set(`lock:${stateKey}`, 'another-writer', { nx: true, ex: 10 });
        const originalSet = kv.set.bind(kv);
        const unlockedWrites: string[] = [];
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (key === stateKey && (await kv.get(`lock:${stateKey}`)) === 'another-writer') unlockedWrites.push(key);
            return originalSet(key, value, options as never);
        }) as typeof kv.set;
        try {
            const result = await tax.assessVillageTax(PLAYER, NOW);
            assert.equal(result.applied, false, 'nothing is taxed while the row is busy');
        } finally {
            kv.set = originalSet;
            await kv.del(`lock:${stateKey}`);
        }
        assert.deepEqual(unlockedWrites, [], 'the old credit overwrote the village row while another writer held it');
        assert.deepEqual(await balances(), { ryo: 1_000_000, treasury: 1_000, lastTaxDate: undefined }, 'nothing moved');

        const later = await tax.assessVillageTax(PLAYER, NOW);
        assert.equal(later.applied, true, 'the next assessment taxes normally');
    });

    test('an administrator can finish a tax credit the player never triggers again', async () => {
        const originalSet = kv.set.bind(kv);
        let armed = true;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (armed && key === stateKey) {
                armed = false;
                throw new Error('injected: village row write failed');
            }
            return originalSet(key, value, options as never);
        }) as typeof kv.set;
        try {
            await tax.assessVillageTax(PLAYER, NOW);
        } finally {
            kv.set = originalSet;
        }
        const { saveDebitTransactionId } = await import('./_save-debit-saga.js');
        const txId = saveDebitTransactionId('village-tax', PLAYER, tax.villageTaxRequestId(village, TODAY));
        const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
        const res = {
            setHeader: () => res,
            status: (code: number) => { out.statusCode = code; return res; },
            json: (body: Record<string, unknown>) => { out.body = body; return res; },
            end: () => res,
        };
        await reconcile({
            method: 'POST',
            body: { txId },
            headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            socket: { remoteAddress: '127.0.0.3' },
        } as never, res as never);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.ok((await balances()).treasury > 1_000, 'the admin roll-forward credited the share');
    });

    test('a treasury credit that committed but reported an error is not credited twice', async () => {
        // The write lands, and the readback that would prove it fails too, so
        // the saga keeps the debit and leaves the credit to the next call.
        const originalSet = kv.set.bind(kv);
        const originalGet = kv.get.bind(kv);
        let armed = true;
        let blind = false;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (!armed || key !== stateKey) return originalSet(key, value, options as never);
            armed = false;
            await originalSet(key, value, options as never);
            blind = true;
            throw new Error('injected: village row write committed but timed out');
        }) as typeof kv.set;
        kv.get = (async (key: string) => {
            if (blind && key === stateKey) {
                blind = false;
                throw new Error('injected: readback failed');
            }
            return originalGet(key);
        }) as typeof kv.get;
        try {
            await tax.assessVillageTax(PLAYER, NOW);
        } finally {
            kv.set = originalSet;
            kv.get = originalGet;
        }
        const landed = await balances();
        assert.equal(landed.lastTaxDate, TODAY);
        assert.ok(landed.treasury > 1_000, 'the share landed');

        await tax.assessVillageTax(PLAYER, NOW + 60_000);
        assert.deepEqual(await balances(), landed, 'the next assessment finds its receipt and credits nothing more');
    });

    test('the tax endpoint taxes only the signed-in player', async () => {
        const { issuePlayerToken } = await import('./_auth.js');
        const endpoint = (await import('./village/tax.js')).default as unknown as Handler;
        await kv.set('save:taxforger', { _saveVersion: 1, character: { name: 'taxforger', village, level: 50, ryo: 0 } });
        const out: { statusCode: number } = { statusCode: 200 };
        const res = {
            setHeader: () => res,
            status: (code: number) => { out.statusCode = code; return res; },
            json: () => res,
            end: () => res,
        };
        await endpoint({
            method: 'POST',
            body: { playerName: PLAYER },
            headers: { 'x-player-name': 'taxforger', 'x-player-token': issuePlayerToken('taxforger') ?? '' },
            socket: { remoteAddress: '127.0.0.6' },
        } as never, res as never);
        assert.equal(out.statusCode, 403);
        assert.deepEqual(await balances(), { ryo: 1_000_000, treasury: 1_000, lastTaxDate: undefined });
    });

    test('a day with no treasury share only stamps the save, with no settlement journal', async () => {
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village, level: 50, ryo: 10, bankRyo: 0 } });
        const result = await tax.assessVillageTax(PLAYER, NOW);
        assert.equal(result.applied, false);
        assert.equal((await balances()).lastTaxDate, TODAY);
        assert.deepEqual(await kv.keys('economy-tx:village-tax-*'), []);
    });
});
