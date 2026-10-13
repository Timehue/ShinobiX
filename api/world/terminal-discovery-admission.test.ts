import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, before, beforeEach, test, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'terminal-discovery-admission-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let petStart: Handler, dungeonRun: Handler, explore: Handler, openChest: Handler;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    petStart = (await import('../pet/encounter-start.js')).default as unknown as Handler;
    dungeonRun = (await import('../dungeon/run.js')).default as unknown as Handler;
    explore = (await import('./explore.js')).default as unknown as Handler;
    openChest = (await import('./open-chest.js')).default as unknown as Handler;
});
beforeEach(async () => {
    const keys = await kv.keys('*terminaladmit*');
    if (keys.length) await kv.del(...keys);
    for (const player of onlineStore.list()) if (player.name.startsWith('terminaladmit')) onlineStore.remove(player.name);
});
afterEach(() => mock.restoreAll());

async function post(handler: Handler, player: string, body: Record<string, unknown>) {
    const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; }, end: () => res };
    await handler({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': issuePlayerToken(player) ?? '' }, socket: { remoteAddress: '127.12.10.3' },
    } as never, res as never);
    return out;
}
const OLD_ID = 'oldpaidchest001';
const OLD_LOOT = { xp: 0, ryo: 345, itemId: 'rustfang-kunai', auraDust: 10 };
async function seed(player: string, level = 50) {
    const at = Date.now(), day = new Date(at).toISOString().slice(0, 10);
    await kv.set(`save:${player}`, { _saveVersion: 5, currentSector: 1, character: {
        name: player, level, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
        ryo: 75_062, auraDust: 105, inventory: ['rustfang-kunai'], itemStacks: [], tileCards: [],
        serverExploreDate: day, serverExploresToday: 33,
        redeemedAncientChests: [{ id: OLD_ID, sector: 1, loot: OLD_LOOT, at }],
    } });
    await kv.set(`pet-encounter-active:${player}`, { playerName: player, requestId: OLD_ID, outcome: 'miss', sector: 1, mintedAt: at });
    await kv.set(`pet-encounter-request:${player}:${OLD_ID}`, { version: 1, playerName: player, requestId: OLD_ID,
        day, sector: 1, mintedAt: at, resolvedAt: at, resolution: 'explored-miss', worldExploreRequestId: OLD_ID });
}

for (const level of [1, 50]) {
    test(`a fresh level-${level} discovery keeps its id after terminal-pointer cleanup`, async (t) => {
        // seed() dates serverExploreDate from Date.now(), and explore.ts reads
        // its own day from a no-argument `new Date()`. A run that straddles UTC
        // midnight between the two would restart the daily count, so the fresh
        // action would count as 1 instead of 34. Freeze Date (Date.now and new
        // Date alike) for the whole check.
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const player = `terminaladmit${level}`, id = 'brandnewexplore001';
        await seed(player, level);
        onlineStore.upsert({ name: player, sector: 1, character: { level }, tile: 5 });
        mock.method(crypto, 'randomInt', () => 999_999_999);
        mock.method(Math, 'random', () => 0.99);
        if (level >= 50) {
            const probe = await post(dungeonRun, player, { action: 'probe-free', sector: 1, requestId: id });
            assert.equal(probe.status, 200);
            assert.equal(probe.body?.requestId, id);
            assert.equal(probe.body?.handoff, undefined, 'completed pet authority must not redirect the fresh probe');
            assert.equal(probe.body?.found, false);
        }
        const pet = await post(petStart, player, { sector: 1, requestId: id });
        assert.equal(pet.status, 200);
        assert.equal(pet.body?.requestId, id);
        assert.equal(pet.body?.replayed, false);
        assert.equal(pet.body?.pet, null);
        const petRetry = await post(petStart, player, { sector: 1, requestId: id });
        assert.equal(petRetry.body?.requestId, id);
        assert.equal(petRetry.body?.replayed, true, 'lost ACK recovery must not mint another attempt');
        const tile = await post(explore, player, { sector: 1, requestId: id, resolveOutcome: true });
        assert.equal(tile.status, 200);
        assert.equal(tile.body?.replayed, false);
        assert.equal((tile.body?.outcome as Record<string, unknown>).kind, 'gather');
        const retry = await post(explore, player, { sector: 1, requestId: id, resolveOutcome: true });
        assert.equal(retry.body?.replayed, true);
        const character = retry.body?.character as Record<string, unknown>;
        assert.equal(character.serverExploresToday, 34, 'the fresh action counts once across retries');
        assert.equal(character.auraDust, 105);
        assert.equal((character.redeemedAncientChests as unknown[]).length, 1);
        const chest = await post(openChest, player, { sector: 1, requestId: 'oldchestretryop01', worldExploreRequestId: OLD_ID });
        assert.equal(chest.body?.replayed, true);
        assert.deepEqual(chest.body?.loot, OLD_LOOT);
        assert.equal((chest.body?.character as Record<string, unknown>).ryo, character.ryo, 'old chest retries still cannot pay twice');
    });
}

test('exact terminal pet retries replay without presence and admit no new search', async () => {
    const player = 'terminaladmitexact';
    await seed(player);
    // The pointer's exact id also remains sealed at the level-50 pipeline entry.
    // It must not mint a new dungeon probe before replaying the terminal pet row.
    const probe = await post(dungeonRun, player, { action: 'probe-free', sector: 66, requestId: OLD_ID });
    assert.equal(probe.status, 200);
    assert.equal(probe.body?.requestId, OLD_ID);
    assert.equal(probe.body?.handoff, 'pet');
    assert.equal((probe.body?.character as Record<string, unknown>).serverFreeDungeonProbesToday ?? 0, 0);
    for (let retry = 0; retry < 3; retry++) {
        const result = await post(petStart, player, { sector: 66, requestId: OLD_ID });
        assert.equal(result.status, 200);
        assert.equal(result.body?.requestId, OLD_ID);
        assert.equal(result.body?.resolved, true);
        assert.equal(result.body?.resolution, 'explored-miss');
    }
    assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
    assert.equal((await kv.keys(`pet-encounter-request:${player}:*`)).length, 1);
});

test('a terminal pet retry preserves a newer dungeon miss whose ACK was lost', async (t) => {
    // seed() dates serverExploreDate from Date.now(), and explore.ts reads its
    // own day from a no-argument `new Date()`. A run that straddles UTC
    // midnight between the two would restart the daily count, so the settled
    // exploration would count as 1 instead of 34. Freeze Date (Date.now and
    // new Date alike) for the whole check.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const player = 'terminaladmitinterleave', id = 'freshlostdungeon001';
    await seed(player);
    onlineStore.upsert({ name: player, sector: 1, character: { level: 50 }, tile: 5 });
    mock.method(crypto, 'randomInt', () => 999_999_999);
    mock.method(Math, 'random', () => 0.99);
    // A is committed but its response is lost before the client reaches pets.
    const admitted = await post(dungeonRun, player, { action: 'probe-free', sector: 1, requestId: id });
    assert.equal(admitted.status, 200);
    assert.equal(admitted.body?.requestId, id);
    assert.equal(admitted.body?.found, false);
    const savedA = await kv.get(`save:${player}`);
    // Retrying terminal X must not resolve A or change its save version.
    for (let retry = 0; retry < 2; retry++) {
        const terminal = await post(dungeonRun, player, { action: 'probe-free', sector: 66, requestId: OLD_ID });
        assert.equal(terminal.status, 200);
        assert.equal(terminal.body?.handoff, 'pet');
        assert.equal(terminal.body?.requestId, OLD_ID);
        assert.deepEqual(await kv.get(`save:${player}`), savedA, 'terminal X cannot consume another operation A');
    }
    const replayA = await post(dungeonRun, player, { action: 'probe-free', sector: 66, requestId: id });
    assert.equal(replayA.status, 200);
    assert.equal(replayA.body?.requestId, id);
    assert.equal(replayA.body?.sector, 1, 'the original probe sector stays sealed');
    assert.equal(replayA.body?.resolved, false, 'WorldMap must continue A instead of retiring it as settled');
    assert.equal((replayA.body?.character as Record<string, unknown>).serverFreeDungeonProbesToday, 1);
    const pet = await post(petStart, player, { sector: 1, requestId: id });
    assert.equal(pet.status, 200);
    assert.equal(pet.body?.requestId, id);
    const settledA = await post(explore, player, { sector: 1, requestId: id, resolveOutcome: true });
    assert.equal(settledA.status, 200);
    assert.equal(settledA.body?.replayed, false);
    assert.equal((settledA.body?.character as Record<string, unknown>).serverExploresToday, 34);
    const settledRetry = await post(explore, player, { sector: 1, requestId: id, resolveOutcome: true });
    assert.equal(settledRetry.body?.replayed, true);
    assert.equal((settledRetry.body?.character as Record<string, unknown>).serverExploresToday, 34);
});

test('a terminal pet handoff can still reconcile its own dungeon miss', async () => {
    const player = 'terminaladmitownmiss';
    await seed(player);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = save!.character as Record<string, unknown>;
    const at = Date.now(), day = new Date(at).toISOString().slice(0, 10);
    await kv.set(`save:${player}`, { ...save, character: { ...character,
        serverFreeDungeonProbeDate: day, serverFreeDungeonProbesToday: 1,
        serverFreeDungeonProbeReceipts: [{ requestId: OLD_ID, day, sector: 1, found: false, token: '', at }],
    } });
    const terminal = await post(dungeonRun, player, { action: 'probe-free', sector: 66, requestId: OLD_ID });
    assert.equal(terminal.status, 200);
    assert.equal(terminal.body?.handoff, 'pet');
    const receipts = (terminal.body?.character as Record<string, unknown>).serverFreeDungeonProbeReceipts as Array<Record<string, unknown>>;
    assert.equal(receipts[0].requestId, OLD_ID);
    assert.ok(receipts[0].resolvedAt, 'only the matching terminal discovery is reconciled');
    const saved = await kv.get(`save:${player}`);
    await post(dungeonRun, player, { action: 'probe-free', sector: 1, requestId: OLD_ID });
    assert.deepEqual(await kv.get(`save:${player}`), saved, 'repeating the terminal handoff writes nothing further');
});

test('terminal pointers do not bypass presence admission for a fresh request', async () => {
    const player = 'terminaladmitpresence';
    await seed(player);
    const probe = await post(dungeonRun, player, { action: 'probe-free', sector: 1, requestId: 'nopresencenew001' });
    assert.equal(probe.status, 409);
    assert.equal(probe.body?.reason, 'no-presence');
    const pet = await post(petStart, player, { sector: 1, requestId: 'nopresencenew001' });
    assert.equal(pet.status, 409);
    assert.equal(pet.body?.reason, 'no-presence');
    assert.equal(await kv.get(`pet-encounter-request:${player}:nopresencenew001`), null);
});

test('interrupted cleanup preserves the incoming fresh id until admission succeeds', async () => {
    const player = 'terminaladmitcleanup', id = 'cleanupfreshid001';
    await seed(player);
    onlineStore.upsert({ name: player, sector: 1, character: { level: 50 }, tile: 5 });
    mock.method(crypto, 'randomInt', () => 999_999_999);
    const originalDel = kv.del.bind(kv);
    let interruptions = 2;
    mock.method(kv, 'del', async (...keys: string[]) => {
        if (keys.includes(`pet-encounter-active:${player}`) && interruptions-- > 0) throw new Error('injected-cleanup-interruption');
        return originalDel(...keys);
    });
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await post(petStart, player, { sector: 1, requestId: id })).status, 500);
    const result = await post(petStart, player, { sector: 1, requestId: id });
    assert.equal(result.status, 200);
    assert.equal(result.body?.requestId, id);
    assert.equal(result.body?.replayed, false);
    assert.equal((await post(petStart, player, { sector: 1, requestId: id })).body?.replayed, true);
    assert.equal((await kv.keys(`pet-encounter-request:${player}:*`)).length, 2, 'one old receipt and one new attempt');
});
