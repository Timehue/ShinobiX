/*
 * Road beast client/server parity. The World Map names and paints a beast from
 * the CLIENT pet pool; the server fields it from PET_CATALOG. Both feed the same
 * shared rule (shared/wanderer-beast.ts), so they agree only while the two
 * catalogs offer the same wild pets of each rarity. If they drift, the map
 * promises one species and the fight brings another — the bug this rule fixed.
 *
 * Lives in scripts/ because it imports both the client pool and the server
 * catalog, and api/ tests compile into the server build.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { rawPetPool } from '../shinobij.client/src/data/pet-pool';
import { PET_CATALOG } from '../api/pet/_catalog';
import { isWildSpeciesOfRarity, wandererBeastSpecies } from '../shared/wanderer-beast';

const RARITIES = ['standard', 'rare', 'legendary', 'mythic', undefined];
const SERVER = Object.values(PET_CATALOG);

test('the client pool and the server catalog offer the same wild pets per rarity', () => {
    for (const rarity of RARITIES) {
        const client = rawPetPool.filter((tpl) => isWildSpeciesOfRarity(tpl, rarity)).map((tpl) => [tpl.id, tpl.name]).sort();
        const server = SERVER.filter((tpl) => isWildSpeciesOfRarity(tpl, rarity)).map((tpl) => [tpl.id, tpl.name]).sort();
        assert.ok(client.length > 0, `no wild ${rarity ?? 'default'} pets`);
        assert.deepEqual(client, server, `wild ${rarity ?? 'default'} pools differ`);
    }
});

test('the map and the fight pick the same species for every beast and rarity', () => {
    for (let sector = 1; sector <= 40; sector += 1) {
        for (const index of [0, 1, 2]) {
            const id = `w-${sector}-81234-${index}`;
            for (const rarity of RARITIES) {
                const shown = wandererBeastSpecies(id, rarity, rawPetPool);
                const fielded = wandererBeastSpecies(id, rarity, SERVER);
                assert.equal(shown?.id, fielded?.id, `${id} at ${rarity}`);
                assert.equal(shown?.name, fielded?.name, `${id} at ${rarity}`);
            }
        }
    }
});
