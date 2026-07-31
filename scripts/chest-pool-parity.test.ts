import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rollAncientChestLoot } from '../api/world/_chest.ts';
import { sectorExploreReward } from '../api/world/_explore.ts';
import {
    VILLAGE_WAR_DAILY_MISSIONS as SERVER_WAR_MISSIONS,
    VILLAGE_WAR_RAIDS_PER_MISSION as SERVER_RAIDS_PER_MISSION,
} from '../api/village/_war-mission.ts';
import { readFileSync } from 'node:fs';
import { shinobiTileCards } from '../shared/tile-cards.ts';
import { starterItems } from '../shinobij.client/src/data/starter-items.ts';

/*
 * The world map used to roll its own Ancient Chest and hand the loot to the
 * generic save, which discarded every card and every premium currency in it.
 * The roll now comes from api/world/_chest.ts, so that table has to be able to
 * produce the same loot the client's own roll could — otherwise migrating to it
 * silently shrinks the chest, or hands out an id the client cannot render.
 *
 * This lives in scripts/ because it imports BOTH sides: api/** is compiled by
 * tsconfig.cpanel.json (which excludes shinobij.client), so a server-side test
 * cannot import client data. scripts/ is excluded from that build and is a
 * run-tests.mjs scan root — the same home as the other cross-boundary parity
 * tests (pet-catalog, spire-parity, warfront-parity).
 */

function sequence(...values: number[]) { let i = 0; return () => values[i++] ?? 0; }

// Sweep the pick roll across [0, 1) with the slot roll pinned, and collect every
// distinct id the table can produce for that slot. Leading 0.9 skips the
// bonus-ryo gate (consuming one value, not two); the trailing 0.9 skips aura dust.
function poolFor(slotRoll: number, field: 'cardId' | 'itemId', samples = 400): string[] {
    const out = new Set<string>();
    for (let i = 0; i < samples; i++) {
        const id = rollAncientChestLoot(1, sequence(0.9, slotRoll, i / samples, 0.9))?.[field];
        if (id) out.add(id);
    }
    return [...out].sort();
}

describe('ancient chest pools mirror the client catalogs', () => {
    it('can drop every common and every rare tile card', () => {
        const catalog = (rarity: string) => shinobiTileCards
            .filter((card) => card.rarity === rarity).map((card) => card.id).sort();
        assert.deepEqual(poolFor(0.7, 'cardId'), catalog('common'));
        assert.deepEqual(poolFor(0.85, 'cardId'), catalog('rare'));
    });

    it('can drop every chest-eligible common and rare gear item', () => {
        // Mirrors the client's old filter: rarity match, excluding the `item` slot.
        const eligible = (rarity: string) => starterItems
            .filter((item) => item.rarity === rarity && item.slot !== 'item')
            .map((item) => item.id).sort();
        assert.deepEqual(poolFor(0.3, 'itemId'), eligible('common'));
        assert.deepEqual(poolFor(0.6, 'itemId'), eligible('rare'));
    });

    it('never rolls an id outside the catalogs the client renders from', () => {
        const knownCards = new Set(shinobiTileCards.map((card) => card.id));
        const knownItems = new Set(starterItems.map((item) => item.id));
        const treats = new Set(['pet-treat', 'elemental-pet-treat', 'ancient-pet-treat']);
        for (let slot = 0; slot < 1; slot += 0.01) {
            for (const pick of [0, 0.25, 0.5, 0.75, 0.999]) {
                const loot = rollAncientChestLoot(30, sequence(0.9, slot, pick, 0.9));
                assert.ok(loot, 'sector 30 is a valid world sector');
                if (loot!.cardId) assert.ok(knownCards.has(loot!.cardId), `unknown card ${loot!.cardId}`);
                if (loot!.itemId) {
                    assert.ok(knownItems.has(loot!.itemId) || treats.has(loot!.itemId), `unknown item ${loot!.itemId}`);
                }
            }
        }
    });
});

describe('world-map settlement mirrors the client', () => {
    it('pays the same explore ryo the world map announces', () => {
        // WorldMap.tsx prints this figure in the "Sector N explored" notice while
        // api/world/_explore.ts credits it, so a drift would show one number and
        // bank another.
        for (const sector of [1, 7, 25, 42, 60]) {
            const clientFormula = 10 + Math.floor(sector / 4) + 10 + Math.floor(sector / 10);
            assert.equal(sectorExploreReward(sector)?.ryo, clientFormula, `sector ${sector}`);
        }
    });

    it('agrees with the client on the village-war mission requirements', () => {
        // The Logbook builds its mission list and raid targets from its own
        // copies. If these drift, it offers a claim the server refuses.
        //
        // Read as SOURCE, not imported: lib/world-state.ts reaches components
        // that import .css, which tsx cannot load under node:test.
        const source = readFileSync(new URL('../shinobij.client/src/lib/world-state.ts', import.meta.url), 'utf8');
        const read = (name: string) => {
            const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
            assert.ok(match, `${name} must be exported from world-state.ts`);
            return Number(match![1]);
        };
        assert.equal(SERVER_WAR_MISSIONS, read('VILLAGE_WAR_DAILY_MISSIONS'));
        assert.equal(SERVER_RAIDS_PER_MISSION, read('VILLAGE_WAR_RAIDS_PER_MISSION'));
    });
});
