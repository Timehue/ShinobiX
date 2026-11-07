import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { combatEquipment, gatheringTool, gatheringToolRemaining, initializeGatheringTool, isGatheringToolSlot, useGatheringTool } from './gathering-tools.js';

describe('combat equipment', () => {
    it('drops every gathering tool slot and keeps every battle slot', () => {
        assert.deepEqual(
            combatEquipment({ hand: 'kunai', body: 'vest', pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-golden-fishing-pole', kama: 'tool-basic-harvest-kama' }),
            { hand: 'kunai', body: 'vest' },
        );
    });

    it('drops a tool id stored under a battle slot', () => {
        assert.deepEqual(combatEquipment({ hand: 'tool-golden-pickaxe', head: 'hood' }), { head: 'hood' });
        assert.deepEqual(combatEquipment({ weapon: 'tool-golden-harvest-kama', head: 'hood' }), { head: 'hood' });
    });

    it('returns the same object when there is nothing to drop', () => {
        const equipment = { hand: 'kunai', potion: undefined };
        assert.equal(combatEquipment(equipment), equipment);
        assert.equal(combatEquipment(undefined), undefined);
        assert.equal(combatEquipment(null), null);
    });

    it('names exactly the three tool slots', () => {
        assert.equal(isGatheringToolSlot('pickaxe'), true);
        assert.equal(isGatheringToolSlot('fishingPole'), true);
        assert.equal(isGatheringToolSlot('kama'), true);
        assert.equal(isGatheringToolSlot('hand'), false);
        assert.equal(isGatheringToolSlot(undefined), false);
    });
});

describe('harvest kama', () => {
    it('copies the pickaxe exactly: price, rarity and durability', () => {
        const pickaxe = gatheringTool('tool-basic-pickaxe')!, kama = gatheringTool('tool-basic-harvest-kama')!;
        assert.deepEqual({ ...kama, id: '', name: '', slot: '' }, { ...pickaxe, id: '', name: '', slot: '' });
        assert.equal(kama.slot, 'kama');
        const golden = gatheringTool('tool-golden-harvest-kama')!;
        assert.deepEqual({ ...golden, id: '', name: '', slot: '' }, { ...gatheringTool('tool-golden-pickaxe')!, id: '', name: '', slot: '' });
    });

    it('wears down with use and leaves its slot on the last one', () => {
        let character: Record<string, unknown> = initializeGatheringTool({ equipment: { kama: 'tool-basic-harvest-kama' } }, 'tool-basic-harvest-kama');
        assert.equal(gatheringToolRemaining(character, 'tool-basic-harvest-kama'), 125);
        for (let use = 1; use < 125; use++) character = useGatheringTool(character, 'kama')!.character;
        const last = useGatheringTool(character, 'kama')!;
        assert.equal(last.broke, true);
        assert.equal((last.character.equipment as Record<string, string>).kama, undefined);
        assert.equal(useGatheringTool(last.character, 'kama'), null);
    });

    it('is not usable from another tool slot', () => {
        assert.equal(useGatheringTool({ equipment: { pickaxe: 'tool-golden-harvest-kama' } }, 'pickaxe'), null);
    });
});
