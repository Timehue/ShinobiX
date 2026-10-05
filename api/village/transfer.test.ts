import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VILLAGE_TRANSFER_SCROLL_ID as SCROLL, VILLAGE_TRANSFER_STORY_PROGRESS, villageTransferUnlockError } from '../../shared/village-transfer.js';
import { purchaseCatalogItem } from '../shop/_purchase.js';
import { STORY_LEVELS } from '../story/_settle.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'village-transfer-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let purchase: Handler;
let kv: typeof import('../_storage.js').kv;
const PLAYER = 'transfertester';
const HOME = 'Stormveil Village';
const TARGET = 'Ashen Leaf Village';
const SAVE = `save:${PLAYER}`;
const KAGE = 'village:kage:stormveil-village';
const STATE = 'game:village-state:stormveilvillage';
const COUNCIL = 'village:elder-council:stormveilvillage';
const intent = { playerName: PLAYER, fromVillage: HOME, village: TARGET, requestId: 'transfer-request-00001' };
const character = (overrides: Record<string, unknown> = {}) => ({
    name: PLAYER, village: HOME, level: 100, storyProgress: 9, fateShards: 500,
    inventory: [SCROLL, 'keepsake'], villageMerit: 600, villageUpgrades: { shop: 45, bank: 20 },
    storyChoices: [{ id: 'keep-choice' }], clan: 'Kept Clan', ...overrides,
});
async function seed(overrides: Record<string, unknown> = {}) {
    await kv.set(SAVE, { _saveVersion: 4, currentSector: 0, character: character(overrides) });
}
async function readCharacter() { return (await kv.get<{ character: Record<string, any> }>(SAVE))!.character; }
async function post(body: Record<string, unknown>, target = handler, authenticated: boolean | Record<string, string> = true) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = {
        setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (body: Record<string, any>) => { out.body = body; return res; }, end: () => res,
    };
    const headers = typeof authenticated === 'object' ? authenticated : authenticated ? { 'x-admin-password': process.env.ADMIN_PASSWORD } : {};
    await target({ method: 'POST', body, headers, query: { name: PLAYER }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./transfer.js')).default as unknown as Handler;
    purchase = (await import('../shop/purchase.js')).default as unknown as Handler;
});
beforeEach(async () => {
    await seed();
    for (const key of [KAGE, `battle-lock:${PLAYER}`, `guard:${PLAYER}`, STATE, COUNCIL]) await kv.del(key);
    await kv.set('game:village-state:ashenleafvillage', { upgrades: { training: 8, shop: 3 } });
});

describe('village transfer scroll', { concurrency: false }, () => {
    it('uses the complete story milestone count and requires BOTH milestones', () => {
        assert.equal(VILLAGE_TRANSFER_STORY_PROGRESS, STORY_LEVELS.length);
        for (const fields of [{ level: 99 }, { storyProgress: 8 }, { level: NaN }, { storyProgress: Infinity }]) {
            assert.ok(villageTransferUnlockError(character(fields)));
            assert.equal(purchaseCatalogItem(character({ ...fields, inventory: [] }), SCROLL, 1).ok, false);
        }
        assert.equal(villageTransferUnlockError(character()), null);
    });
    it('costs exactly 250 shards even with discounts, requires funds, and permits only one held scroll', () => {
        const bought = purchaseCatalogItem(character({ inventory: [], elderFocus: 'trade' }), SCROLL, 99);
        assert.ok(bought.ok);
        assert.equal(bought.item.totalCost, 250);
        assert.equal(bought.character.fateShards, 250);
        assert.deepEqual(bought.character.inventory, [SCROLL]);
        assert.equal(purchaseCatalogItem(character({ inventory: [], fateShards: 249 }), SCROLL, 1).ok, false);
        assert.equal(purchaseCatalogItem(character(), SCROLL, 1).ok, false);
    });
    it('buys, chooses a village, consumes one scroll, and persists a versioned transfer', async () => {
        await seed({ inventory: ['keepsake'] });
        const buy = await post({ playerName: PLAYER, itemId: SCROLL, qty: 1, requestId: 'purchase-request-00001' }, purchase);
        assert.equal(buy.status, 200);
        const result = await post(intent);
        assert.equal(result.status, 200);
        assert.equal(result.body._saveVersion, 6);
        const saved = await readCharacter();
        assert.equal(saved.village, TARGET);
        assert.equal(saved.storyVillage, HOME);
        assert.equal(saved.level, 100);
        assert.equal(saved.storyProgress, 9);
        assert.deepEqual(saved.storyChoices, [{ id: 'keep-choice' }]);
        assert.equal(saved.clan, 'Kept Clan');
        assert.equal(saved.fateShards, 250);
        assert.deepEqual(saved.inventory, ['keepsake']);
        assert.equal(saved.villageUpgrades.shop, 3);
        assert.equal(saved.villageUpgrades.bank, 0);
        assert.equal(saved.villageMerit, 0);
        assert.equal((await kv.get<{ currentSector: number }>(SAVE))?.currentSector, 0);
    });
    it('enforces purchase eligibility and wallet limits through the actual endpoint without debiting on refusal', async () => {
        for (const fields of [{ level: 99 }, { storyProgress: 8 }, { fateShards: 249 }, { inventory: Array(500).fill('keepsake') }]) {
            await seed({ inventory: [], ...fields });
            const before = await readCharacter();
            const result = await post({ playerName: PLAYER, itemId: SCROLL, qty: 1, requestId: 'purchase-rejected-0001', level: 100, storyProgress: 9 }, purchase);
            assert.equal(result.status, 409);
            assert.deepEqual(await readCharacter(), before);
        }
    });
    it('replaying the purchase after using the scroll cannot grant a free replacement', async () => {
        await seed({ inventory: [] });
        const buy = { playerName: PLAYER, itemId: SCROLL, qty: 1, requestId: 'purchase-once-only-0001' };
        assert.equal((await post(buy, purchase)).status, 200);
        assert.equal((await post(intent)).status, 200);
        assert.equal((await post(buy, purchase)).status, 200);
        assert.deepEqual((await readCharacter()).inventory, []);
        assert.equal((await readCharacter()).fateShards, 250);
    });
    it('consumes exactly one scroll even when an existing save stores it in itemStacks', async () => {
        await seed({ inventory: ['keepsake'], itemStacks: [{ itemId: SCROLL, count: 2 }, { itemId: 'pet-treat', count: 3 }] });
        assert.equal((await post(intent)).status, 200);
        assert.deepEqual((await readCharacter()).inventory, ['keepsake']);
        assert.deepEqual((await readCharacter()).itemStacks, [{ itemId: SCROLL, count: 1 }, { itemId: 'pet-treat', count: 3 }]);
    });
    it('a stale or forged generic save cannot reverse the transfer or restore its consumed scroll', async () => {
        assert.equal((await post(intent)).status, 200);
        const stored = await readCharacter();
        const saveHandler = (await import('../save/[name].js')).default as unknown as Handler;
        process.env.SESSION_SECRET = 'transfer-save-protection-test';
        try {
            const { issuePlayerToken } = await import('../_auth.js');
            const headers = { 'x-player-token': issuePlayerToken(PLAYER)! };
            const stale = { _baseSaveVersion: 4, character: { ...stored, village: HOME, storyVillage: TARGET, inventory: [SCROLL, 'keepsake'] } };
            assert.equal((await post(stale, saveHandler, headers)).status, 409);
            const forged = await post({ ...stale, _baseSaveVersion: 5 }, saveHandler, headers);
            assert.equal(forged.status, 200);
            assert.equal((await readCharacter()).village, TARGET);
            assert.equal((await readCharacter()).storyVillage, HOME);
            assert.deepEqual((await readCharacter()).inventory, ['keepsake']);
        } finally { delete process.env.SESSION_SECRET; }
    });
    it('clears appointments and personal focus without disturbing other villagers', async () => {
        await seed({ elderFocus: 'trade' });
        await kv.set(STATE, { anbuAppointees: [PLAYER, 'other', ''], elderAppointees: [PLAYER, '', ''], treasury: { ryo: 500 } });
        await kv.set(COUNCIL, { version: 1, startedAt: Date.now(), nextSelectionAt: Date.now() + 86400000, seats: [PLAYER, 'other', ''], winningScores: [3, 4] });
        assert.equal((await post(intent)).status, 200);
        assert.equal((await readCharacter()).elderFocus, undefined);
        assert.deepEqual((await kv.get<Record<string, unknown>>(COUNCIL))?.seats, ['', 'other', '']);
        assert.deepEqual((await kv.get<Record<string, unknown>>(STATE))?.anbuAppointees, ['', 'other', '']);
        assert.deepEqual((await kv.get<Record<string, unknown>>(STATE))?.treasury, { ryo: 500 });
    });
    it('replays safely without another save, rejects reused ids for a different destination', async () => {
        const first = await post(intent);
        const replay = await post(intent);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.replayed, true);
        assert.equal(replay.body._saveVersion, first.body._saveVersion);
        assert.equal((await post({ ...intent, village: 'Frostfang Village' })).status, 409);
        assert.equal((await post({ ...intent, fromVillage: TARGET, village: HOME, requestId: 'transfer-request-00002' })).status, 409);
    });
    it('refuses forged eligibility, missing scrolls, and invalid or unchanged destinations without spending', async () => {
        for (const fields of [{ level: 99 }, { storyProgress: 8 }, { inventory: ['keepsake'] }]) {
            await seed(fields);
            const before = await readCharacter();
            assert.notEqual((await post({ ...intent, level: 100, storyProgress: 9, inventory: [SCROLL] })).status, 200);
            assert.deepEqual(await readCharacter(), before);
        }
        await seed();
        for (const village of [HOME, 'Fake Village', '__proto__']) assert.equal((await post({ ...intent, village })).status, 400);
        assert.deepEqual((await readCharacter()).inventory, [SCROLL, 'keepsake']);
    });
    it('requires authentication and blocks a seated Kage, guard duty, and active combat', async () => {
        assert.equal((await post(intent, handler, false)).status, 401);
        for (const [key, value] of [[KAGE, { seatedKage: PLAYER }], [KAGE, { challenge: { challenger: PLAYER } }], [`guard:${PLAYER}`, {}], [`battle-lock:${PLAYER}`, {}]] as const) {
            await kv.set(key, value);
            assert.equal((await post(intent)).status, 409);
            assert.deepEqual((await readCharacter()).inventory, [SCROLL, 'keepsake']);
            await kv.del(key);
        }
    });
    it('accepts the owning player session and rejects another player session', async () => {
        process.env.SESSION_SECRET = 'transfer-test-session-secret';
        try {
            const { issuePlayerToken } = await import('../_auth.js');
            const stranger = await post(intent, handler, { 'x-player-token': issuePlayerToken('stranger')!, 'x-player-name': 'stranger' });
            assert.equal(stranger.status, 403);
            assert.equal((await post(intent, handler, { 'x-player-token': issuePlayerToken(PLAYER)! })).status, 200);
        } finally { delete process.env.SESSION_SECRET; }
    });
    it('allows a later paid return while retaining the original story village', async () => {
        assert.equal((await post(intent)).status, 200);
        assert.equal((await post({ playerName: PLAYER, itemId: SCROLL, requestId: 'purchase-request-00002' }, purchase)).status, 200);
        const returned = await post({ ...intent, fromVillage: TARGET, village: HOME, requestId: 'transfer-request-00002' });
        assert.equal(returned.status, 200);
        const saved = await readCharacter();
        assert.equal(saved.village, HOME);
        assert.equal(saved.storyVillage, HOME);
        assert.equal(saved.storyProgress, 9);
        assert.equal(saved.fateShards, 250);
    });
    it('serializes competing destinations so one scroll can only fund one transfer', async () => {
        const results = await Promise.all([
            post(intent), post({ ...intent, village: 'Frostfang Village', requestId: 'transfer-request-00003' }),
        ]);
        assert.equal(results.filter(result => result.status === 200).length, 1);
        assert.deepEqual((await readCharacter()).inventory, ['keepsake']);
    });
    it('recovers a committed transfer when appointment cleanup fails, without consuming again', async () => {
        await kv.set(STATE, { anbuAppointees: [PLAYER, '', ''] });
        const originalSet = kv.set.bind(kv);
        let fail = true;
        kv.set = (async (key: string, value: unknown, options?: Parameters<typeof kv.set>[2]) => {
            if (key === STATE && fail) { fail = false; throw new Error('simulated appointment cleanup outage'); }
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            assert.equal((await post(intent)).status, 503);
            assert.equal((await readCharacter()).village, TARGET);
            assert.deepEqual((await readCharacter()).inventory, ['keepsake']);
            const replay = await post(intent);
            assert.equal(replay.status, 200);
            assert.equal(replay.body.replayed, true);
            assert.equal(replay.body._saveVersion, 5);
            assert.deepEqual((await kv.get<Record<string, unknown>>(STATE))?.anbuAppointees, ['', '', '']);
        } finally { kv.set = originalSet; }
    });
});
