import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { combatEquipment, isGatheringToolSlot } from './gathering-tools.js';

describe('combat equipment', () => {
    it('drops both gathering tool slots and keeps every battle slot', () => {
        assert.deepEqual(
            combatEquipment({ hand: 'kunai', body: 'vest', pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-golden-fishing-pole' }),
            { hand: 'kunai', body: 'vest' },
        );
    });

    it('drops a tool id stored under a battle slot', () => {
        assert.deepEqual(combatEquipment({ hand: 'tool-golden-pickaxe', head: 'hood' }), { head: 'hood' });
    });

    it('returns the same object when there is nothing to drop', () => {
        const equipment = { hand: 'kunai', potion: undefined };
        assert.equal(combatEquipment(equipment), equipment);
        assert.equal(combatEquipment(undefined), undefined);
        assert.equal(combatEquipment(null), null);
    });

    it('names exactly the two tool slots', () => {
        assert.equal(isGatheringToolSlot('pickaxe'), true);
        assert.equal(isGatheringToolSlot('fishingPole'), true);
        assert.equal(isGatheringToolSlot('hand'), false);
    });
});
