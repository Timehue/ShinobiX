import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.SESSION_SECRET;

let kv: typeof import('./_storage.js').kv;
let settle: typeof import('./_gear-drop-settlement.js').settleGearDropForPlayer;
let hit: typeof import('./_gear-drop-settlement.js').gearDropHit;
const player = 'geardropintegration';
const key = `save:${player}`;
// The event began a minute ago, so any receipt written since is newer than this.
const notBefore = Date.now() - 60_000;
const original = { name: player, level: 40, inventory: ['kept-item'], itemStacks: [], equipment: {}, ryo: 5 };

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ settleGearDropForPlayer: settle, gearDropHit: hit } = await import('./_gear-drop-settlement.js'));
});
beforeEach(async () => { await kv.set(key, { _saveVersion: 1, character: structuredClone(original) }); });
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function inventory(): Promise<string[]> {
    const save = await kv.get<{ character: { inventory: string[] } }>(key);
    return save!.character.inventory;
}

test('the hit depends only on the event id and the chance', () => {
    assert.equal(hit('tower:a:b', 10_000), true);
    assert.equal(hit('tower:a:b', 0), false);
    assert.equal(hit('tower:a:b', 500), hit('tower:a:b', 500));
});

test('a zero chance never touches the save', async () => {
    assert.deepEqual(await settle({ playerName: player, eventId: 'tower:run:1', chanceBp: 0, notBefore }), {});
    assert.deepEqual(await inventory(), ['kept-item']);
});

test('a hit adds one step item, and a retry of the same event adds nothing more', async () => {
    const first = await settle({ playerName: player, eventId: 'tower:run:2', chanceBp: 10_000, notBefore });
    assert.match(first.itemId ?? '', /-s[1-5]$/);
    assert.deepEqual(await inventory(), ['kept-item', first.itemId]);
    assert.deepEqual(await settle({ playerName: player, eventId: 'tower:run:2', chanceBp: 10_000, notBefore }), {});
    assert.deepEqual(await inventory(), ['kept-item', first.itemId]);
});

test('a different event is its own drop and prefers a piece the player lacks', async () => {
    const one = await settle({ playerName: player, eventId: 'tower:run:3', chanceBp: 10_000, notBefore });
    const two = await settle({ playerName: player, eventId: 'tower:run:4', chanceBp: 10_000, notBefore });
    assert.notEqual(one.itemId, two.itemId);
    assert.equal((await inventory()).length, 3);
});

/** Make the next `losses` save writes lose their race, as a busy save does. */
async function withLostWrites<T>(losses: number, run: () => Promise<T>): Promise<{ result: T; lost: number }> {
    const original = kv.compareSet;
    let lost = 0;
    kv.compareSet = (key, expected, value, options) => {
        if (key.startsWith('save:') && lost < losses) { lost += 1; return Promise.resolve(false); }
        return original.call(kv, key, expected, value, options);
    };
    try { return { result: await run(), lost }; } finally { kv.compareSet = original; }
}

test('a busy save does not lose the drop: the write is retried and still pays exactly once', async () => {
    const { result, lost } = await withLostWrites(4, () => settle({ playerName: player, eventId: 'tower:run:busy', chanceBp: 10_000, notBefore }, 1));
    assert.ok(lost >= 3, `the write should have lost several races (lost ${lost})`);
    assert.match(result.itemId ?? '', /-s[1-5]$/);
    assert.deepEqual(await inventory(), ['kept-item', result.itemId]);
});

test('a save that never frees up gives up loudly, so the caller can decide, and pays nothing', async () => {
    await assert.rejects(() => withLostWrites(1000, () => settle({ playerName: player, eventId: 'tower:run:stuck', chanceBp: 10_000, notBefore }, 1)));
    assert.deepEqual(await inventory(), ['kept-item']);
    // Once the save is free again, the same event pays, because nothing was recorded.
    const later = await settle({ playerName: player, eventId: 'tower:run:stuck', chanceBp: 10_000, notBefore }, 1);
    assert.match(later.itemId ?? '', /-s[1-5]$/);
});

type Receipt = { requestId: string; fingerprint: string; value: Record<string, unknown>; settledAt: number };
const filler = (count: number, settledAt: number): Receipt[] => Array.from({ length: count }, (_, i) => ({
    requestId: `filler-receipt-${String(i).padStart(4, '0')}`, fingerprint: `filler:${i}`, value: {}, settledAt: settledAt + i,
}));
async function withReceipts(receipts: Receipt[]) {
    const save = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(key);
    await kv.set(key, { ...save!, character: { ...save!.character, serverSettlementReceipts: receipts } });
}

test('a replay after the receipt list rolled over does not pay the same event twice', async () => {
    const first = await settle({ playerName: player, eventId: 'tower:run:rolled', chanceBp: 10_000, notBefore });
    assert.match(first.itemId ?? '', /-s[1-5]$/);
    // 50 newer settlements (shop buys, sales, other runs) push this event's receipt out of the list.
    await withReceipts(filler(50, Date.now()));
    const replay = await settle({ playerName: player, eventId: 'tower:run:rolled', chanceBp: 10_000, notBefore });
    assert.deepEqual(replay, {});
    assert.deepEqual(await inventory(), ['kept-item', first.itemId], 'no second copy');
});

test('a full receipt list that is all older than the event does not block a first, legitimate drop', async () => {
    await withReceipts(filler(50, notBefore - 3_600_000));
    const drop = await settle({ playerName: player, eventId: 'tower:run:fresh-event', chanceBp: 10_000, notBefore });
    assert.match(drop.itemId ?? '', /-s[1-5]$/);
    assert.equal((await inventory()).length, 2);
});

test('an unknown player gets nothing and does not throw', async () => {
    assert.deepEqual(await settle({ playerName: 'nobodyhere', eventId: 'tower:run:5', chanceBp: 10_000, notBefore }), {});
});
