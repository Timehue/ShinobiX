import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'exchange-named-admin';
delete process.env.SESSION_SECRET;

type Obj = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
const namedId = 'named-weapon-123456781234123412341234567890ab';
const armorId = 'named-armor-223456781234123412341234567890ab';
const namedDef = { id: namedId, name: 'Ash of the First Sun', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 173, bonuses: { bukijutsuOffense: 71 }, description: 'Forged beneath the red sun.' };
const armorDef = { id: armorId, name: 'Veil of Embers', slot: 'body', rarity: 'legendary', cost: 0, levelReq: 90, armorQuality: 'Legendary', bonuses: { ninjutsuDefense: 40 }, description: 'Forged beneath the red sun.' };
const message = 'Named gear that has been equipped can no longer be sold at Sunscar Exchange. Sell it to the shop for ryo instead.';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./exchange.js')).default as unknown as typeof handler;
});
beforeEach(async () => {
    for (const key of await kv.keys('sunscar-exchange:*')) await kv.del(key);
    await kv.del('battle-lock:seller');
    await kv.set('save:seller', { _saveVersion: 1, character: { name: 'seller', level: 100, ryo: 10_000, inventory: [namedId, armorId, 'training-katana'], itemStacks: [], pets: [], tileCards: [], equipment: {}, fateShards: 100, honorSeals: 100, mythicSeals: 100, boneCharms: 100, auraStones: 100 }, creatorItems: [namedDef, armorDef] });
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.ADMIN_PASSWORD; });

async function post(body: Obj) {
    const out: { status: number; body: Obj } = { status: 200, body: {} };
    const response = { setHeader() {}, status(code: number) { out.status = code; return this; }, json(data: Obj) { out.body = data; return this; }, end() {} };
    await handler({ method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' } } as never, response as never);
    return out;
}
async function patch(patch: Obj) { const rec = (await kv.get<Obj>('save:seller'))!; await kv.set('save:seller', { ...rec, character: { ...rec.character, ...patch } }); }
const list = (assetId: string) => post({ action: 'list', playerName: 'seller', requestId: randomUUID(), kind: 'item', assetId, quantity: 1, price: 1000 });

it('named gear that was never equipped can still be listed', async () => {
    const out = await list(namedId);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.listing.state, 'active');
});

it('named gear that has been equipped is refused, stays in the bag, and says why', async () => {
    await patch({ equippedNamedGear: [namedId] });
    const out = await list(namedId);
    assert.equal(out.status, 409);
    assert.equal(out.body.error, message);
    assert.ok(((await kv.get<Obj>('save:seller'))!.character.inventory as string[]).includes(namedId), 'nothing was taken from the bag');
});

it('the refusal is per piece: another named piece and ordinary gear still list', async () => {
    await patch({ equippedNamedGear: [namedId] });
    assert.equal((await list(armorId)).status, 200);
    assert.equal((await list('training-katana')).status, 200);
});

it('the Exchange marks the worn piece unavailable in the seller list, with the same reason', async () => {
    await patch({ equippedNamedGear: [armorId] });
    const out = await post({ action: 'browse', playerName: 'seller' });
    const rows: Obj[] = out.body.inventory;
    assert.equal(rows.find((row) => row.id === armorId)?.unavailable, message);
    assert.equal(rows.find((row) => row.id === namedId)?.unavailable, undefined);
});

it('a mixed case record still blocks the piece', async () => {
    await patch({ equippedNamedGear: [namedId.toUpperCase().replace('NAMED-WEAPON-', 'named-weapon-')] });
    assert.equal((await list(namedId)).status, 409);
});
