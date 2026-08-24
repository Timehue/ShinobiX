import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pending-world-rewards-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let pending: typeof import('./_pending-rewards.js');
let explore: Handler;
let openChest: Handler;
let saveHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    pending = await import('./_pending-rewards.js');
    explore = (await import('./explore.js')).default as unknown as Handler;
    openChest = (await import('./open-chest.js')).default as unknown as Handler;
    saveHandler = (await import('../save/[name].js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of ['save:pendmirror*', 'world-reward:pending:pendmirror*', 'world-explore-receipt:pendmirror*', 'ratelimit:*pendmirror*', 'lock:*pendmirror*', 'sector-pool:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
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

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.3.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

async function getSave(name: string, as: string, query: Record<string, string> = {}): Promise<Out> {
    const output = response();
    await saveHandler({
        method: 'GET',
        query: { name, ...query },
        headers: { 'x-player-name': as, 'x-player-token': issuePlayerToken(as) ?? '' },
        socket: { remoteAddress: '127.3.0.99' },
    } as never, output.res);
    return output.out;
}

async function seed(playerName: string, character: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 0,
        character: { name: playerName, level: 50, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, ryo: 0, inventory: [], itemStacks: [], ...character },
    });
}

function chestReceipt(player: string, requestId: string, sector: number, at = Date.now()) {
    return {
        version: 1,
        playerName: player,
        requestId,
        sector,
        reward: { sector, ryo: 0, xp: 0 },
        outcome: { kind: 'chest', reservationDate: new Date().toISOString().slice(0, 10), reservationOrdinal: 1 },
        at,
    };
}

describe('world-reward:pending account mirror', () => {
    it('adds, dedupes by request id, caps at 50 (oldest out), and removes on settle', async () => {
        const player = 'pendmirrorlist';
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId: 'firstrequest0001', sector: 41 });
        const dup = await pending.addPendingWorldReward(player, { kind: 'explore', requestId: 'firstrequest0001', sector: 42 });
        assert.equal(dup.length, 1);
        assert.equal(dup[0].sector, 42, 'a re-add refreshes the sector but keeps one row');
        const first = dup[0].createdAt;
        for (let index = 0; index < 60; index++) {
            await pending.addPendingWorldReward(player, { kind: index % 2 ? 'chest' : 'explore', requestId: `bulkrequest${String(index).padStart(5, '0')}`, sector: 1 + index });
        }
        const listed = await pending.readPendingWorldRewards(player);
        assert.equal(listed.length, pending.PENDING_WORLD_REWARD_CAP);
        assert.ok(!listed.some((entry) => entry.requestId === 'firstrequest0001'), 'oldest entry evicted past the cap');
        assert.equal(listed[0].requestId, 'bulkrequest00010');
        assert.ok(listed.every((entry) => entry.createdAt >= first));
        const stored = await kv.get<unknown[]>(pending.pendingWorldRewardsKey(player));
        assert.equal(stored?.length, pending.PENDING_WORLD_REWARD_CAP);
        const settled = await pending.settlePendingWorldReward(player, 'bulkrequest00030');
        assert.equal(settled.length, pending.PENDING_WORLD_REWARD_CAP - 1);
        assert.ok(!settled.some((entry) => entry.requestId === 'bulkrequest00030'));
        // Settling an unknown id is a no-op; settling the last one deletes the key.
        assert.equal((await pending.settlePendingWorldReward(player, 'neverlisted00001')).length, pending.PENDING_WORLD_REWARD_CAP - 1);
        for (const entry of settled) await pending.settlePendingWorldReward(player, entry.requestId);
        assert.equal(await kv.get(pending.pendingWorldRewardsKey(player)), null);
    });

    it('drops malformed and expired rows on read', () => {
        const now = Date.now();
        const cleaned = pending.cleanPendingWorldRewards([
            { kind: 'explore', requestId: 'validrequest0001', sector: 3, createdAt: now - 1000 },
            { kind: 'explore', requestId: 'validrequest0001', sector: 4, createdAt: now },
            { kind: 'bogus', requestId: 'validrequest0002', sector: 3, createdAt: now },
            { kind: 'chest', requestId: 'bad id', sector: 3, createdAt: now },
            { kind: 'chest', requestId: 'validrequest0003', sector: 0, createdAt: now },
            { kind: 'chest', requestId: 'validrequest0004', sector: 5, createdAt: now - pending.PENDING_WORLD_REWARD_MAX_AGE_MS - 1 },
            null,
            'junk',
        ], now);
        assert.deepEqual(cleaned, [{ kind: 'explore', requestId: 'validrequest0001', sector: 3, createdAt: now - 1000 }]);
        assert.deepEqual(pending.cleanPendingWorldRewards('nope'), []);
    });

    it('lists a durable unopened chest on explore replay and un-lists it once open-chest pays', async () => {
        const player = 'pendmirrorchest';
        const discoveryId = 'mirrorchestdisc01';
        await seed(player, { serverChestDate: new Date().toISOString().slice(0, 10), serverChestsToday: 1 });
        await kv.set(`world-explore-receipt:${player}:${discoveryId}`, chestReceipt(player, discoveryId, 60));
        // A cross-device replay of the exact receipt (no live presence needed)
        // surfaces the chest AND records it in the account mirror.
        const replay = await post(explore, player, { sector: 60, requestId: discoveryId, resolveOutcome: true });
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual(
            (await pending.readPendingWorldRewards(player)).map((entry) => [entry.kind, entry.requestId, entry.sector]),
            [['explore', discoveryId, 60]],
        );
        // The owner's save GET carries it; a foreign reader and combat scouting never see it.
        const own = await getSave(player, player);
        assert.equal(own.statusCode, 200);
        const carried = own.body?.pendingWorldRewards as Array<Record<string, unknown>>;
        assert.equal(carried?.length, 1);
        assert.equal(carried[0].requestId, discoveryId);
        assert.equal(carried[0].kind, 'explore');
        assert.equal(carried[0].sector, 60);
        assert.equal((await getSave(player, player, { combatOnly: '1' })).body?.pendingWorldRewards, undefined);
        await seed('pendmirrorother');
        const foreign = await getSave(player, 'pendmirrorother');
        assert.equal(foreign.statusCode, 200);
        assert.equal(foreign.body?.pendingWorldRewards, undefined);

        const opened = await post(openChest, player, { sector: 60, requestId: discoveryId, worldExploreRequestId: discoveryId });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.equal(opened.body?.replayed, false);
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
        const after = await getSave(player, player);
        assert.equal(after.body?.pendingWorldRewards, undefined, 'an empty mirror is omitted from the payload');
        // Replaying the explore after the chest is paid keeps it un-listed.
        const again = await post(explore, player, { sector: 60, requestId: discoveryId, resolveOutcome: true });
        assert.equal(again.statusCode, 200);
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
    });

    it('un-lists a stale non-chest entry when its explore is replayed', async () => {
        const player = 'pendmirrorstale';
        const requestId = 'mirrorstalereq001';
        await seed(player, {
            redeemedSectorExplorations: [{ id: requestId, sector: 44, reward: { sector: 44, ryo: 5, xp: 0 }, outcome: { kind: 'none' }, at: Date.now() }],
        });
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId, sector: 44 });
        const replay = await post(explore, player, { sector: 44, requestId, resolveOutcome: true });
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
    });
});
