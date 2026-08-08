import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sameVillage } from './chat.js';

describe('village chat membership comparison', () => {
    it('accepts the same village independent of casing and whitespace', () => {
        assert.equal(sameVillage(' Frostfang ', 'frostFANG'), true);
    });

    it('rejects rivals, missing fields, and partial names', () => {
        assert.equal(sameVillage('Frostfang', 'Moonshadow'), false);
        assert.equal(sameVillage(undefined, 'Frostfang'), false);
        assert.equal(sameVillage('Frost', 'Frostfang'), false);
    });
});
