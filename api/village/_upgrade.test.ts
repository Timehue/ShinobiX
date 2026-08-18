import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { purchaseVillageUpgrade, villageUpgradeCostServer, readVillageUpgrades, VILLAGE_UPGRADE_MAX_LEVEL } from './_upgrade.js';

/*
 * Village upgrades are SHARED village infrastructure paid for out of the
 * treasury Honor Seal pool (owner ruling 2026-08-17). They used to sit on
 * `character.villageUpgrades` and be bought with the seated Kage's PERSONAL
 * seals — so the Kage paid and only the Kage benefited, and a Vanguard's PvP
 * bought their village nothing.
 */

const state = (seals: number, upgrades: Record<string, number> = {}) =>
    ({ treasury: { honorSeals: seals }, upgrades });

describe('village upgrade authority', () => {
    it('matches the client cost curve', () => {
        assert.equal(villageUpgradeCostServer('training', 0), 10);
        assert.equal(villageUpgradeCostServer('bank', 0), 16);
        // base + 4L + 2·L^1.25 — pinned so the client mirror cannot drift.
        assert.equal(villageUpgradeCostServer('training', 10), Math.floor(10 + 40 + 2 * Math.pow(10, 1.25)));
    });

    it('spends the VILLAGE TREASURY, never a personal balance', () => {
        const out = purchaseVillageUpgrade(state(100), 'training');
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.cost, 10);
        assert.equal(out.nextSeals, 90, 'the treasury pool pays');
        assert.deepEqual(out.upgrades, { training: 1 });
    });

    it('the result is a VILLAGE-wide level, not a per-character one', () => {
        // The returned shape carries `upgrades` for the village record. Nothing
        // here touches a character — that is the whole point of the change.
        const out = purchaseVillageUpgrade(state(500, { shop: 3 }), 'shop');
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.level, 4);
        assert.deepEqual(out.upgrades, { shop: 4 });
        assert.ok(!('character' in (out as Record<string, unknown>)), 'must not return a character');
    });

    it('enforces treasury funds and the level cap', () => {
        assert.equal(purchaseVillageUpgrade(state(0), 'shop').ok, false);
        const broke = purchaseVillageUpgrade(state(0), 'shop');
        if (!broke.ok) assert.equal(broke.reason, 'insufficient-treasury-seals');
        const maxed = purchaseVillageUpgrade(state(99999, { shop: VILLAGE_UPGRADE_MAX_LEVEL }), 'shop');
        assert.equal(maxed.ok, false);
        if (!maxed.ok) assert.equal(maxed.reason, 'village-upgrade-max');
        assert.equal(purchaseVillageUpgrade(state(99999), 'notARealTrack').ok, false);
    });

    it('normalizes a junk or hostile upgrades blob', () => {
        assert.deepEqual(readVillageUpgrades(null), {});
        assert.deepEqual(readVillageUpgrades({ upgrades: [1, 2] }), {});
        assert.deepEqual(readVillageUpgrades({ upgrades: { shop: 999, bogus: 5, bank: -3 } }), { shop: VILLAGE_UPGRADE_MAX_LEVEL });
    });
});

describe('village upgrade route — shared-state safety', () => {
    const route = readFileSync(join(process.cwd(), 'api', 'village', 'upgrade.ts'), 'utf8');

    it('serializes the treasury read-modify-write failClosed', () => {
        // Shared currency pool: an unlocked RMW here would mint or lose seals.
        assert.match(route, /withKvLock[\s\S]{0,80}?\(stateKey/);
        assert.match(route, /\{ failClosed: true \}/);
    });

    it('stays seated-Kage only', () => {
        assert.match(route, /Only the seated Kage can upgrade village structures/);
        assert.match(route, /safeName\(String\(state\.seatedKage \?\? ''\)\) !== playerName/);
    });

    it('writes the levels to the VILLAGE record, not to a save', () => {
        assert.match(route, /kv\.set\(stateKey, \{ \.\.\.state, treasury: .*upgrades: result\.upgrades \}\)/);
        assert.doesNotMatch(route, /mutatePlayerSave/);
    });
});

describe('village upgrades are server-owned on the SHARED blob', () => {
    const validator = readFileSync(join(process.cwd(), 'api', '_village-state-validate.ts'), 'utf8');
    const save = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');

    it('⛔ the villageState blob merge cannot carry a client-authored upgrade level', () => {
        // `const next = { ...prev, ...incoming }` merges unknown keys straight
        // through, so without an explicit rule ANY villager could POST
        // `upgrades: { training: 50, ... }` onto the shared record — and from
        // there onto every member's mirror, paying real bank interest, mission
        // rewards, shop discount and training rate.
        assert.match(validator, /if \(prev\.upgrades !== undefined\) next\.upgrades = prev\.upgrades;/);
        assert.match(validator, /upgrades change via save blob blocked/);
    });

    it('the character mirror is refreshed from the village record on every save', () => {
        // A change-triggered refresh cannot work: the client never has a reason
        // to send a different value, so the mirror would never move and the
        // upgrades would benefit nobody.
        const block = save.slice(save.indexOf('Village upgrade mirror'));
        assert.match(block, /out\.villageUpgrades = readVillageUpgrades\(villageState\)/);
        assert.doesNotMatch(block.slice(0, block.indexOf('return {')), /sameVillageUpgrades/);
    });

    it('a village-state read failure keeps the stored mirror, never zeroes it', () => {
        const block = save.slice(save.indexOf('Village upgrade mirror'));
        assert.match(block, /catch \{[\s\S]{0,400}?exChar\.villageUpgrades/);
    });

    it('leaving a village drops the mirror so its bonuses stop paying', () => {
        const block = save.slice(save.indexOf('Village upgrade mirror'));
        assert.match(block, /if \(!finalVillage\) \{\s*\n\s*delete out\.villageUpgrades;/);
    });
});
