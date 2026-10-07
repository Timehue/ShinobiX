import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.SESSION_SECRET;

let kv: typeof import('../_storage.js').kv;
let namedGearSaleItem: typeof import('./_named-sale-item.js').namedGearSaleItem;
let applyInventorySale: typeof import('./_sale.js').applyInventorySale;
let forgedItemKey: typeof import('../_forged-item-registry.js').forgedItemKey;
const weaponId = 'named-weapon-123456781234123412341234567890ab';
const armorId = 'named-armor-223456781234123412341234567890ab';
const weaponDef = { id: weaponId, name: 'Ash of the First Sun', slot: 'hand', rarity: 'legendary', cost: 0, weaponEp: 20 };
const armorDef = { id: armorId, name: 'Veil of Embers', slot: 'body', rarity: 'legendary', cost: 0, armorQuality: 'Legendary' };

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ namedGearSaleItem } = await import('./_named-sale-item.js'));
    ({ applyInventorySale } = await import('./_sale.js'));
    ({ forgedItemKey } = await import('../_forged-item-registry.js'));
});
beforeEach(async () => {
    await kv.del(forgedItemKey(weaponId));
    await kv.set('save:holder', { _saveVersion: 1, character: { name: 'holder' }, creatorItems: [armorDef] });
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

const holder = (extra: Record<string, unknown> = {}) => ({ name: 'holder', ryo: 100, inventory: [weaponId, armorId], itemStacks: [], equipment: {}, ...extra });
const rid = (n: number) => `named-sale-request-${String(n).padStart(4, '0')}`;

describe('selling named gear to the shop', () => {
    it('resolves a piece from the forged registry, or from the player own save', async () => {
        assert.equal(await namedGearSaleItem('holder', weaponId), null, 'unknown until it is minted somewhere');
        await kv.set(forgedItemKey(weaponId), weaponDef);
        assert.equal((await namedGearSaleItem('holder', weaponId))?.slot, 'hand');
        assert.equal((await namedGearSaleItem('holder', armorId))?.name, 'Veil of Embers');
    });

    it('never resolves an id that is not named gear', async () => {
        assert.equal(await namedGearSaleItem('holder', 'training-katana'), null);
        assert.equal(await namedGearSaleItem('holder', 'rustfang-kunai-s1'), null);
        assert.equal(await namedGearSaleItem('holder', 'named-weapon-not-a-real-uuid'), null);
    });

    it('pays a flat 500 ryo from the bag, once, and a replay pays nothing more', async () => {
        await kv.set(forgedItemKey(weaponId), weaponDef);
        const item = (await namedGearSaleItem('holder', weaponId))!;
        const sold = applyInventorySale(holder(), item, 'backpack', 1, undefined, rid(1), 1_000);
        assert.ok(sold.ok); if (!sold.ok) return;
        assert.equal(sold.value.ryo, 500);
        assert.equal(sold.character.ryo, 600);
        assert.deepEqual(sold.character.inventory, [armorId]);
        const replay = applyInventorySale(sold.character, item, 'backpack', 1, undefined, rid(1), 2_000);
        assert.ok(replay.ok && replay.replayed);
        if (replay.ok) assert.equal(replay.character.ryo, 600);
    });

    it('pays the same 500 ryo for a piece that is currently worn, and frees the slot', async () => {
        const item = (await namedGearSaleItem('holder', armorId))!;
        const worn = holder({ inventory: [weaponId], equipment: { body: armorId } });
        const sold = applyInventorySale(worn, item, 'equipped', 1, 'body', rid(2), 1_000);
        assert.ok(sold.ok); if (!sold.ok) return;
        assert.equal(sold.value.ryo, 500);
        assert.deepEqual(sold.character.equipment, {});
    });

    it('refuses to sell a piece the player does not own', async () => {
        const item = (await namedGearSaleItem('holder', armorId))!;
        const sold = applyInventorySale(holder({ inventory: [] }), item, 'backpack', 1, undefined, rid(3), 1_000);
        assert.equal(sold.ok, false);
    });

    it('the price does not depend on the ever equipped record (worn pieces can always go to the shop)', async () => {
        const item = (await namedGearSaleItem('holder', armorId))!;
        const sold = applyInventorySale(holder({ equippedNamedGear: [armorId] }), item, 'backpack', 1, undefined, rid(4), 1_000);
        assert.ok(sold.ok && sold.value.ryo === 500);
    });
});
