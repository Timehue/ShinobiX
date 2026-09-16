import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'dungeon-probe-handler-isolated-test-secret';

type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let handler: (req: never, res: never) => Promise<unknown>;
let sequence = 0;
let player: string;
const requestId = 'dungeonrecoveryprobe01';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    handler = (await import('./run.js')).default as unknown as typeof handler;
});

beforeEach(async () => {
    player = `dungeonproberecovery${++sequence}`;
    await seed();
});

async function seed(character: Json = {}) {
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 50, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
        inventory: [], itemStacks: [], ...character,
    } });
}

async function probe(options: { loseSuccessResponse?: boolean } = {}) {
    const output = { status: 200, body: {} as Json, committed: null as Json | null };
    let loseSuccess = options.loseSuccessResponse;
    const response = {
        setHeader: () => response,
        status: (status: number) => { output.status = status; return response; },
        json: (body: Json) => {
            if (loseSuccess && output.status === 200) {
                loseSuccess = false;
                output.committed = structuredClone(body);
                throw new Error('Injected lost dungeon probe acknowledgement.');
            }
            output.body = body;
            return response;
        },
        end: () => response,
    };
    await handler({ method: 'POST', body: { playerName: player, action: 'probe-free', sector: 33, requestId },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '203.0.113.121' },
    } as never, response as never);
    return output;
}

async function storedCharacter(): Promise<Json> {
    return (await kv.get<Json>(`save:${player}`))!.character as Json;
}

function bePresent(sector = 33) {
    onlineStore.upsert({ name: player, sector, tile: 5, character: { level: 50 } });
}

test('no-presence retains its retry reason and spends nothing until presence is ready', async () => {
    const absent = await probe();
    assert.equal(absent.status, 409);
    assert.equal(absent.body.reason, 'no-presence');
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, undefined);
    bePresent();
    const recovered = await probe();
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.requestId, requestId);
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, 1);
});

test('sector mismatch is distinct from transient presence startup', async () => {
    bePresent(34);
    const refused = await probe();
    assert.equal(refused.status, 409);
    assert.equal(refused.body.reason, 'sector-mismatch');
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, undefined);
});

test('daily cap explains its reset and still permits recovery of an existing receipt', async () => {
    const at = Date.now();
    const day = new Date(at).toISOString().slice(0, 10);
    const capped = { serverFreeDungeonProbeDate: day, serverFreeDungeonProbesToday: 150,
        serverExploreDate: day, serverExploresToday: 150 };
    await seed(capped);
    bePresent();
    const refused = await probe();
    assert.equal(refused.status, 409);
    assert.equal(refused.body.reason, 'daily-limit');
    assert.match(String(refused.body.error), /midnight UTC/);
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, 150);
    await seed({ ...capped, serverFreeDungeonProbeReceipts: [{ requestId, day, sector: 27, found: false, token: '', at }] });
    onlineStore.remove(player);
    const replay = await probe();
    assert.equal(replay.status, 200);
    assert.equal(replay.body.requestId, requestId);
    assert.equal(replay.body.sector, 27);
    assert.equal(replay.body.found, false);
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, 150);
});

test('an unearned probe explains prior exploration without claiming a daily cap', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await seed({ serverFreeDungeonProbeDate: day, serverFreeDungeonProbesToday: 1,
        serverExploreDate: day, serverExploresToday: 0 });
    bePresent();
    const refused = await probe();
    assert.equal(refused.status, 409);
    assert.equal(refused.body.reason, 'dungeon-probe-not-earned');
    assert.match(String(refused.body.error), /previous exploration/);
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, 1);
});

test('contention reports retryable busy and never mints a dungeon without the save lock', async () => {
    bePresent();
    await kv.set(`lock:save:${player}`, 'other-request', { ex: 30 });
    try {
        const busy = await probe();
        assert.equal(busy.status, 503);
        assert.equal(busy.body.reason, 'busy');
        assert.equal(busy.body.retryable, true);
        assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, undefined);
    } finally { await kv.del(`lock:save:${player}`); }
    assert.equal((await probe()).status, 200);
    assert.equal((await storedCharacter()).serverFreeDungeonProbesToday, 1);
});

test('lost response replays the committed discovery without another daily attempt', async () => {
    bePresent();
    const lost = await probe({ loseSuccessResponse: true });
    assert.equal(lost.status, 500);
    assert.ok(lost.committed);
    onlineStore.remove(player);
    const recovered = await probe();
    assert.equal(recovered.status, 200);
    for (const field of ['requestId', 'found', 'token', 'sector']) {
        assert.deepEqual(recovered.body[field], lost.committed[field], field);
    }
    const saved = await storedCharacter();
    assert.equal(saved.serverFreeDungeonProbesToday, 1);
    assert.equal((saved.serverFreeDungeonProbeReceipts as unknown[]).length, 1);
});
