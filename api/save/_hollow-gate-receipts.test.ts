import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import type { HollowGateRunToken } from '../hollow-gate/_run-token.js';
import { COMBAT_STRIP_CHAR_FIELDS } from './_state-ownership.js';

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

test('raw saves cannot clear, replace, forge or restore Hollow Gate operation receipts', async () => {
    const { enforceRawSaveLedgerBoundary } = await import('./_sanitize-ledger.js');
    const { isServerOwnedSavePath } = await import('../../shinobij.client/src/lib/save-ownership.js');
    const receipts = {
        settledHollowGateEventIds: ['run-a:event:chest'],
        settledHollowGateCombatIds: ['combat-a'],
        hollowGatePendingOperation: { token: 'run-a', operationId: 'operation-a' },
    };
    for (const [field, value] of Object.entries(receipts)) {
        for (const requested of [undefined, null, [], ['forged-id'], { token: 'forged', operationId: 'forged' }]) {
            const incoming: Character = { [field]: requested };
            enforceRawSaveLedgerBoundary(incoming, receipts, false, structuredClone(incoming));
            assert.deepEqual(incoming[field], value, `${field} preserves the stored authority`);
        }
        for (const firstSave of [false, true]) {
            const incoming: Character = { [field]: value };
            enforceRawSaveLedgerBoundary(incoming, {}, firstSave, structuredClone(incoming));
            assert.equal(Object.hasOwn(incoming, field), false, `${field} cannot be invented`);
        }
        assert.ok(COMBAT_STRIP_CHAR_FIELDS.includes(field));
        assert.equal(isServerOwnedSavePath(['character', field]), true);
    }
});
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let credits: typeof import('../hollow-gate/_external-credits.js');

before(async () => {
    const storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa');
    kv = storage.kv;
    ({ issuePlayerToken } = await import('../_auth.js'));
    credits = await import('../hollow-gate/_external-credits.js');
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
    const { HG_CLAWBACK_KEYS } = await import('../hollow-gate/_run-token.js');
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

test('ordinary authenticated raw save cannot erase a paid chest receipt and make its replay pay again', async t => {
    const f = await preparedRun('rawsave');
    const { validateHollowGateFloorManifest } = await import('../hollow-gate/_floor-manifest.js');
    const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1]] as const) {
        for (let n = 0; n < count; n++) tiles[index++].kind = kind;
    }
    tiles[136].kind = 'exit';
    tiles[148].kind = 'descend';
    const floor = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: 15, height: 11,
        playerX: 1, playerY: 1, tiles });
    assert.equal(floor.ok, true);
    await kv.set(f.runKey, { ...f.run, floorManifests: { '1': floor.manifest }, position: { x: 12, y: 1 } });
    const sourceId = 'event:1:chest:floor:1:tile:27';
    await kv.set(`hg-event-roll:${f.name}:${f.token}:${sourceId}`, { action: 'chest', credit: { currencies: { ryo: 100 } } });
    const event = (await import('../hollow-gate/event.js')).default as unknown as Handler;
    const rawSave = (await import('../save/[name].js')).default as unknown as Handler;
    const request = { token: f.token, action: 'chest', nodeId: 'floor:1:tile:27' };
    const paidResponse = await call(event, f.name, request);
    assert.equal(paidResponse.status, 200, String(paidResponse.body?.error));
    const paid = (await kv.get<Save>(f.saveKey))!;
    assert.equal(paid.character.ryo, 1390);
    assert.deepEqual(paid.character.settledHollowGateEventIds, [sourceId]);
    const incoming = { ...structuredClone(paid), _baseSaveVersion: paid._saveVersion,
        character: { ...structuredClone(paid.character), settledHollowGateEventIds: [], settledHollowGateCombatIds: [] } };
    const savedResponse = await call(rawSave, f.name, incoming);
    assert.equal(savedResponse.status, 200, String(savedResponse.body?.error));
    assert.notEqual(savedResponse.body?.persisted, false, 'the ordinary save really persisted');
    const saved = (await kv.get<Save>(f.saveKey))!;
    assert.equal(saved._saveVersion, paid._saveVersion + 1);
    const replay = await call(event, f.name, request);
    assert.equal(replay.status, 200, String(replay.body?.error));
    const after = (await kv.get<Save>(f.saveKey))!;
    t.diagnostic(JSON.stringify({ case: 'raw-save-receipt', saveStatus: savedResponse.status,
        receiptAfterRawSave: saved.character.settledHollowGateEventIds,
        paidRyo: paid.character.ryo, replayRyo: after.character.ryo,
        paidVersion: paid._saveVersion, rawSaveVersion: saved._saveVersion, replayVersion: after._saveVersion }));
    assert.equal(after.character.ryo, paid.character.ryo, 'ordinary autosave cannot revoke a server payment receipt');
    assert.deepEqual(saved.character.settledHollowGateEventIds, [sourceId]);
    assert.deepEqual(after.character.hollowGateExternalCredits, paid.character.hollowGateExternalCredits);
});
