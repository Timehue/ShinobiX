import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import type { HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;
delete process.env.ENABLE_LEGACY;
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Character = Record<string, unknown>;
type Save = { _saveVersion: number; character: Character };
type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let credits: typeof import('./_external-credits.js');

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    credits = await import('./_external-credits.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, name: string, body: Record<string, unknown>): Promise<Response> {
    const token = issuePlayerToken(name);
    assert.ok(token);
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { ...body, playerName: name }, query: { name },
        headers: { 'x-player-name': name, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

async function preparedRun(label: string) {
    const name = `hgintegration${label}`;
    const token = `integration-token-${label}`;
    const runKey = `hg-run:${name}:${token}`;
    const saveKey = `save:${name}`;
    const { HG_CLAWBACK_KEYS } = await import('./_run-token.js');
    const wallets = (n: number) => Object.fromEntries(HG_CLAWBACK_KEYS.map(key => [key, n]));
    const run: HollowGateRunToken = {
        playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
        seed: label, entryCurrencies: wallets(1000), entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: wallets(200), items: {}, sourceIds: ['prepared-server-reward'] },
        resolvedEventIds: [], recentConsumableIds: [],
    };
    const initial: Character = {
        name, level: 20, hp: 500, maxHp: 500, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        ...wallets(1200), inventory: [], itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }],
        hollowGateRun: { runToken: token, currentFloor: 1 },
        lastHollowGateStart: { requestId: `original-start-${label}`, token, at: Date.now() - 240_000 },
    };
    const character = credits.recordHollowGateExternalCredits(initial, { ...initial, ...wallets(1290) });
    const save: Save = { _saveVersion: 10, character };
    await kv.set(saveKey, save);
    await kv.set(runKey, run);
    return { name, token, runKey, saveKey, run, save, keys: HG_CLAWBACK_KEYS };
}

test('a fresh start request cannot replace an active run and rebase its unsettled rewards', async t => {
    const f = await preparedRun('start');
    const start = (await import('./start.js')).default as unknown as Handler;
    const counterKey = `hg-runs:${f.name}:${new Date().toISOString().slice(0, 10)}`;
    await kv.set(counterKey, 1);
    const response = await call(start, f.name, { requestId: 'different-start-request' });
    const after = (await kv.get<Save>(f.saveKey))!;
    const nextToken = (after.character.hollowGateRun as Record<string, unknown>)?.runToken;
    const nextRun = await kv.get<HollowGateRunToken>(`hg-run:${f.name}:${String(nextToken)}`);
    t.diagnostic(JSON.stringify({ case: 'active-start', status: response.status, activeTokenChanged: nextToken !== f.token,
        beforeVersion: f.save._saveVersion, afterVersion: after._saveVersion, count: await kv.get(counterKey),
        keyStacks: after.character.itemStacks, nextEntryRyo: nextRun?.entryCurrencies.ryo,
        externalCredits: credits.hollowGateExternalCredits(after.character, String(nextToken)) }));
    assert.equal(response.status, 409, 'an active dive must be settled before paying for another one');
    assert.deepEqual(await kv.get(f.saveKey), f.save, 'wallet, provenance and entry keys remain unchanged');
    assert.deepEqual(await kv.get(f.runKey), f.run);
    assert.equal(await kv.get(counterKey), 1);
    assert.deepEqual(await kv.keys(`hg-run:${f.name}:*`), [f.runKey]);
});

test('the original start request resumes its paid dive without another key or daily slot', async () => {
    const f = await preparedRun('resume');
    const start = (await import('./start.js')).default as unknown as Handler;
    const counterKey = `hg-runs:${f.name}:${new Date().toISOString().slice(0, 10)}`;
    await kv.set(counterKey, 1);
    const response = await call(start, f.name, { requestId: 'original-start-resume' });
    assert.equal(response.status, 200, String(response.body?.error));
    assert.equal(response.body?.token, f.token);
    const after = (await kv.get<Save>(f.saveKey))!;
    assert.deepEqual(after.character.itemStacks, f.save.character.itemStacks);
    assert.deepEqual(after.character.hollowGateExternalCredits, f.save.character.hollowGateExternalCredits);
    assert.equal(await kv.get(counterKey), 1);
    assert.deepEqual(await kv.keys(`hg-run:${f.name}:*`), [f.runKey]);
});

test('a missing expired run pointer does not prevent a new paid entry', async () => {
    const f = await preparedRun('expired');
    const start = (await import('./start.js')).default as unknown as Handler;
    await kv.del(f.runKey);
    const response = await call(start, f.name, { requestId: 'new-after-expired' });
    assert.equal(response.status, 200, String(response.body?.error));
    assert.notEqual(response.body?.token, f.token);
    const after = (await kv.get<Save>(f.saveKey))!;
    assert.deepEqual(after.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }]);
    assert.deepEqual(credits.hollowGateExternalCredits(after.character, String(response.body?.token)), {});
});

test('an unavailable active-run lookup refuses entry without spending anything', async t => {
    const f = await preparedRun('lookup');
    const start = (await import('./start.js')).default as unknown as Handler;
    const get = kv.get.bind(kv);
    t.mock.method(kv, 'get', (async <T>(key: string): Promise<T | null> => {
        if (key === f.runKey) throw new Error('injected active-run lookup unavailable');
        return get<T>(key);
    }) as typeof kv.get);
    const response = await call(start, f.name, { requestId: 'new-while-lookup-fails' });
    assert.equal(response.status, 500);
    assert.deepEqual(await kv.get(f.saveKey), f.save);
    assert.equal(await kv.get(`hg-runs:${f.name}:${new Date().toISOString().slice(0, 10)}`), null);
});

test('a legitimately settled dive permits the next entry and an old token cannot clear it', async () => {
    const f = await preparedRun('sequential');
    const settle = (await import('./settle.js')).default as unknown as Handler;
    const start = (await import('./start.js')).default as unknown as Handler;
    // A verified final boss clear is the normal extraction path without an exit tile.
    await kv.set(f.runKey, { ...f.run, resolvedEncounterIds: ['5:boss:final'] });
    const extracted = await call(settle, f.name, { token: f.token, action: 'extract' });
    assert.equal(extracted.status, 200, String(extracted.body?.error));
    const entered = await call(start, f.name, { requestId: 'new-after-extraction' });
    assert.equal(entered.status, 200, String(entered.body?.error));
    const current = (await kv.get<Save>(f.saveKey))!;
    assert.notEqual((current.character.hollowGateRun as Character).runToken, f.token);
    // A retained completed token may repair its sidecars, but never reapply a save.
    await kv.set(f.runKey, f.run);
    const replay = await call(settle, f.name, { token: f.token, action: 'abandon' });
    assert.equal(replay.status, 200, String(replay.body?.error));
    assert.deepEqual(await kv.get(f.saveKey), current);
});

test('settling a dive clears its start marker so the next entry is not replayed as spent', async () => {
    const f = await preparedRun('marker');
    const settle = (await import('./settle.js')).default as unknown as Handler;
    await kv.set(f.runKey, { ...f.run, resolvedEncounterIds: ['5:boss:final'] });
    const extracted = await call(settle, f.name, { token: f.token, action: 'extract' });
    assert.equal(extracted.status, 200, String(extracted.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    assert.ok((after.character.redeemedHollowGateRuns as string[]).includes(f.token));
    // A deleted key was restored by the merging save writer, leaving a marker
    // for a redeemed run: every later entry replayed it and got 409 spent.
    assert.equal(after.character.lastHollowGateStart, undefined);
});

test('an unpaid orphan token cannot settle against a different active dive', async () => {
    const f = await preparedRun('stale');
    const settle = (await import('./settle.js')).default as unknown as Handler;
    const newer = { ...f.save, character: { ...f.save.character, hollowGateRun: { runToken: 'newer-token' } } };
    await kv.set(f.saveKey, newer);
    const response = await call(settle, f.name, { token: f.token, action: 'abandon' });
    assert.equal(response.status, 409);
    assert.deepEqual(await kv.get(f.saveKey), newer);
    assert.deepEqual(await kv.get(f.runKey), f.run);
});

test('an old active pet binding cannot resume after a different dive became authoritative', async () => {
    const f = await preparedRun('petresume');
    const combatStart = (await import('./combat-start.js')).default as unknown as Handler;
    const { createHollowGateCombatBinding, hollowGateCombatBindingKey } = await import('./_combat-session.js');
    const binding = createHollowGateCombatBinding({ playerName: f.name, token: f.token, floor: 1,
        kind: 'beast', nodeId: 'floor:1:tile:20', runId: 'old-pet-run', combatMode: 'pet' });
    const oldRun = { ...f.run, activeEncounter: binding };
    await kv.set(f.runKey, oldRun);
    await kv.set(hollowGateCombatBindingKey(binding.runId), binding);
    const newer = { ...f.save, character: { ...f.save.character, hollowGateRun: { runToken: 'newer-token' } } };
    await kv.set(f.saveKey, newer);
    const response = await call(combatStart, f.name, { token: f.token, floor: 1, kind: 'beast', nodeId: binding.nodeId, mode: 'pet' });
    assert.equal(response.status, 409);
    assert.deepEqual(await kv.get(f.saveKey), newer);
    assert.deepEqual(await kv.get(f.runKey), oldRun);
    assert.deepEqual(await kv.get(hollowGateCombatBindingKey(binding.runId)), binding);
});
