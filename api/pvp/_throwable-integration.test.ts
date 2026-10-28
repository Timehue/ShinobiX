import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SUPPLY_CRAFT_RECIPES } from '../../shared/crafting-recipes.js';
import { supplyCraftRyo } from '../../shared/craft-fees.js';
import { RARITY_LEVEL_FLOOR } from '../../shared/item-level-gate.js';
import { applyForge, countOwned } from '../craft/_forge.js';
import { purchaseCatalogItem } from '../shop/_purchase.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import { applyAction, startRound } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { makeRng } from '../towers/_sim.js';
import { createTowerSession, type TowerActor } from '../towers/_tower-session.js';
import { deductUsedItems } from './_consumable-settlement.js';
import { ITEM_CATALOG } from './_item-catalog.js';
import { hydrateCharacterFromSave, sealItemCharges, type PvpFighter } from './session.js';

const THROWABLES = [
    { id: 'thrown-shuriken', damage: 896, effect: undefined },
    { id: 'thrown-senbon', damage: 640, effect: 'Wound' },
    { id: 'thrown-serpent-dust', damage: 320, effect: 'Poison' },
] as const;

// One legacy loose copy and one modern stack: both must fund the same sealed
// ammo budget, and stale client/save copies must never override built-in stats.
function storedCharacter(id: string) {
    return {
        name: 'thrower', level: 100, specialty: 'Bukijutsu', stats: {}, jutsu: [],
        jutsuMastery: [], equipment: { thrown: id }, inventory: [id],
        itemStacks: [{ itemId: id, count: 1 }], ryo: 10000,
    };
}

function fighter(name: string, pos: number, character: Record<string, unknown>): PvpFighter {
    return {
        name, pos, character, hp: 10000, maxHp: 10000,
        chakra: 10000, maxChakra: 10000, stamina: 10000, maxStamina: 10000,
        shield: 0, statuses: [],
    };
}

const FLOOR: TowerFloor = {
    id: 1, name: 'Throwable audit', biome: 'central', objective: 'defeat-all',
    roundBudget: 8, map: { width: 8, height: 8 }, fieldRule: { kind: 'none' },
    enemies: [], firstClearReward: {},
};

it('Senbon crafting uses the rare level boundary and deducts only a successful craft', () => {
    const id = 'thrown-senbon';
    const recipe = SUPPLY_CRAFT_RECIPES[id]!;
    assert.equal(recipe.levelReq, RARITY_LEVEL_FLOOR.rare);
    const character = { level: RARITY_LEVEL_FLOOR.rare - 1, ryo: 10000,
        itemStacks: recipe.ingredients.map(row => ({ itemId: row.ids[0], count: row.count })) };
    const before = structuredClone(character);
    assert.equal(applyForge(character, 'supply', id, 1), null);
    assert.deepEqual(character, before);
    const crafted = applyForge({ ...character, level: RARITY_LEVEL_FLOOR.rare }, 'supply', id, 1);
    assert.ok(crafted);
    assert.equal(countOwned(crafted, id), recipe.count ?? 1);
    assert.equal(crafted.ryo, 10000 - supplyCraftRyo(id, ITEM_CATALOG[id]!.cost, recipe.count ?? 1));
    for (const material of character.itemStacks) assert.equal(countOwned(crafted, material.itemId), 0);
});

for (const { id, damage, effect } of THROWABLES) describe(`${id}: acquisition → saved loadout → combat → inventory`, () => {
    const stored = () => storedCharacter(id);
    const hydrated = () => hydrateCharacterFromSave(stored(), {}, { creatorItems: [] });

    it('publishes range metadata and ignores obsolete built-in copies in saves and client loadouts', () => {
        const stale = { ...ITEM_CATALOG[id], weaponEp: 999, weaponEffectValue: 999, weaponRange: 99, apCost: 1 };
        const save = { creatorItems: [stale] };
        const client = { pvpItems: [stale] };
        for (const character of [
            hydrateCharacterFromSave(stored(), client, save),
            sealTowerFighter(stored(), save, client, null),
        ]) {
            const item = (character.pvpItems as Array<Record<string, unknown>>).find(item => item.id === id)!;
            assert.equal(item.weaponEp, ITEM_CATALOG[id]!.weaponEp);
            assert.equal(item.weaponEffectValue, ITEM_CATALOG[id]!.weaponEffectValue);
            assert.equal(item.weaponRange, 4);
            assert.equal(item.apCost, 20);
            assert.equal(item.weaponCooldown, 5);
        }
    });

    it('uses current shelf prices and crafting fees, stacks, and caps ownership at 50', () => {
        const bought = purchaseCatalogItem(stored(), id, 1);
        assert.ok(bought.ok);
        assert.equal(bought.item.unitCost, 1600);
        assert.equal(countOwned(bought.character, id), 3);
        assert.equal(bought.character.ryo, 8400);
        const recipe = SUPPLY_CRAFT_RECIPES[id]!;
        const materials = recipe.ingredients.map(row => ({ itemId: row.ids[0], count: row.count }));
        const crafted = applyForge({ level: 100, ryo: 10000, itemStacks: materials }, 'supply', id, 1);
        assert.ok(crafted);
        assert.equal(countOwned(crafted, id), recipe.count ?? 1);
        assert.equal(crafted.ryo, 10000 - supplyCraftRyo(id, ITEM_CATALOG[id]!.cost, recipe.count ?? 1));
        for (const material of materials) assert.equal(countOwned(crafted, material.itemId), 0);
        const full = { ...stored(), inventory: [], itemStacks: [{ itemId: id, count: 50 }] };
        assert.equal(purchaseCatalogItem(full, id, 1).ok, false);
        assert.equal(applyForge({ ...full, itemStacks: [...full.itemStacks, ...materials] }, 'supply', id, 1), null);
    });

    it('uses the catalog payload in Solo PvE, enforces range/cooldown, and deducts one owned copy', () => {
        const player = fighter('thrower', 0, hydrated());
        const enemy = fighter('target', 1, { level: 100, stats: {}, jutsu: [] });
        const session = createSoloPveSession({
            sessionId: `audit-${id}`, ownerSlug: 'thrower', now: 1000,
            encounter: { kind: 'generic-ai', id: 'audit', level: 100 },
            player, enemy, itemCharges: sealItemCharges(player.character, stored()),
        });
        const far = structuredClone(session);
        far.enemy.pos = 5;
        const rejected = applySoloPveAction(far, { type: 'weapon', itemId: id });
        assert.equal(rejected.reason, 'out-of-range');
        assert.equal(rejected.session.itemCharges[id], 2);
        assert.equal(rejected.session.ap.player, 100);
        const empty = structuredClone(session);
        empty.itemCharges[id] = 0;
        const noAmmo = applySoloPveAction(empty, { type: 'weapon', itemId: id });
        assert.equal(noAmmo.reason, 'out-of-item');
        assert.equal(noAmmo.session.ap.player, 100);
        const out = applySoloPveAction(session, { type: 'weapon', itemId: id });
        assert.ok(out.applied, out.reason ?? 'Solo PvE throw was rejected');
        assert.equal(10000 - out.session.enemy.hp, damage);
        assert.equal(out.session.ap.player, 80);
        assert.equal(out.session.itemCharges[id], 1);
        assert.equal(out.session.cooldowns.player[`weapon:${id}`], 5);
        assert.equal(out.session.enemy.statuses.find(status => status.name === effect)?.name, effect);
        assert.equal(applySoloPveAction(out.session, { type: 'weapon', itemId: id }).reason, 'on-cooldown');
        assert.equal(countOwned(deductUsedItems(stored(), out.session.itemsUsed), id), 1);
    });

    it('uses the same payload, AP, ammo, range, and cooldown in the Tower engine', () => {
        const actor = (actorId: string, side: TowerActor['side'], pos: number, character: Record<string, unknown>): TowerActor => ({
            ...fighter(actorId, pos, character), id: actorId, side, ownerSlug: side === 'squad' ? 'thrower' : null,
            ai: side !== 'squad', cooldowns: {},
        });
        const self = actor('sq', 'squad', 0, sealTowerFighter(stored(), { creatorItems: [] }, {}, null));
        self.itemCharges = sealTowerItemCharges(stored());
        const target = actor('en', 'enemy', 1, { level: 100, stats: {} });
        const session = createTowerSession({
            towerId: 'audit', runId: id, floor: 1, seed: 1, partySize: 1, now: 1000,
            map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
            actors: [self, target], objectiveKind: 'defeat-all',
        });
        startRound(session);
        session.turnQueue = ['sq', 'en']; session.activeIndex = 0; session.activeAp = 100;
        target.pos = 5;
        const action = { actorId: 'sq', type: 'weapon' as const, targetId: 'en', itemId: id };
        assert.equal(applyAction(session, FLOOR, action, makeRng(1)).reason, 'out-of-range');
        assert.equal(self.itemCharges[id], 2);
        assert.equal(session.activeAp, 100);
        target.pos = 1;
        const empty = structuredClone(session);
        empty.actors.find(actor => actor.id === 'sq')!.itemCharges![id] = 0;
        assert.equal(applyAction(empty, FLOOR, action, makeRng(1)).reason, 'out-of-ammo');
        assert.equal(empty.activeAp, 100);
        const out = applyAction(session, FLOOR, action, makeRng(1));
        assert.ok(out.applied, out.reason ?? 'Tower throw was rejected');
        assert.equal(10000 - target.hp, damage);
        assert.equal(session.activeAp, 80);
        assert.equal(self.itemCharges[id], 1);
        assert.equal(self.cooldowns[`weapon:${id}`], 5);
        assert.equal(target.statuses.find(status => status.name === effect)?.name, effect);
        assert.equal(applyAction(session, FLOOR, action, makeRng(1)).reason, 'on-cooldown');
        assert.equal(countOwned(deductUsedItems(stored(), self.itemsUsed ?? {}), id), 1);
    });
});
