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
        version: 1 as const,
        playerName: player,
        requestId,
        sector,
        reward: { sector, ryo: 0, xp: 0 },
        outcome: { kind: 'chest', reservationDate: new Date().toISOString().slice(0, 10), reservationOrdinal: 1 },
        at,
    };
}

describe('world-reward:pending account mirror', () => {
    it('concurrent opens pay once while a delayed Explore request holds an older discovery snapshot', { timeout: 30_000 }, async t => {
        const player = 'pendmirrorconcurrent', requestId = 'concurrentchest01';
        const receipt = chestReceipt(player, requestId, 41);
        const key = `world-explore-receipt:${player}:${requestId}`;
        await seed(player, { serverChestDate: receipt.outcome.reservationDate, serverChestsToday: 1 });
        await kv.set(key, receipt);
        const original = kv.get.bind(kv);
        let captured = false, signalRead!: () => void, releaseRead!: () => void;
        const readStarted = new Promise<void>(resolve => { signalRead = resolve; });
        const resumeRead = new Promise<void>(resolve => { releaseRead = resolve; });
        t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
            const value = await original(...args);
            if (args[0] === key && !captured) {
                captured = true; signalRead(); await resumeRead;
            }
            return value;
        });
        const exploring = post(explore, player, { sector: 41, requestId, resolveOutcome: true });
        await readStarted;
        let saved: unknown;
        try {
            const opens = await Promise.all([1, 2].map(() => post(openChest, player, { sector: 41, requestId, worldExploreRequestId: requestId })));
            assert.ok(opens.every(out => out.statusCode === 200), JSON.stringify(opens));
            assert.deepEqual(opens.map(out => out.body?.replayed).sort(), [false, true]);
            saved = await original(`save:${player}`);
        } finally { releaseRead(); }
        const replay = await exploring;
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
        assert.deepEqual(await original(`save:${player}`), saved, 'the delayed discovery cannot pay or charge progress again');
        assert.equal((saved as { character: { serverChestsToday: number } }).character.serverChestsToday, 1);
    });

    for (const operation of ['proof', 'pending'] as const) for (const lostAck of [false, true]) {
        it(`${operation} ${lostAck ? 'lost acknowledgement' : 'write failure'} retries without a second chest payout`, async t => {
            const player = `pendmirror${operation}${lostAck ? 'ack' : 'failure'}`, requestId = 'failurechest001';
            const receipt = chestReceipt(player, requestId, 41);
            const key = `world-explore-receipt:${player}:${requestId}`;
            await seed(player, { serverChestDate: receipt.outcome.reservationDate, serverChestsToday: 1 });
            await kv.set(key, receipt);
            await pending.addPendingWorldReward(player, { kind: 'chest', requestId, sector: 41 });
            let injected = false;
            if (operation === 'proof') {
                const original = kv.set.bind(kv);
                t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
                    if (args[0] === key && !injected) {
                        injected = true;
                        if (lostAck) await original(...args);
                        throw new Error('injected payout proof failure');
                    }
                    return original(...args);
                });
            } else {
                const original = kv.del.bind(kv);
                t.mock.method(kv, 'del', async (...args: Parameters<typeof kv.del>) => {
                    if (args.includes(pending.pendingWorldRewardsKey(player)) && !injected) {
                        injected = true;
                        if (lostAck) await original(...args);
                        throw new Error('injected pending retirement failure');
                    }
                    return original(...args);
                });
            }
            const body = { sector: 41, requestId, worldExploreRequestId: requestId };
            const first = await post(openChest, player, body);
            assert.equal(first.statusCode, operation === 'proof' ? 503 : 200, JSON.stringify(first.body));
            assert.ok(injected);
            const paidSave = await kv.get(`save:${player}`);
            const retry = await post(openChest, player, body);
            assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
            assert.equal(retry.body?.replayed, true);
            assert.deepEqual(await kv.get(`save:${player}`), paidSave);
            assert.deepEqual(await pending.readPendingWorldRewards(player), []);
            assert.ok((await kv.get<{ outcome: { openedLoot: unknown } }>(key))?.outcome.openedLoot);
        });
    }

    for (const lostAck of [false, true]) {
        it(`discovery mirror ${lostAck ? 'lost acknowledgement' : 'write failure'} resumes its committed receipt`, async t => {
            const player = `pendmirrordiscovery${lostAck ? 'ack' : 'failure'}`, requestId = 'discoveryfailure01';
            const receipt = chestReceipt(player, requestId, 41);
            await seed(player, { serverChestDate: receipt.outcome.reservationDate, serverChestsToday: 1,
                redeemedSectorExplorations: [{ id: requestId, sector: 41, reward: receipt.reward, outcome: receipt.outcome, at: receipt.at }] });
            const saved = await kv.get(`save:${player}`), original = kv.set.bind(kv);
            let injected = false;
            t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
                if (args[0] === `world-explore-receipt:${player}:${requestId}` && !injected) {
                    injected = true;
                    if (lostAck) await original(...args);
                    throw new Error('injected discovery mirror failure');
                }
                return original(...args);
            });
            const body = { sector: 41, requestId, resolveOutcome: true };
            assert.equal((await post(explore, player, body)).statusCode, 503);
            const retry = await post(explore, player, body);
            assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
            assert.equal(retry.body?.replayed, true);
            assert.deepEqual(await kv.get(`save:${player}`), saved);
            assert.equal((await pending.readPendingWorldRewards(player)).length, 1);
        });
    }

    it('opening before the discovery mirror exists seals payout proof before a delayed Explore write', async () => {
        const player = 'pendmirrorearlyopen', requestId = 'earlyopenchest01';
        const receipt = chestReceipt(player, requestId, 41);
        await seed(player, { serverChestDate: receipt.outcome.reservationDate, serverChestsToday: 1,
            redeemedSectorExplorations: [{ id: requestId, sector: 41, reward: receipt.reward, outcome: receipt.outcome, at: receipt.at }] });
        const body = { sector: 41, requestId, worldExploreRequestId: requestId };
        const opened = await post(openChest, player, body);
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        const paid = await kv.get<{ outcome?: { openedLoot?: unknown } }>(`world-explore-receipt:${player}:${requestId}`);
        assert.ok(paid?.outcome?.openedLoot);
        assert.deepEqual(JSON.parse(JSON.stringify(paid.outcome.openedLoot)), JSON.parse(JSON.stringify(opened.body?.loot)));
        const saved = await kv.get(`save:${player}`);
        const { storeWorldExploreAuthority } = await import('./_store-explore-authority.js');
        await storeWorldExploreAuthority(receipt);
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId, sector: 41 });
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
        const replayed = await post(openChest, player, body);
        assert.equal(replayed.statusCode, 200);
        assert.equal(replayed.body?.replayed, true);
        assert.deepEqual(JSON.parse(JSON.stringify(replayed.body?.loot)), JSON.parse(JSON.stringify(opened.body?.loot)));
        assert.deepEqual(await kv.get(`save:${player}`), saved, 'no second reward, counter increment, or save write');
    });
    it('a delayed discovery persistence cannot overwrite a newer paid chest receipt', async () => {
        const { storeWorldExploreAuthority } = await import('./_store-explore-authority.js');
        const receipt = chestReceipt('pendmirrorauthority', 'paidchestproof01', 41);
        await storeWorldExploreAuthority(receipt);
        const paid = { ...receipt, outcome: { ...receipt.outcome, openedLoot: { xp: 0, ryo: 345, auraDust: 10 }, chestOpenedAt: Date.now() } };
        await storeWorldExploreAuthority(paid);
        assert.deepEqual(await storeWorldExploreAuthority(receipt), paid);
        assert.deepEqual(await kv.get(`world-explore-receipt:${receipt.playerName}:${receipt.requestId}`), paid);
    });
    it('a delayed exploration response cannot relist a chest that was already paid', async () => {
        const player = 'pendmirrordelayed';
        const requestId = 'delayedchest0001';
        const receipt = chestReceipt(player, requestId, 41);
        await kv.set(`world-explore-receipt:${player}:${requestId}`, {
            ...receipt, outcome: { ...receipt.outcome, openedLoot: { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 }, chestOpenedAt: Date.now() },
        });
        // /open-chest has finished. An older /explore response now reaches its
        // post-commit mirror write using the unopened receipt it read earlier.
        const listed = await pending.addPendingWorldReward(player, { kind: 'explore', requestId, sector: 41 });
        assert.deepEqual(listed, []);
        assert.deepEqual(await pending.readPendingWorldRewards(player), []);
    });
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

    it('a new chest on a full receipt list pays its own loot, not the row at its index', async () => {
        const player = 'pendmirrorfullcap', requestId = 'freshchestatcap1';
        const today = new Date().toISOString().slice(0, 10);
        const oldLoot = { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 };
        const fresh = chestReceipt(player, requestId, 41);
        await seed(player, {
            ryo: 1_000, serverChestDate: today, serverChestsToday: 1,
            redeemedAncientChests: [{ id: 'oldpaidchest0001', sector: 18, loot: oldLoot, at: 1 }],
            redeemedSectorExplorations: Array.from({ length: 150 }, (_, index) => ({
                id: `oldreceipt${String(index).padStart(5, '0')}`, sector: 18, at: index + 1, reward: { sector: 18, ryo: 0, xp: 0 },
                outcome: { kind: 'chest', openedLoot: oldLoot, chestOpenedAt: index + 1 },
            })),
        });
        // Exactly how /world/explore appends once the list is at its 150-row cap.
        const { mutatePlayerSave } = await import('../save/_mutate-player-save.js');
        const appended = await mutatePlayerSave(player, ({ character }) => ({
            ok: true as const, value: null,
            character: { ...character, redeemedSectorExplorations: [
                ...(character.redeemedSectorExplorations as unknown[]).slice(-149),
                { id: requestId, sector: 41, reward: fresh.reward, outcome: fresh.outcome, at: fresh.at },
            ] },
        }));
        assert.equal(appended.ok, true);
        const stored = (await kv.get<{ character: { redeemedSectorExplorations: Array<{ id: string; outcome: Record<string, unknown> }> } }>(`save:${player}`))!
            .character.redeemedSectorExplorations;
        assert.equal(stored.length, 150);
        assert.deepEqual(stored.at(-1)?.outcome, JSON.parse(JSON.stringify(fresh.outcome)), 'the appended receipt inherits nothing');
        const body = { sector: 41, requestId, worldExploreRequestId: requestId };
        const opened = await post(openChest, player, body);
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.equal(opened.body?.replayed, false, 'a fresh chest is a payout, not a saved receipt');
        const paid = await kv.get<{ character: { ryo: number; serverChestsToday: number } }>(`save:${player}`);
        assert.ok(paid!.character.ryo > 1_000);
        assert.equal(paid!.character.serverChestsToday, 1, 'opening spends no second daily slot');
        const replay = await post(openChest, player, body);
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual(await kv.get(`save:${player}`), paid, 'the replay pays and counts nothing');
    });

    it('the save read hides a paid chest whose mirror retirement failed, and keeps unpaid ones', async () => {
        const player = 'pendmirrorreadfilter', paidId = 'paidchestmirror01', unpaidId = 'unpaidchestmirror';
        await seed(player);
        await kv.set(`world-explore-receipt:${player}:${unpaidId}`, chestReceipt(player, unpaidId, 42));
        const receipt = chestReceipt(player, paidId, 41);
        await kv.set(`world-explore-receipt:${player}:${paidId}`, receipt);
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId: paidId, sector: 41 });
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId: unpaidId, sector: 42 });
        await kv.set(`world-explore-receipt:${player}:${paidId}`, {
            ...receipt, outcome: { ...receipt.outcome, openedLoot: { xp: 0, ryo: 345 }, chestOpenedAt: Date.now() },
        });
        assert.deepEqual((await pending.readPendingWorldRewards(player)).map((entry) => entry.requestId), [unpaidId]);
        const listed = (await getSave(player, player)).body?.pendingWorldRewards as Array<Record<string, unknown>>;
        assert.deepEqual(listed.map((entry) => entry.requestId), [unpaidId]);
    });

    it('an unreadable payout proof keeps the row, so an unpaid chest is never hidden', async t => {
        const player = 'pendmirrorreadfail', requestId = 'unreadablechest01';
        await pending.addPendingWorldReward(player, { kind: 'explore', requestId, sector: 41 });
        const original = kv.get.bind(kv);
        t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
            if (String(args[0]).startsWith('world-explore-receipt:')) throw new Error('injected read failure');
            return original(...args);
        });
        assert.deepEqual((await pending.readPendingWorldRewards(player)).map((entry) => entry.requestId), [requestId]);
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
