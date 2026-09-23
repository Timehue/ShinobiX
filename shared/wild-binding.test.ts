import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wildBindingChance, wildBindingSeal, wildBindingSuccess, WILD_BINDING_SEALS } from './wild-binding.js';

describe('wild binding balance contract', () => {
    it('holds five ascending Resolve thresholds', () => {
        assert.deepEqual(WILD_BINDING_SEALS.map((seal) => seal.resolveThreshold), [20, 35, 50, 65, 80]);
        assert.deepEqual(WILD_BINDING_SEALS.map((seal) => seal.id),
            ['beast-seal-worn', 'beast-seal-reinforced', 'beast-seal-tempered', 'beast-seal-master', 'beast-seal-ancient']);
    });
    it('locks seals above their threshold and rewards battle decisions below it', () => {
        assert.equal(wildBindingChance({ rarity: 'rare', hpPercent: 50, resolvePercent: 48, sealId: 'beast-seal-reinforced' }), 0);
        const tempered = wildBindingChance({ rarity: 'rare', hpPercent: 50, resolvePercent: 48, sealId: 'beast-seal-tempered' });
        const weakened = wildBindingChance({ rarity: 'rare', hpPercent: 20, resolvePercent: 20, sealId: 'beast-seal-tempered' });
        assert.ok(tempered > 0);
        assert.ok(weakened > tempered);
        assert.equal(wildBindingChance({ rarity: 'rare', hpPercent: 0, resolvePercent: 20, sealId: 'beast-seal-tempered' }), 0);
        assert.equal(wildBindingSeal('made-up-seal'), null);
    });
    it('can fail without a grant and makes the tutorial attempt certain', () => {
        assert.equal(wildBindingSuccess(25, .9), false);
        assert.equal(wildBindingSuccess(25, .1), true);
        assert.equal(wildBindingSuccess(100, .999), true);
    });
});
