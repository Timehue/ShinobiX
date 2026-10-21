process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'food-economy-test';
import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { petFoodAllowance } from '../../shared/pet-food.js';
import { sanitizePetRoster } from '../save/_sanitize-pets.js';
type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let migration: number;
const player = 'foodredesignowner';
const key = `save:${player}`;
let now = Date.parse('2026-10-20T23:59:00Z');
const pet = (id = 'pet-1'): Json => ({ id, name: 'Companion', level: 50, xp: 0, maxLevel: 100, rarity: 'standard', hp: 320, attack: 40, defense: 28, speed: 30, happiness: 20, jutsus: [], growthVersion: 2, growthBaseStats: { hp: 320, attack: 40, defense: 28, speed: 30 } });
async function seed(used = 0) {
    await kv.set(key, { _saveVersion: 1, character: { name: player, level: 50, petBreedingMigrationVersion: migration, pets: [{ ...pet(), foodXpDay: Math.floor(now / 86400000), foodXpUsed: used }, pet('pet-2')], activePetId: 'pet-1', inventory: ['unique-stock', 'ancient-pet-treat'], itemStacks: Object.entries({ 'pet-treat': 30, 'elemental-pet-treat': 10, 'ancient-pet-treat': 10, 'golden-apple': 3 }).map(([itemId, count]) => ({ itemId, count })) } });
}
async function read() { return (await kv.get<Json>(key))!.character as Json; }
async function post(body: Json) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: player, petId: 'pet-1', ...body }, query: {}, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD } } as never, res as never);
    return out;
}
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./progress.js')).default as unknown as typeof handler;
    migration = (await import('./_owned-pet.js')).PET_BREEDING_MIGRATION_VERSION;
    mock.method(Date, 'now', () => now);
});
after(async () => { await kv.del(key); mock.restoreAll(); delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.ADMIN_PASSWORD; });

test('all four foods share one persistent UTC budget and reject before consuming stock', async () => {
    await seed();
    for (const itemId of ['pet-treat', 'elemental-pet-treat', 'ancient-pet-treat']) assert.equal((await post({ action: 'feed', itemId })).status, 200);
    const before = await read();
    assert.equal(((before.pets as Json[])[0]).foodXpUsed, 850);
    const premium = await post({ action: 'feed', itemId: 'golden-apple' });
    assert.equal(premium.status, 409); assert.match(String(premium.body.error), /1,?150|1150/);
    assert.deepEqual(await read(), before);
    assert.equal((await post({ action: 'set-active', petId: 'pet-2' })).status, 200);
    assert.equal((await post({ action: 'feed', itemId: 'golden-apple' })).status, 409);
    assert.equal((await post({ action: 'feed', petId: 'pet-2', itemId: 'golden-apple' })).status, 200, 'allowance belongs to each pet');
});

test('concurrent feeds cannot exceed the allowance; retrying a receipt is a no-op', async () => {
    await seed(1900);
    const responses = await Promise.all(['food-request-00001','food-request-00002'].map(requestId => post({ action: 'feed', itemId: 'pet-treat', requestId })));
    assert.deepEqual(responses.map(x => x.status).sort(), [200, 409]);
    const stored = await read();
    assert.equal((stored.pets as Json[])[0].foodXpUsed, 2000);
    assert.equal((stored.itemStacks as Array<{ itemId: string; count: number }>).find(s => s.itemId === 'pet-treat')!.count, 29);
    const winningId = responses[0].status === 200 ? 'food-request-00001' : 'food-request-00002';
    assert.equal((await post({ action: 'feed', itemId: 'pet-treat', requestId: winningId })).status, 200);
    assert.deepEqual(await read(), stored);
});

test('rollover replenishes XP while happiness care stays separate and max-level food is rejected', async () => {
    await seed(2000);
    assert.equal((await post({ action: 'pet' })).status, 200);
    let character = await read();
    assert.equal((character.pets as Json[])[0].xp, 0);
    assert.equal((character.pets as Json[])[0].foodXpUsed, 2000);
    now = Date.parse('2026-10-21T00:00:00Z');
    assert.equal(petFoodAllowance((character.pets as Json[])[0], now).remaining, 2000);
    assert.equal((await post({ action: 'feed', itemId: 'golden-apple' })).status, 200);
    character = await read();
    assert.equal((character.pets as Json[])[0].foodXpUsed, 2000);
    const record = (await kv.get<Json>(key))!;
    await kv.set(key, { ...record, character: { ...character, pets: (character.pets as Json[]).map(p => ({ ...p, level: 100 })) } });
    const before = await read();
    assert.equal((await post({ action: 'feed', itemId: 'golden-apple' })).status, 409);
    assert.deepEqual(await read(), before);
});

test('stale or forged autosaves cannot reset allowance or converted investment', async () => {
    const stored = { pets: [{ ...pet(), foodXpDay: 200, foodXpUsed: 2000, growthAllocation: { vitality: 1, power: 2, guard: 3, agility: 4 } }] };
    const incoming = { pets: [{ ...pet(), foodXpDay: 0, foodXpUsed: 0, growthVersion: 1, growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 } }] };
    sanitizePetRoster(incoming, stored, true);
    assert.deepEqual(incoming.pets[0], stored.pets[0]);
});

test('happiness-only care uses ordinary stock, gives no XP and never wastes premium food', async () => {
    await seed(2000);
    const before = await read();
    assert.equal((await post({ action: 'care-feed', itemId: 'golden-apple' })).status, 400);
    assert.deepEqual(await read(), before);
    assert.equal((await post({ action: 'care-feed', itemId: 'pet-treat', requestId: 'happiness-care-0001' })).status, 200);
    const cared = await read();
    const companion = (cared.pets as Json[])[0];
    assert.equal(companion.xp, 0); assert.equal(companion.foodXpUsed, 2000); assert.equal(companion.happiness, 30);
    assert.equal((await post({ action: 'care-feed', itemId: 'pet-treat', requestId: 'happiness-care-0001' })).status, 200);
    assert.deepEqual(await read(), cared);
    const record = (await kv.get<Json>(key))!;
    await kv.set(key, { ...record, character: { ...cared, pets: [{ ...companion, level: 100, happiness: 100 }] } });
    const full = await read();
    assert.equal((await post({ action: 'care-feed', itemId: 'pet-treat' })).status, 409);
    assert.deepEqual(await read(), full);
});

test('a feed queued across UTC midnight uses the day inside the authoritative save lock', async () => {
    const { withKvLock } = await import('../_lock.js');
    now = Date.parse('2026-10-21T23:59:59.995Z');
    await seed(2000);
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const holding = withKvLock(key, async () => { acquired(); await new Promise<void>(resolve => { release = resolve; }); }, { failClosed: true });
    await ready;
    const feeding = post({ action: 'feed', itemId: 'golden-apple' });
    await new Promise(resolve => setTimeout(resolve, 50));
    now += 10;
    release(); await holding;
    assert.equal((await feeding).status, 200);
    const companion = ((await read()).pets as Json[])[0];
    assert.equal(companion.foodXpDay, Math.floor(now / 86400000));
    assert.equal(companion.foodXpUsed, 2000);
});
