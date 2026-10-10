import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'hollow-beast-cache-integration';
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let cacheRewards: typeof import('./open-hollow-beast-cache.js').cacheRewards;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    const mod = await import('./open-hollow-beast-cache.js');
    handler = mod.default as unknown as typeof handler;
    cacheRewards = mod.cacheRewards;
});

const PLAYER = 'cache-opener';
const MATERIALS = ['hunt-legendary-material', 'hunt-ancient-beast-core', 'hunt-titan-bone', 'hunt-ember-scale', 'hunt-shadow-pelt'];

async function seedSave(caches: number) {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: {
        name: PLAYER, level: 100, inventory: [], ryo: 100, boneCharms: 0,
        itemStacks: [{ itemId: 'hollow-beast-cache', count: caches }],
    } });
}
async function open(requestId: string) {
    const out: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
    const res = {
        setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', body: { playerName: PLAYER, requestId },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}
async function character() {
    return (await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`))!.character;
}

test('the same requestId against fresh saves no longer maps to one predictable reward', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
        await seedSave(1);
        const reply = await open('predictable-request-id-0001');
        assert.equal(reply.status, 200);
        const rewards = reply.body.rewards as { materialId: string; dungeonKey: boolean };
        seen.add(`${rewards.materialId}:${rewards.dungeonKey}`);
    }
    // A requestId-derived roll would give the same result all 40 times.
    assert.ok(seen.size > 1, `expected varied rewards, got ${[...seen].join(', ')}`);
});

test('different requestIds are not mapped to the offline-computable gearRoll result', async () => {
    const { gearRoll } = await import('../_gear-drops.js');
    let mismatches = 0;
    for (let i = 0; i < 30; i++) {
        const requestId = `offline-precomputed-id-${String(i).padStart(4, '0')}`;
        const predicted = MATERIALS[Math.min(4, Math.floor(gearRoll(`${requestId}:material`) * 5))]!;
        const predictedKey = gearRoll(`${requestId}:dungeon-key`) < 0.2;
        await seedSave(1);
        const rewards = (await open(requestId)).body.rewards as { materialId: string; dungeonKey: boolean };
        if (rewards.materialId !== predicted || rewards.dungeonKey !== predictedKey) mismatches++;
    }
    // Chance that all 30 agree by luck is below 1e-15 for the material alone.
    assert.ok(mismatches > 0, 'rewards still follow the requestId-derived roll');
});

test('replaying one requestId returns the stored reward and consumes only one cache', async () => {
    await seedSave(3);
    const first = await open('replayed-request-id-0001');
    assert.equal(first.status, 200);
    const afterFirst = await character();
    for (let i = 0; i < 5; i++) {
        const again = await open('replayed-request-id-0001');
        assert.equal(again.status, 200);
        assert.deepEqual(again.body.rewards, first.body.rewards);
    }
    const afterReplays = await character();
    assert.deepEqual(afterReplays.inventory, afterFirst.inventory);
    assert.equal(afterReplays.ryo, afterFirst.ryo);
    assert.equal(afterReplays.boneCharms, afterFirst.boneCharms);
    assert.deepEqual(afterReplays.itemStacks, afterFirst.itemStacks);
    const stack = (afterReplays.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'hollow-beast-cache');
    assert.equal(stack?.count, 2);
});

test('the stored reward matches what the player was granted', async () => {
    await seedSave(1);
    const reply = await open('granted-request-id-000001');
    const rewards = reply.body.rewards as { ryo: number; boneCharms: number; materialId: string; dungeonKey: boolean };
    assert.equal(rewards.ryo, 1_500);
    assert.equal(rewards.boneCharms, 1);
    assert.ok(MATERIALS.includes(rewards.materialId));
    const saved = await character();
    assert.equal(saved.ryo, 1_600);
    assert.deepEqual(saved.inventory, [rewards.materialId]);
    const keys = (saved.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'dungeon-key');
    assert.equal(keys?.count ?? 0, rewards.dungeonKey ? 1 : 0);
});

test('odds and material list are unchanged: 20 percent keys, five equally likely materials', () => {
    const trials = 20_000;
    let keys = 0;
    const counts = new Map<string, number>();
    for (let i = 0; i < trials; i++) {
        const rewards = cacheRewards(`seed-${i}`);
        if (rewards.dungeonKey) keys++;
        counts.set(rewards.materialId, (counts.get(rewards.materialId) ?? 0) + 1);
    }
    assert.deepEqual([...counts.keys()].sort(), [...MATERIALS].sort());
    assert.ok(Math.abs(keys / trials - 0.2) < 0.02, `key rate ${keys / trials}`);
    for (const count of counts.values()) assert.ok(Math.abs(count / trials - 0.2) < 0.02);
});
