import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { wildResolveLoss, wildTraitHint } from './wild-binding.js';

const loss = (trait: unknown, kind: 'rest' | 'guard' | 'move', round = 1) => wildResolveLoss({
    trait, kind, damage: kind === 'move' ? 20 : 0, maxHp: 100, round, acted: true,
});

describe('wild trait behavior', () => {
    it('preserves legacy Resolve behavior when a sealed pet has no trait', () => {
        assert.equal(loss(undefined, 'rest'), 22);
        assert.equal(loss(undefined, 'guard'), 16);
        assert.equal(loss(undefined, 'move'), 16);
        assert.equal(wildTraitHint(undefined), null);
    });
    it('gives each trait a distinct useful approach', () => {
        assert.ok(loss('Loyal', 'rest') > loss(undefined, 'rest'));
        assert.ok(loss('Aggressive', 'move') > loss('Aggressive', 'rest'));
        assert.ok(loss('Guardian', 'guard') > loss('Guardian', 'move'));
        assert.ok(loss('Swift', 'move') > loss('Swift', 'rest'));
        assert.ok(loss('Battleborn', 'move') > loss('Battleborn', 'guard'));
        assert.equal(loss('Lucky', 'rest', 2), 22);
        assert.equal(loss('Lucky', 'rest', 3), 30);
        for (const trait of ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'])
            assert.ok(wildTraitHint(trait));
    });
    it('never rewards a missed or prevented player action', () => {
        assert.equal(wildResolveLoss({ trait: 'Lucky', kind: 'move', damage: 0, maxHp: 100, round: 3, acted: true }), 0);
        assert.equal(wildResolveLoss({ trait: 'Loyal', kind: 'rest', damage: 0, maxHp: 100, round: 1, acted: false }), 0);
    });
});
