import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    RARITY_LEVEL_FLOOR,
    NAMED_ITEM_LEVEL_REQ,
    effectiveItemLevelReq,
    meetsItemLevelReq,
} from '../shared/item-level-gate.js';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';

/*
 * Pins the gear level ladder (owner ruling 2026-08-17) and the fact that it is
 * ENFORCED rather than decorative. Lives under api/ because shared/ is not one
 * of the run-tests.mjs scan roots — a test placed next to the module would
 * silently never run.
 */

describe('gear level ladder', () => {
    it('is the owner-set ladder, strictly ascending by rarity', () => {
        assert.deepEqual(RARITY_LEVEL_FLOOR, {
            common: 1,
            uncommon: 15,
            rare: 30,
            epic: 50,
            legendary: 65,
            mythic: 80,
            named: 90,
        });
        const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'named'] as const;
        for (let i = 1; i < order.length; i++) {
            assert.ok(
                RARITY_LEVEL_FLOOR[order[i]] > RARITY_LEVEL_FLOOR[order[i - 1]],
                `${order[i]} must gate later than ${order[i - 1]}`,
            );
        }
        assert.equal(NAMED_ITEM_LEVEL_REQ, 90);
    });

    it('aligns with the rank bands players already feel', () => {
        // statCapForLevel steps at 15 / 30 / 50 / 80 — the ladder should land on
        // those, so "new rank" and "new gear tier" are the same moment.
        assert.equal(RARITY_LEVEL_FLOOR.uncommon, 15);  // Genin
        assert.equal(RARITY_LEVEL_FLOOR.rare, 30);      // Chunin
        assert.equal(RARITY_LEVEL_FLOOR.epic, 50);      // Jonin
        assert.equal(RARITY_LEVEL_FLOOR.mythic, 80);    // Special Jonin
    });

    it('is a FLOOR, never an override — a higher authored gate is kept', () => {
        // The Lv58+ Reckoning relics and the 70/75 legendaries depend on this.
        assert.equal(effectiveItemLevelReq({ rarity: 'legendary', levelReq: 75, cost: 150 }), 75);
        assert.equal(effectiveItemLevelReq({ rarity: 'rare', levelReq: 42, cost: 400 }), 42);
        // …but a too-low or missing authored value is raised to the floor.
        assert.equal(effectiveItemLevelReq({ rarity: 'legendary', levelReq: 40, cost: 150 }), 65);
        assert.equal(effectiveItemLevelReq({ rarity: 'mythic', cost: 100 }), 80);
        assert.equal(effectiveItemLevelReq({ rarity: 'epic', cost: 1050 }), 50);
    });

    it('⛔ the ladder governs PRICED gear only — content-granted items keep their own gate', () => {
        // Rarity is a proxy for power, not availability. The Aura Sphere is a
        // legendary handed out by a level-9 event; hunt materials are epic
        // crafting drops. Flooring those by rarity would lock a keystone behind
        // L65 and make hunters unable to use what they farm.
        assert.equal(effectiveItemLevelReq({ rarity: 'legendary', cost: 0 }), 1, 'Aura Sphere shape');
        assert.equal(effectiveItemLevelReq({ rarity: 'epic', cost: 0 }), 1, 'hunt material shape');
        // A content item that DOES author a gate keeps exactly that gate.
        assert.equal(effectiveItemLevelReq({ rarity: 'epic', cost: 0, levelReq: 58 }), 58);
        // Forged gear is the exception: minted at cost 0, always floored at 90.
        assert.equal(effectiveItemLevelReq({ rarity: 'named', cost: 0 }), 90);
    });

    it('priced service documents keep their authored gate instead of inheriting a gear tier', () => {
        const approval = ITEM_CATALOG['profession-change-approval'];
        assert.ok(approval?.serviceItem);
        assert.equal(effectiveItemLevelReq(approval), 13);
        assert.equal(meetsItemLevelReq(approval, 12), false);
        assert.equal(meetsItemLevelReq(approval, 13), true);
    });

    it('fails SAFE on junk — an unreadable rarity never becomes a free pass', () => {
        assert.equal(effectiveItemLevelReq({ rarity: 'nonsense', cost: 500 }), 1);
        assert.equal(effectiveItemLevelReq({}), 1);
        assert.equal(effectiveItemLevelReq(null), 1);
        assert.equal(effectiveItemLevelReq(undefined), 1);
        // A negative or non-numeric levelReq cannot lower the floor.
        assert.equal(effectiveItemLevelReq({ rarity: 'mythic', levelReq: -999, cost: 100 }), 80);
        assert.equal(effectiveItemLevelReq({ rarity: 'mythic', levelReq: 'free', cost: 100 }), 80);
    });

    it('meetsItemLevelReq compares against the effective requirement', () => {
        assert.equal(meetsItemLevelReq({ rarity: 'common', cost: 180 }, 1), true);
        assert.equal(meetsItemLevelReq({ rarity: 'mythic', cost: 100 }, 79), false);
        assert.equal(meetsItemLevelReq({ rarity: 'mythic', cost: 100 }, 80), true);
        assert.equal(meetsItemLevelReq({ rarity: 'named' }, 89), false);
        assert.equal(meetsItemLevelReq({ rarity: 'named' }, 90), true);
        // Junk level reads as 1, never as "high enough".
        assert.equal(meetsItemLevelReq({ rarity: 'mythic', cost: 100 }, undefined), false);
        assert.equal(meetsItemLevelReq({ rarity: 'mythic', cost: 100 }, NaN), false);
    });

    it('every PRICED catalog item resolves to a requirement inside its tier', () => {
        for (const item of Object.values(ITEM_CATALOG)) {
            if (!(Number(item.cost) > 0)) continue; // content-granted, see above
            const req = effectiveItemLevelReq(item);
            if (item.serviceItem === true) {
                assert.equal(req, item.levelReq, `${item.id} service item must keep its authored requirement`);
                continue;
            }
            const floor = RARITY_LEVEL_FLOOR[item.rarity as keyof typeof RARITY_LEVEL_FLOOR] ?? 1;
            assert.ok(req >= floor, `${item.id} (${item.rarity}) resolved to ${req}, below its ${floor} floor`);
            assert.ok(req <= 100, `${item.id} resolved to ${req}, above max level`);
        }
    });

    it('the Aura Sphere stays equippable from the event that grants it', () => {
        const sphere = ITEM_CATALOG['aura-sphere'];
        assert.ok(sphere, 'aura-sphere must exist in the catalog');
        assert.equal(effectiveItemLevelReq(sphere), 1,
            'the Aura Sphere is a legendary granted by a level-9 event — it must never be rarity-gated');
    });

    it('no common item is gated past the starting rank', () => {
        for (const item of Object.values(ITEM_CATALOG)) {
            if (item.rarity !== 'common' || !(Number(item.cost) > 0)) continue;
            assert.ok(
                effectiveItemLevelReq(item) < RARITY_LEVEL_FLOOR.uncommon,
                `${item.id} is common but gated at ${effectiveItemLevelReq(item)} — starter gear must stay reachable`,
            );
        }
    });
});

describe('gear level ladder — enforcement is wired, not decorative', () => {
    const root = process.cwd();
    const shop = readFileSync(join(root, 'api', 'shop', '_settlement.ts'), 'utf8');
    const save = readFileSync(join(root, 'api', 'save', '[name].ts'), 'utf8');
    const named = readFileSync(join(root, 'api', 'craft', '_named.ts'), 'utf8');
    const forge = readFileSync(join(root, 'api', 'craft', '_forge.ts'), 'utf8');

    it('the shop refuses a purchase above the buyer level', () => {
        assert.match(shop, /meetsItemLevelReq\(item, character\.level\)/);
    });

    it('the save path refuses to EQUIP above the wearer level', () => {
        assert.match(save, /meetsItemLevelReq\(gated, equipLevel\)/);
    });

    it('the equip gate reads the STORED level, never the client-supplied one', () => {
        // enforceEquipmentOwnership runs before applyDerivedLevel, so char.level
        // is still untrusted at that point.
        assert.match(save, /const equipLevel = Math\.max\(1, Math\.floor\(Number\(stored\.level\) \|\| 1\)\)/);
        assert.doesNotMatch(save, /meetsItemLevelReq\([^)]*char\.level/);
    });

    it('already-equipped gear is grandfathered so a ladder change strips nothing', () => {
        const block = save.slice(save.indexOf('function enforceEquipmentOwnership'));
        const gate = block.indexOf('meetsItemLevelReq');
        const guard = block.lastIndexOf('if (!grandfathered)', gate);
        assert.ok(guard > 0 && guard < gate, 'the level gate must sit inside the !grandfathered branch');
    });

    it('forged named gear is gated at 90 via the shared constant', () => {
        assert.match(named, /levelReq: NAMED_ITEM_LEVEL_REQ/);
        assert.doesNotMatch(named, /levelReq: 30/);
    });

    it('crafting gates on the LADDER, not the raw field', () => {
        // Crafting is an acquisition path like buying — reading item.levelReq
        // directly would let a player craft a tier they cannot wear.
        assert.match(forge, /count\(character\.level\) < effectiveItemLevelReq\(item\)/);
        assert.doesNotMatch(forge, /count\(item\.levelReq/);
    });

    it('the named FORGE itself is level-locked, not just the result', () => {
        const namedHandler = readFileSync(join(root, 'api', 'craft', 'named.ts'), 'utf8');
        assert.match(namedHandler, /forgeLevelBlocked/);
        assert.match(namedHandler, /level < NAMED_ITEM_LEVEL_REQ/);
        // Gated BEFORE the roll branch, so a low-level player is refused at the
        // step they think of as "rolling for" a piece — not after paying.
        const gate = namedHandler.indexOf('forgeLevelBlocked(playerName)');
        const rollBranch = namedHandler.indexOf("action === 'roll'");
        assert.ok(gate > 0 && gate < rollBranch, 'the level gate must precede the roll branch');
        // …and it reads the stored save, never a client-supplied level.
        assert.match(namedHandler, /kv\.get<\{ character\?: \{ level\?: unknown \} \}>\(`save:/);
    });

    it('the client mirrors the ladder so it never offers a blocked action', () => {
        const shopUi = readFileSync(join(root, 'shinobij.client', 'src', 'components', 'Shop.tsx'), 'utf8');
        const inventoryUi = readFileSync(join(root, 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
        assert.match(shopUi, /meetsItemLevelReq\(item, character\.level\)/);
        assert.match(inventoryUi, /meetsItemLevelReq\(item, character\.level\)/);
        // The raw field must not leak back into the UI: most high-rarity items
        // author none, so it would read as "no requirement".
        assert.doesNotMatch(shopUi, /item\.levelReq/);
        assert.doesNotMatch(shopUi, /selectedItem\.levelReq/);
    });
});
