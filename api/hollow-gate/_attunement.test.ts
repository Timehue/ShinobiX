import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buyHollowGateAttunement } from './_attunement.js';

describe('Hollow Gate attunement settlement', () => {
    test('charges the server-derived next-rank cost', () => {
        const first = buyHollowGateAttunement({ hollowShards: 100 }, 'seasoned-delver');
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.cost, 30);
        assert.equal(first.character.hollowShards, 70);
        const second = buyHollowGateAttunement(first.character, 'seasoned-delver');
        assert.equal(second.ok, true);
        if (!second.ok) return;
        assert.equal(second.cost, 60);
        assert.equal((second.character.hollowGateAttunement as Record<string, number>)['seasoned-delver'], 2);
    });

    test('rejects unknown, maxed, and unaffordable purchases', () => {
        assert.equal(buyHollowGateAttunement({ hollowShards: 999 }, 'unknown').ok, false);
        assert.equal(buyHollowGateAttunement({ hollowShards: 999, hollowGateAttunement: { cartographer: 1 } }, 'cartographer').ok, false);
        assert.equal(buyHollowGateAttunement({ hollowShards: 29 }, 'seasoned-delver').ok, false);
    });
});
