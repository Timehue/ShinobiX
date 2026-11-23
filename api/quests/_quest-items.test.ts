import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { hydrateCharacterFromSave } from '../pvp/session.js';
import { sanitizeCharacterSave } from '../save/[name].js';
import { applyTreasuryDonation } from '../_treasury-donate.js';
import { isSellableItem, npcSaleValue } from '../inventory/_sale.js';
import { sealAsset } from '../festival/_exchange-assets.js';
import type { SettlementCatalogs, SettlementItem } from '../shop/_catalog.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { QUEST_ITEMS, QUEST_ITEM_ICON_STAND_INS, isQuestOnlyItem, questItem } from '../../shared/quest-items.js';
import { QUEST_SITES } from '../../shared/quest-sites.js';
import { RELIC_ROSTER, isQuestRewardRelic } from '../../shared/relics.js';
import { coastSite } from '../../shared/coast-world.js';

/** Tests run from the repo root (scripts/run-tests.mjs). */
const PUBLIC_DIR = join(process.cwd(), 'shinobij.client', 'public');

/*
 * A quest item must stay inside its quest. These walk every door one could
 * leave by and prove each is shut: wearing it, carrying it into a fight,
 * selling it, listing it on the Exchange, and donating it to a treasury.
 */

const TOOL = 'quest-signal-shard';
const USED_TOOL = 'quest-stand-down-order';
const MATERIAL = 'quest-wrack-cord';

describe('the quest item catalogue', () => {
    it('gives every quest item a catalogue entry that is free, stacked and marked quest-only', () => {
        assert.ok(QUEST_ITEMS.length > 0);
        for (const item of QUEST_ITEMS) {
            const entry = ITEM_CATALOG[item.id];
            assert.ok(entry, `${item.id} is in the server catalogue`);
            assert.equal(entry.cost, 0, `${item.id} has no price`);
            assert.equal(entry.questOnly, true, item.id);
            assert.equal(entry.stackable, true, item.id);
            assert.match(item.id, /^quest-[a-z0-9-]+$/, 'quest item ids share one prefix');
            // An item's icon is its own file. A material whose icon is not painted
            // yet may borrow a shipped one, and only until its own file arrives.
            const own = `/items/${item.id}-v1.webp`;
            const standIn = QUEST_ITEM_ICON_STAND_INS[item.id];
            assert.equal(item.image, standIn ?? own);
            if (standIn) {
                assert.equal(item.kind, 'material', `${item.id}: only a material may borrow an icon`);
                assert.equal(existsSync(join(PUBLIC_DIR, own)), false, `${item.id} has its own icon now: remove its stand-in`);
                assert.equal(existsSync(join(PUBLIC_DIR, standIn)), true, `${item.id}: its stand-in icon is not shipped`);
            }
            assert.equal(isQuestOnlyItem(item.id), true);
            assert.doesNotMatch(item.description, /[–—]|--/, `${item.id}: no dash pauses in player text`);
        }
        assert.equal(isQuestOnlyItem('shop-shuriken'), false);
        assert.equal(isQuestOnlyItem(undefined), false);
        assert.equal(questItem(TOOL)?.kind, 'tool');
    });

    it('marks no ordinary item as quest-only', () => {
        const marked = Object.values(ITEM_CATALOG).filter(entry => entry.questOnly).map(entry => entry.id).sort();
        assert.deepEqual(marked, QUEST_ITEMS.map(item => item.id).sort());
    });

    it('binds every quest site to a painted coast site and a quest material', () => {
        for (const site of Object.values(QUEST_SITES)) {
            assert.ok(coastSite(site.id), `${site.id} is a site the coast's art painted`);
            assert.equal(questItem(site.itemId)?.kind, 'material', `${site.id} yields a quest material`);
            assert.ok(site.level >= 1 && site.level <= 10);
        }
    });
});

describe('a quest item cannot leave its quest', () => {
    // The save sanitizer has two equipment paths: the strict ledger (the code
    // default) and the emergency non-strict one. Both must refuse.
    const sanitizeIn = (strict: boolean) => (incoming: Record<string, unknown>, stored: Record<string, unknown>) => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        if (strict) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = '0';
        try {
            return sanitizeCharacterSave({ character: incoming }, { character: stored }).character as Record<string, unknown>;
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    };
    const stackCount = (character: Record<string, unknown>, itemId: string) =>
        ((character.itemStacks ?? []) as Array<{ itemId: string; count: number }>).find(stack => stack.itemId === itemId)?.count ?? 0;

    for (const [mode, strict] of [['strict ledger', true], ['non-strict ledger', false]] as const) {
        const sanitize = sanitizeIn(strict);

        it(`cannot be equipped, in any slot it would otherwise fit (${mode})`, () => {
            const stored = { name: 'Holder', level: 60, inventory: [], equipment: {}, itemStacks: [{ itemId: TOOL, count: 3 }, { itemId: USED_TOOL, count: 2 }] };
            const out = sanitize({ ...stored, equipment: { thrown: TOOL, item1: USED_TOOL } }, stored);
            assert.deepEqual(out.equipment, {}, 'neither tool was equipped');
            assert.equal(stackCount(out, TOOL), 3, 'the tool stays in the backpack, untouched');
            assert.equal(stackCount(out, USED_TOOL), 2);
        });

        it(`is not grandfathered: a save that already wears one has it taken off and loses nothing (${mode})`, () => {
            // The thrown and item slots point at the backpack stack; they never
            // hold a unit of their own. So taking the tool off costs nothing.
            const stored = { name: 'Holder', level: 60, inventory: [], equipment: { thrown: TOOL }, itemStacks: [{ itemId: TOOL, count: 2 }] };
            const out = sanitize({ ...stored }, stored);
            assert.deepEqual(out.equipment, {});
            assert.equal(stackCount(out, TOOL), 2, 'the stack is untouched');
        });
    }

    it('is never armed for a fight from a save, PvP or PvE', () => {
        const save = { name: 'Holder', level: 60, stats: {}, inventory: ['shop-shuriken'], itemStacks: [{ itemId: TOOL, count: 3 }], equipment: { thrown: TOOL, item1: 'shop-shuriken' } };
        const fighter = hydrateCharacterFromSave(save, {}, { character: save, creatorItems: [] });
        const armed = (Array.isArray(fighter.pvpItems) ? fighter.pvpItems : []) as Array<{ id?: string }>;
        assert.equal(armed.some(item => item.id === TOOL), false, 'the quest tool is not in the sealed loadout');
    });

    it('cannot be sold', () => {
        for (const id of [TOOL, USED_TOOL, MATERIAL]) {
            const item = ITEM_CATALOG[id] as SettlementItem;
            assert.equal(isSellableItem(item), false, id);
            assert.equal(npcSaleValue(item), 0, id);
        }
    });

    it('cannot be listed on the Exchange', () => {
        const catalogs: SettlementCatalogs = { items: new Map(Object.entries(ITEM_CATALOG) as Array<[string, SettlementItem]>), cards: new Map() };
        const holder = { character: { name: 'Holder', level: 60, inventory: [], itemStacks: [{ itemId: MATERIAL, count: 5 }] } };
        assert.throws(() => sealAsset(holder, catalogs, 'item', MATERIAL), /Quest items cannot be listed/);
    });

    it('cannot be donated to a clan or village treasury', () => {
        const donor = { name: 'Holder', inventory: [], itemStacks: [{ itemId: MATERIAL, count: 5 }] };
        const outcome = applyTreasuryDonation({}, donor, { kind: 'item', itemId: MATERIAL, count: 2 }, { currencyCap: 1_000, itemCountCap: 100 } as never);
        assert.equal(outcome.ok, false);
        assert.match((outcome as { error: string }).error, /Quest items cannot be donated/);
    });
});

/*
 * The coast finale gives one of two relics. They are worn like any relic, so
 * they are not "quest-only" items, but they are bound: the reward of a finished
 * quest line must not reach someone who has not finished it.
 */
describe('a relic a quest gives stays with whoever earned it', () => {
    const CAPSTONES = RELIC_ROSTER.filter(relic => relic.source.kind === 'quest').map(relic => relic.id);
    const DROPPED = 'relic-zenith-lotus';
    const catalogs: SettlementCatalogs = { items: new Map(Object.entries(ITEM_CATALOG) as Array<[string, SettlementItem]>), cards: new Map() };

    it('names the two coast relics, and no relic that drops in the world', () => {
        assert.deepEqual(CAPSTONES, ['coast-quiet-crown-mantle', 'coast-ridgewarden-bracer']);
        for (const id of CAPSTONES) assert.deepEqual([isQuestRewardRelic(id), isQuestOnlyItem(id)], [true, false], id);
        for (const relic of RELIC_ROSTER.filter(entry => entry.source.kind !== 'quest')) assert.equal(isQuestRewardRelic(relic.id), false, relic.id);
        assert.deepEqual([isQuestRewardRelic('no-such-item'), isQuestRewardRelic(undefined)], [false, false]);
    });

    it('cannot be sold, listed on the Exchange or given to a treasury', () => {
        for (const id of CAPSTONES) {
            assert.equal(isSellableItem(ITEM_CATALOG[id] as SettlementItem), false, id);
            const holder = { character: { name: 'Holder', level: 100, inventory: [id], itemStacks: [] } };
            assert.throws(() => sealAsset(holder, catalogs, 'item', id), /earned from a quest cannot be listed/, id);
            const outcome = applyTreasuryDonation({}, holder.character, { kind: 'item', itemId: id, count: 1 }, { currencyCap: 1_000, itemCountCap: 100 } as never);
            assert.deepEqual([outcome.ok, /earned from a quest cannot be donated/.test((outcome as { error?: string }).error ?? '')], [false, true], id);
        }
        // The door is shut for these two only: a relic found in the world still passes it.
        const finder = { character: { name: 'Finder', level: 100, inventory: [DROPPED], itemStacks: [] } };
        assert.doesNotThrow(() => sealAsset(finder, catalogs, 'item', DROPPED));
    });
});
