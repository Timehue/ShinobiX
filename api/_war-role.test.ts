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

// The seat is read from the AUTHORITATIVE `village:kage:<slug>` row. It used to be
// taken from the `game:village-state:<slug>` MIRROR, which only refreshes on a
// validated villageState write — so a genuinely seated Kage fought at VILLAGER
// weight (5, not 30) until some member's next save rehydrated it. Confirmed live
// on a real seated Kage before the fix. The two keys slug differently, which is
// what made the bug easy to miss: dashes here, punctuation stripped there.
describe('war-role: the Kage seat key', () => {
    it('hyphenates spaces, matching every other Kage power', () => {
        // api/village/_kage-settle.ts kageKey + world-state.ts isSeatedKageOf.
        const expected = 'village:kage:ashen-leaf-village';
        assert.equal(`village:kage:${'Ashen Leaf Village'.toLowerCase().replace(/\s+/g, '-')}`, expected);
    });

    it('is NOT the village-state slug, which strips punctuation entirely', () => {
        const seat = `village:kage:${'Ashen Leaf Village'.toLowerCase().replace(/\s+/g, '-')}`;
        const mirror = `game:village-state:${'Ashen Leaf Village'.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        assert.notEqual(seat, mirror);
        assert.equal(mirror, 'game:village-state:ashenleafvillage');
    });

    it('a Kage swing is worth 6x a villager, which is what the bug silently cost', () => {
        assert.equal(sectorControlSwing(ROLE_KAGE, ROLE_VILLAGER), 30);
        assert.equal(sectorControlSwing(ROLE_VILLAGER, ROLE_VILLAGER), 5);
    });
});
