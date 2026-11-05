import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'delete-settlements-admin';
process.env.SESSION_SECRET = 'delete-settlements-secret';

/*
 * Account deletion vs the shared rows that hold value: Sunscar Exchange
 * listings, PvP bounty heads, and Elder / ANBU seats. Names are reusable, so
 * each case ends by re-registering the deleted name and checking the newcomer
 * inherits nothing.
 *
 * The interactive DELETE /api/save/:name composes detachPlayerReferences; the
 * guest sweep calls deletePlayerAccount. Both paths are exercised.
 *
 * Real memory KV (not a mock), so the Exchange settlement code, the bounty
 * placement saga and the save commit path all run for real.
 */

type Obj = Record<string, any>;
let kv: typeof import('./_storage.js').kv;
let detachPlayerReferences: typeof import('./_delete-player-account.js').detachPlayerReferences;
let deletePlayerAccount: typeof import('./_delete-player-account.js').deletePlayerAccount;
let exchange: typeof import('./festival/_exchange.js');
let bountyHandler: (req: never, res: never) => Promise<unknown>;
let bountyShares: typeof import('./pvp/_bounty-deleted-target.js').bountyRefundShares;
let itemId: string;
let WAR_VILLAGES: readonly string[];
let elderCouncilKey: (village: unknown) => string;
let elderVillageKey: (village: unknown) => string;

const PLAYERS = ['wanderer', 'kaze', 'rival'];

function freshSave(name: string, extra: Obj = {}): Obj {
    return { _saveVersion: 1, character: { name, level: 100, ryo: 10_000, examsPassed: ['jonin'], inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {}, fateShards: 100, ...extra }, creatorItems: [] };
}
async function character(name: string): Promise<Obj> { return (await kv.get<Obj>(`save:${name}`))!.character; }
/** What registering the freed name again leaves behind: a brand-new save and credential. */
async function reRegister(name: string) {
    await kv.set(`save:${name}`, freshSave(name));
    await kv.set(`auth:${name}`, { hash: 'scrypt:new', salt: 'n', sessionEpoch: 9 });
}

async function placeBounty(placer: string, target: string, amount: number) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() {}, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() {} };
    await bountyHandler({ method: 'POST', headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' },
        body: { action: 'place', playerName: placer, target, amount, requestId: randomUUID() } } as never, res as never);
    assert.equal(out.status, 200, JSON.stringify(out.body));
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ detachPlayerReferences, deletePlayerAccount } = await import('./_delete-player-account.js'));
    exchange = await import('./festival/_exchange.js');
    bountyHandler = (await import('./pvp/bounty.js')).default as unknown as typeof bountyHandler;
    bountyShares = (await import('./pvp/_bounty-deleted-target.js')).bountyRefundShares;
    ({ WAR_VILLAGES } = await import('./_war-map-sectors.js'));
    ({ elderCouncilKey } = await import('./village/_elder-council.js'));
    ({ elderVillageKey } = await import('./village/_elders.js'));
    const items = (await (await import('./shop/_catalog.js')).loadSettlementCatalogs()).items;
    itemId = [...items.values()].find(item => item.slot === 'hand' && !item.serviceItem && !item.stackable)!.id;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const name of PLAYERS) await kv.set(`save:${name}`, freshSave(name, name === 'wanderer' ? { inventory: [itemId, itemId] } : {}));
    for (const name of ['kaze', 'rival']) await kv.set(`auth:${name}`, { hash: 'scrypt:owner', salt: name, sessionEpoch: 0 });
    await kv.set('auth:wanderer', { hash: 'scrypt:x', salt: 's', sessionEpoch: 0 });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
});

for (const path of ['guest sweep (deletePlayerAccount)', 'interactive delete (detachPlayerReferences)'] as const) {
    const remove = async (name: string) => {
        if (path.startsWith('guest')) return deletePlayerAccount(name);
        const result = await detachPlayerReferences(name);
        await kv.del(`save:${name}`); // the DELETE handler's own teardown
        return result;
    };

    describe(`account deletion settles shared rows: ${path}`, () => {
        it('voids the deleted seller\'s open Exchange listings so a reused name cannot reclaim the escrow', async () => {
            const fixed = await exchange.createExchangeListing('wanderer', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 500 });
            const auction = await exchange.createExchangeListing('wanderer', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 300, listingType: 'auction', durationHours: 24 });
            await exchange.actOnExchangeListing('rival', auction.id, 'bid', 400, 'ryo');
            assert.equal((await character('wanderer')).inventory.length, 0, 'both copies sit in escrow');

            const result = await remove('wanderer');
            assert.deepEqual(result.failures, []);
            for (const id of [fixed.id, auction.id]) {
                const stored = await kv.get<Obj>(exchange.exchangeListingKey(id));
                assert.equal(stored?.state, 'cancelled', 'an open listing must not outlive its seller');
                assert.ok(result.detached.includes(`sunscar-exchange:listing:${id}`));
            }
            assert.equal(await kv.hgetall('sunscar-exchange:player:wanderer'), null, 'the player index row goes');
            const live = await kv.hgetall<Obj>('sunscar-exchange:live') ?? {};
            assert.equal(fixed.id in live || auction.id in live, false, 'nothing of the seller stays on the market');

            await reRegister('wanderer');
            const cancelled = await exchange.actOnExchangeListing('wanderer', fixed.id, 'cancel');
            assert.equal(cancelled.state, 'cancelled');
            assert.deepEqual((await character('wanderer')).inventory, [], 'the newcomer receives no escrowed item');
            await assert.rejects(exchange.actOnExchangeListing('kaze', fixed.id, 'buy', 500, 'ryo'), /no longer available/);
            assert.equal((await character('kaze')).ryo, 10_000, 'no buyer pays into the reused name');
            assert.equal((await character('rival')).ryo, 10_000, 'a bid was never escrowed, so the bidder is whole');
        });

        it('withdraws the deleted player\'s high bid so a reused name is never charged for it', async () => {
            await kv.set('save:rival', freshSave('rival', { inventory: [itemId] }));
            const auction = await exchange.createExchangeListing('rival', { requestId: randomUUID(), kind: 'item', assetId: itemId, quantity: 1, price: 300, listingType: 'auction', durationHours: 24 });
            await exchange.actOnExchangeListing('wanderer', auction.id, 'bid', 450, 'ryo');

            const result = await remove('wanderer');
            assert.deepEqual(result.failures, []);
            const stored = await kv.get<Obj>(exchange.exchangeListingKey(auction.id));
            assert.equal(stored?.state, 'active', 'another seller\'s auction stays open');
            assert.equal(stored?.highestBid, undefined, 'the departed bid is withdrawn');
            await exchange.actOnExchangeListing('kaze', auction.id, 'bid', 310, 'ryo');
            assert.equal((await kv.get<Obj>(exchange.exchangeListingKey(auction.id)))?.highestBid?.player, 'kaze', 'the auction keeps taking bids');
        });

        it('takes a deleted target\'s bounty head down and refunds each backer their exact stake', async () => {
            await placeBounty('kaze', 'wanderer', 2_000);
            await placeBounty('rival', 'wanderer', 1_000);
            await placeBounty('kaze', 'wanderer', 1_500);
            const before = { kaze: (await character('kaze')).ryo, rival: (await character('rival')).ryo };
            assert.equal((await kv.get<Obj>('pvp:bounties'))?.bounties[0].amount, 4_500);

            const result = await remove('wanderer');
            assert.deepEqual(result.failures, []);
            const board = await kv.get<Obj>('pvp:bounties');
            assert.deepEqual(board?.bounties, [], 'the head leaves the board and frees its slot');
            assert.equal(board?.pendingClaims, undefined, 'no refund is left in flight');
            assert.equal((await character('kaze')).ryo, before.kaze + 3_500);
            assert.equal((await character('rival')).ryo, before.rival + 1_000);

            await reRegister('wanderer');
            const again = await detachPlayerReferences('wanderer');
            assert.deepEqual(again.failures, []);
            assert.equal((await character('kaze')).ryo, before.kaze + 3_500, 'a second deletion pays nobody twice');
        });

        it('keeps unproven bounty money pending without blocking account teardown', async () => {
            await kv.set('pvp:bounties', { bounties: [{ target: 'wanderer', amount: 3_001, contributors: ['kaze', 'rival'], updatedAt: 50 }] });
            const result = await remove('wanderer');
            assert.deepEqual(result.failures, []);
            assert.equal(await kv.get('save:wanderer'), null);
            const board = await kv.get<Obj>('pvp:bounties');
            assert.deepEqual(board?.bounties, []);
            const keys = await kv.keys('pvp:bounty-owner-refund:v1:*');
            assert.equal((await kv.get<Obj>(keys[0]))?.unresolvedAmount, 3_001);
            assert.equal(board?.pendingClaims, undefined);
            assert.equal((await character('kaze')).ryo, 10_000);
            assert.equal((await character('rival')).ryo, 10_000);
        });

        it('empties the deleted player\'s Elder and ANBU seats in every village', async () => {
            const [home, other] = WAR_VILLAGES;
            await kv.set(elderCouncilKey(home), { termStartedAt: 1, seats: ['Wanderer', 'Kaze', ''] });
            await kv.set(elderVillageKey(home), { seatedKage: 'Kaze', elderAppointees: ['wanderer', 'Rival'], anbuAppointees: ['Wanderer', 'Kaze'] });
            await kv.set(elderVillageKey(other), { anbuAppointees: ['Wanderer'] });
            await kv.set(elderCouncilKey(other), { termStartedAt: 2, seats: ['Rival'] });

            const result = await remove('wanderer');
            assert.deepEqual(result.failures, []);
            assert.deepEqual((await kv.get<Obj>(elderCouncilKey(home)))?.seats, ['', 'Kaze', '']);
            const homeState = await kv.get<Obj>(elderVillageKey(home));
            assert.deepEqual(homeState?.elderAppointees, ['', 'Rival']);
            assert.deepEqual(homeState?.anbuAppointees, ['', 'Kaze']);
            assert.equal(homeState?.seatedKage, 'Kaze', 'the rest of the leadership row is untouched');
            assert.deepEqual((await kv.get<Obj>(elderVillageKey(other)))?.anbuAppointees, ['']);
            assert.deepEqual((await kv.get<Obj>(elderCouncilKey(other)))?.seats, ['Rival'], 'other players keep their seats');
            assert.ok(result.detached.includes(`village-seats:${home}`));
        });
    });
}

describe('bounty refund shares', () => {
    const head = { target: 'Wanderer', amount: 3_000, contributors: ['kaze', 'rival'], updatedAt: 50 };

    it('returns the proven contribution amounts recorded on this head', () => {
        const { shares, exact } = bountyShares({ ...head, contributions: [{ owner: 'rival', ownerId: '11111111-1111-4111-8111-111111111111', amount: 1_000 }, { owner: 'kaze', ownerId: '22222222-2222-4222-8222-222222222222', amount: 2_000 }] });
        assert.equal(exact, true);
        assert.deepEqual(Object.fromEntries(shares), { rival: 1_000, kaze: 2_000 });
    });

    it('does not invent equal shares when the ownership amounts are unproven', () => {
        const { shares, exact } = bountyShares({ ...head, amount: 3_001 });
        assert.equal(exact, false);
        assert.deepEqual(Object.fromEntries(shares), {});
    });
});
