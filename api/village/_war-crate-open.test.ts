import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyWarCrateOpen,
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    WARFORGED_RELIC_ID,
} from './_war-crate-open.js';

describe('_war-crate-open', () => {
    it('consumes exactly one crate and grants the sealed reward', () => {
        const result = applyWarCrateOpen({
            inventory: ['starter', LEGENDARY_WAR_CRATE_ID, LEGENDARY_WAR_CRATE_ID],
            profession: 'vanguard',
            ryo: 25,
            honorSeals: 2,
            boneCharms: 3,
        }, true);
        assert.ok(result);
        assert.deepEqual(result.reward, { ryo: 500, honorSeals: 10, boneCharms: 1, gotDungeonKey: true });
        assert.deepEqual(result.character.inventory, ['starter', LEGENDARY_WAR_CRATE_ID, WARFORGED_RELIC_ID, DUNGEON_KEY_ID]);
        assert.equal(result.character.ryo, 525);
        assert.equal(result.character.honorSeals, 12);
        assert.equal(result.character.boneCharms, 4);
    });

    it('grants no Honor Seals to non-Vanguards and does not mutate input', () => {
        const input = { inventory: [LEGENDARY_WAR_CRATE_ID], profession: 'healer', ryo: 0 };
        const result = applyWarCrateOpen(input, false);
        assert.ok(result);
        assert.equal(result.reward.honorSeals, 0);
        assert.deepEqual(input.inventory, [LEGENDARY_WAR_CRATE_ID]);
        assert.deepEqual(result.character.inventory, [WARFORGED_RELIC_ID]);
    });

    it('refuses to mint rewards without a stored crate', () => {
        assert.equal(applyWarCrateOpen({ inventory: [], ryo: 100 }, true), null);
    });
});
