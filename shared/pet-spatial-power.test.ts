import assert from 'node:assert/strict';
import test from 'node:test';
import { petSpatialTechniquePower } from './pet-spatial-power.js';

test('earned spatial arts use the same units as the free ordinary strike', () => {
    const power = (tier: string, value = 100) => petSpatialTechniquePower({ power: value, kind: 'damage', abilityId: 'species:art:' + tier }, true);
    assert.equal(power('basic'), 145);
    assert.equal(power('advanced'), 200);
    assert.equal(power('signature'), 280);
    assert.ok(power('basic', 40) > 100, 'even a restrained low-power catalog art beats the free strike');
    assert.ok(power('signature', 40) > power('advanced', 160), 'the final art retains its higher action budget');
    assert.ok(power('signature', 1e9) <= 308, 'authored outliers have a bounded lean');
    assert.equal(petSpatialTechniquePower({ power: 54, kind: 'damage', abilityId: 'species:art:signature' }, false), 54, 'retained seals keep their exact power');
});

test('control and damage-over-time riders trade direct damage inside the spatial budget', () => {
    const input = { power: 100, abilityId: 'species:art:advanced' };
    const direct = petSpatialTechniquePower({ ...input, kind: 'damage' }, true);
    assert.ok(petSpatialTechniquePower({ ...input, kind: 'stun' }, true) < direct * .6);
    assert.ok(petSpatialTechniquePower({ ...input, kind: 'burn' }, true) < direct * .7);
    assert.equal(petSpatialTechniquePower({ ...input, kind: 'heal' }, true), 100, 'support has a separate bounded execution rule');
});

test('materialized progression mastery is applied exactly once after tier conversion', () => {
    const advanced = petSpatialTechniquePower({ power: 108, abilityId: 'species:art:advanced:mastery-50', kind: 'damage' }, true);
    const signature = petSpatialTechniquePower({ power: 110, abilityId: 'species:art:signature:mastery-75', kind: 'damage' }, true);
    assert.equal(advanced, 216);
    assert.equal(signature, 308);
    assert.equal(petSpatialTechniquePower({ power: Infinity, abilityId: 'species:art:signature', kind: 'damage' }, true), 252);
});
