import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'dungeon-telemetry-handler-isolated-test-secret';

type Json = Record<string, unknown>;
type LoggedTxn = { txnId: string; player: string; currency: string; delta: number; source: string };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let DUNGEON_CLEAR_REWARD: typeof import('./_run.js').DUNGEON_CLEAR_REWARD;
let handler: (req: never, res: never) => Promise<unknown>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ DUNGEON_CLEAR_REWARD } = await import('./_run.js'));
    handler = (await import('./run.js')).default as unknown as typeof handler;
});

// A run that already holds all three server win proofs, ready to settle.
async function seedProvedRun(player: string, token: string) {
    const now = Date.now();
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 50, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, inventory: [], itemStacks: [],
        activeDungeonRun: {
            token, entry: 'key', startedAt: now - 60_000,
            combatAuthorityVersion: 1, wardenDefeated: true, wardenProofId: 'wardenproof123',
            cardAuthorityVersion: 1, cardDefeated: true, cardLastOutcome: 'player', cardSettledAt: now,
            cardDefeatedAt: now, cardProofId: 'cardproof123', cardLastProofId: 'cardproof123',
            petAuthorityVersion: 1, petDefeated: true, petLastOutcome: 'win', petSettledAt: now,
            petDefeatedAt: now, petProofId: 'petproof123', petLastProofId: 'petproof123', petLastPetIds: ['pet-one'],
        },
    } });
}

async function settle(player: string, token: string) {
    const output = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { output.status = status; return res; },
        json: (body: Json) => { output.body = body; return res; }, end: () => res };
    await handler({ method: 'POST', body: { action: 'settle', playerName: player, token },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '203.0.113.122' } } as never, res as never);
    return output;
}

const clearTxns = async (player: string) => ((await kv.get<LoggedTxn[]>('econ:txns')) ?? [])
    .filter((txn) => txn.player === player)
    .map(({ txnId, currency, delta, source }) => ({ txnId, currency, delta, source }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

test('a verified clear logs each reward currency once, even across a Legacy 503 retry', async () => {
    process.env.ENABLE_LEGACY = '1';
    const player = 'dungeontelemetry1';
    const token = 'telemetrydungeonclear';
    await seedProvedRun(player, token);
    await kv.set(`legacy:stats:${player}`, { bootstrappedAt: Date.now() });
    const original = kv.set;
    let fail = true;
    kv.set = async (key, value, options) => {
        if (fail && key === `legacy:stats:${player}`) { fail = false; return null; }
        return original(key, value, options);
    };
    try {
        assert.equal((await settle(player, token)).status, 503);
        kv.set = original;
        assert.equal((await settle(player, token)).status, 200);
        assert.equal((await settle(player, token)).status, 200);
    } finally { kv.set = original; delete process.env.ENABLE_LEGACY; }
    const saved = (await kv.get<Json>(`save:${player}`))!.character as Json;
    assert.equal(saved.fateShards, DUNGEON_CLEAR_REWARD.fateShards);
    assert.deepEqual(await clearTxns(player), [
        { txnId: `dungeon:${token}:auraStones`, currency: 'auraStones', delta: DUNGEON_CLEAR_REWARD.auraStones, source: 'dungeon.clear' },
        { txnId: `dungeon:${token}:boneCharms`, currency: 'boneCharms', delta: DUNGEON_CLEAR_REWARD.boneCharms, source: 'dungeon.clear' },
        { txnId: `dungeon:${token}:fateShards`, currency: 'fateShards', delta: DUNGEON_CLEAR_REWARD.fateShards, source: 'dungeon.clear' },
    ]);
});

test('a refused settle logs nothing', async () => {
    const player = 'dungeontelemetry2';
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 50, inventory: [], itemStacks: [] } });
    assert.equal((await settle(player, 'nosuchdungeonrun')).status, 409);
    assert.deepEqual(await clearTxns(player), []);
});
