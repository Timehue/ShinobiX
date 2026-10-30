import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, test } from 'node:test';
import { contractSectorsForDay, sectorContractFor } from '../../shared/sector-contracts.js';
import { WORLD_HOUR_MS } from '../../shared/world-clock.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'contract-effects-retry-secret';
let kv: typeof import('../_storage.js').kv;
let effects: typeof import('./_effects-outbox.js');
let contracts: typeof import('../_sector-contracts.js');
before(async () => {
    ({ kv } = await import('../_storage.js'));
    effects = await import('./_effects-outbox.js');
    contracts = await import('../_sector-contracts.js');
});
const day = '2026-08-26';
const midnight = Date.UTC(2026, 7, 26);
const sector = contractSectorsForDay(day).find(id => sectorContractFor(id, day)!.nightOnly)!;

test('a delayed contract effect keeps the discovery day and night window', async t => {
    const player = 'contractdelay', at = midnight + 23 * WORLD_HOUR_MS;
    let now = at;
    t.mock.method(Date, 'now', () => now);
    const effect = { kind: 'contract' as const, requestId: 'night-discovery-001', sector, at };
    await effects.parkWorldEffect(player, effect);
    now = midnight + 86_400_000 + 12 * WORLD_HOUR_MS;
    assert.equal(await effects.drainWorldEffects(player), 1);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
    assert.equal((await contracts.readSectorContractStatus(player, sector, now)).progress, 0);
});

test('a lost outbox removal acknowledgment cannot tick the same contract twice', async t => {
    const player = 'contractremove', at = midnight + 23 * WORLD_HOUR_MS;
    t.mock.method(Date, 'now', () => at);
    const effect = { kind: 'contract' as const, requestId: 'remove-ack-001', sector, at };
    await effects.parkWorldEffect(player, effect);
    const originalDel = kv.del.bind(kv);
    let fail = true;
    t.mock.method(kv, 'del', async (...keys: string[]) => {
        if (fail && keys.includes(effects.worldEffectsOutboxKey(player))) { fail = false; throw new Error('outbox removal unavailable'); }
        return originalDel(...keys);
    });
    await effects.drainWorldEffects(player);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
    await effects.drainWorldEffects(player);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
});

test('a committed progress write with a lost acknowledgment replays once under concurrent drains', async t => {
    const player = 'contractwriteack', at = midnight + 23 * WORLD_HOUR_MS;
    t.mock.method(Date, 'now', () => at);
    const effect = { kind: 'contract' as const, requestId: 'progress-ack-001', sector, at };
    const key = contracts.contractProgressKey(player, sector, day);
    await kv.set(key, 3); // Upgrade an existing numeric counter without losing it.
    const originalSet = kv.set.bind(kv);
    let fail = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const result = await originalSet(...args);
        if (fail && args[0] === key) { fail = false; throw new Error('progress acknowledgment lost'); }
        return result;
    });
    assert.equal(await effects.deliverWorldEffect(player, effect), 'parked');
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 4);
    await Promise.all([effects.drainWorldEffects(player), effects.drainWorldEffects(player)]);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 4);
    assert.equal(await kv.get(effects.worldEffectsOutboxKey(player)), null);
});

test('legacy effects recover their original time from discovery; missing proof stays pending', async t => {
    const at = midnight + 23 * WORLD_HOUR_MS;
    t.mock.method(Date, 'now', () => midnight + 86_400_000);
    const player = 'contractlegacy', requestId = 'legacy-discovery-001';
    await kv.set(`save:${player}`, { character: { redeemedSectorExplorations: [{ id: requestId, sector, at }] } });
    await effects.parkWorldEffect(player, { kind: 'contract', requestId, sector });
    assert.equal(await effects.drainWorldEffects(player), 1);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
    await effects.parkWorldEffect(player, { kind: 'contract', requestId: 'missing-discovery-001', sector });
    assert.equal(await effects.drainWorldEffects(player), 0);
    assert.equal(effects.parseWorldEffects(await kv.get(effects.worldEffectsOutboxKey(player))).length, 1);
});

test('daylight work retried at night does not acquire night-contract eligibility', async t => {
    const player = 'contractdaylight', at = midnight + 12 * WORLD_HOUR_MS;
    t.mock.method(Date, 'now', () => midnight + 23 * WORLD_HOUR_MS);
    await effects.parkWorldEffect(player, { kind: 'contract', requestId: 'daylight-discovery-001', sector, at });
    assert.equal(await effects.drainWorldEffects(player), 1);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 0);
});

test('an old discovery cannot recreate a contract counter after deduplication expires', async t => {
    const player = 'contractexpired', at = midnight + 23 * WORLD_HOUR_MS;
    let now = at;
    t.mock.method(Date, 'now', () => now);
    const effect = { kind: 'contract' as const, requestId: 'expired-discovery-001', sector, at };
    await effects.applyWorldEffect(player, effect);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
    now += 5 * 86_400_000;
    assert.equal(await kv.get(contracts.contractProgressKey(player, sector, day)), null);
    await effects.applyWorldEffect(player, effect);
    assert.equal(await kv.get(contracts.contractProgressKey(player, sector, day)), null);
});

for (const failOutbox of [false, true]) {
test(`a new chest and paid 345-ryo replay keep separate counters through ${failOutbox ? 'lost delivery and outbox writes' : 'contract delivery failure'}`, async t => {
    const player = `contractchestflow${failOutbox ? 'lost' : 'parked'}`, at = midnight + 23 * WORLD_HOUR_MS;
    t.mock.timers.enable({ apis: ['Date'], now: at });
    t.mock.method(crypto, 'randomInt', () => 0);
    const { issuePlayerToken } = await import('../_auth.js');
    const { onlineStore } = await import('../_realtime/online-store.js');
    type Handler = (req: never, res: never) => Promise<unknown>;
    const explore = (await import('./explore.js')).default as unknown as Handler;
    const openChest = (await import('./open-chest.js')).default as unknown as Handler;
    const oldId = 'old-paid-345-001', requestId = 'new-contract-chest-001';
    const oldLoot = { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 };
    await kv.set(`save:${player}`, { _saveVersion: 1, currentSector: sector, character: {
        name: player, level: 50, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
        ryo: 75062, auraDust: 105, inventory: ['rustfang-kunai'], itemStacks: [], tileCards: [],
        serverExploreDate: day, serverExploresToday: 33, serverChestDate: day, serverChestsToday: 1,
        redeemedAncientChests: [{ id: oldId, sector, loot: oldLoot, at: at - 1000 }],
        redeemedSectorExplorations: [{ id: oldId, sector, reward: { sector, ryo: 0, xp: 0 },
            outcome: { kind: 'chest', openedLoot: oldLoot }, at: at - 1000 }],
    } });
    onlineStore.upsert({ name: player, sector, character: { level: 50 }, tile: 5 });
    t.after(() => onlineStore.remove(player));
    const post = async (handler: typeof explore, body: Record<string, unknown>) => {
        const out = { status: 200, body: {} as Record<string, any> };
        const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
            json: (body: Record<string, unknown>) => { out.body = body; return res; }, end: () => res };
        await handler({ method: 'POST', body: { playerName: player, ...body }, headers: { 'x-player-token': issuePlayerToken(player) },
            socket: { remoteAddress: '127.15.1.1' } } as never, res as never);
        assert.equal(out.status, 200, JSON.stringify(out.body));
        return out.body;
    };
    const historical = await post(explore, { sector, requestId: oldId, resolveOutcome: true });
    assert.equal(historical.replayed, true);
    assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 0,
        'an unmarked historical receipt must not receive a retroactive tick');
    const originalSet = kv.set.bind(kv);
    let failCredit = true, failParking = failOutbox;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (failCredit && args[0] === contracts.contractProgressKey(player, sector, day)) {
            failCredit = false; throw new Error('contract counter temporarily unavailable');
        }
        if (failParking && args[0] === effects.worldEffectsOutboxKey(player)) {
            failParking = false; throw new Error('outbox write unavailable');
        }
        return originalSet(...args);
    });
    const discovered = await post(explore, { sector, requestId, resolveOutcome: true });
    assert.equal(discovered.replayed, false);
    assert.equal(discovered.outcome.kind, 'chest');
    assert.equal(discovered.character.serverExploresToday, 34);
    assert.equal(discovered.character.serverChestsToday, 2, 'discovery reserves one chest slot');
    assert.equal(discovered.character.ryo, 75062);
    assert.equal(effects.parseWorldEffects(await kv.get(effects.worldEffectsOutboxKey(player)))[0]?.kind, failOutbox ? undefined : 'contract');
    const opened = await post(openChest, { sector, requestId: 'new-open-operation-001', worldExploreRequestId: requestId });
    assert.equal(opened.replayed, false);
    assert.equal(opened.character.ryo, 75062 + opened.loot.ryo);
    const paid = opened.character.ryo;
    const originalDel = kv.del.bind(kv);
    let failRemove = true;
    t.mock.method(kv, 'del', async (...keys: string[]) => {
        if (failRemove && keys.includes(effects.worldEffectsOutboxKey(player))) {
            failRemove = false; throw new Error('outbox retirement unavailable');
        }
        return originalDel(...keys);
    });
    for (let retry = 0; retry < 2; retry++) {
        const replay = await post(explore, { sector, requestId, resolveOutcome: true });
        assert.equal(replay.replayed, true);
        assert.equal(replay.character.serverExploresToday, 34);
        assert.equal(replay.character.serverChestsToday, 2);
        assert.equal(replay.character.ryo, paid);
        assert.equal((await contracts.readSectorContractStatus(player, sector, at)).progress, 1);
        const old = await post(openChest, { sector, requestId: 'old-open-operation-001', worldExploreRequestId: oldId });
        assert.equal(old.replayed, true);
        assert.deepEqual(old.loot, oldLoot);
        assert.equal(old.character.ryo, paid);
        assert.equal(old.character.serverChestsToday, 2);
        // A later retry must retain delivery proof even after the save's bounded
        // discovery list compacts: the durable receipt is now the only authority.
        const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...saved, character: { ...saved!.character as object, redeemedSectorExplorations: [] } });
    }
});
}
