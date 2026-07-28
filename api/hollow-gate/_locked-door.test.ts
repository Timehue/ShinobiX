import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maxLockedDoorsForDepth, rollHollowLockedDoor } from './_locked-door.js';

describe('Hollow Gate locked-door authority', () => {
    it('keeps the canonical outcome and rarity bands', () => {
        const chestValues = [0.1, 0.4, 0.5, 0.1, 0.5]; let chestIndex = 0;
        const chest = rollHollowLockedDoor(() => chestValues[chestIndex++] ?? 0.5, 1, 5);
        assert.equal(chest.outcome, 'chest');
        // Character XP retired: the old xp line (100 + floor·10) is now a
        // guaranteed ryo floor (75 + floor·8); this sequence also wins the
        // 50% bonus ryo roll (0.4 → +100+floor(0.5·401)=+300).
        assert.equal(chest.loot?.xp, 0);
        assert.equal(chest.loot?.ryo, (75 + 40) + 100 + 200);
        assert.equal(chest.loot?.hollowShards, 15);
        assert.equal(rollHollowLockedDoor(() => 0.6).outcome, 'trap');
        for (const [roll, rarity] of [[0.8, 'rare'], [0.995, 'legendary'], [0.999, 'mythic']] as const) {
            const values = [roll, 0]; let i = 0;
            const result = rollHollowLockedDoor(() => values[i++] ?? 0, 123);
            assert.equal(result.outcome, 'pet');
            assert.equal(result.rarity, rarity);
            assert.equal(result.pet?.rarity, rarity);
            assert.match(String(result.pet?.id), /-hg-123$/);
        }
    });

    it('bounds distinct locked-door rolls by sealed depth', () => {
        assert.equal(maxLockedDoorsForDepth(1), 3);
        assert.equal(maxLockedDoorsForDepth(5), 15);
        assert.equal(maxLockedDoorsForDepth(999), 60);
    });
});
