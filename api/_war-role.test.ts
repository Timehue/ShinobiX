import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ROLE_KAGE, ROLE_ELDER, ROLE_ANBU, ROLE_VILLAGER, ROLE_MERC, sectorControlSwing } from './_war-role.js';

describe('war-role: weights mirror the village-war model', () => {
    it('Kage 30/50, Elder 20/20, ANBU 15/0, villager 5/0; a merc is a villager', () => {
        assert.deepEqual(ROLE_KAGE, { win: 30, loss: 50 });
        assert.deepEqual(ROLE_ELDER, { win: 20, loss: 20 });
        assert.deepEqual(ROLE_ANBU, { win: 15, loss: 0 });
        assert.deepEqual(ROLE_VILLAGER, { win: 5, loss: 0 });
        assert.deepEqual(ROLE_MERC, ROLE_VILLAGER);
    });
});

describe('war-role: sectorControlSwing = winner.win + loser.loss', () => {
    it('villager v villager = 5 (the small chip that makes a capture take a while)', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER), 5);
    });
    it('a villager who fells a defending Kage swings 55 (5 + 50)', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_KAGE), 55);
    });
    it('a Kage storming a villager swings 30 (30 + 0)', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_VILLAGER), 30);
    });
    it('Kage v Kage = 80 (30 + 50)', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_KAGE), 80);
    });
    it('applies the War-Academy multiplier and never drops below 1', () => {
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER, 1.15), 6); // round(5 * 1.15)
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_KAGE, 1.15), 92);        // round(80 * 1.15)
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER, 0), 1);    // floored to >= 1
    });
});
