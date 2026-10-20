import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterSavedBloodlines } from './jutsu';

test('every built-in bloodline technique has authored battle flavor naming the affected fighter', () => {
    for (const bloodline of starterSavedBloodlines) {
        for (const jutsu of bloodline.jutsus) {
            const casterOnly = jutsu.ap === 40 && jutsu.tags.every(tag =>
                ['Increase Damage Given', 'Decrease Damage Taken', 'Absorb'].includes(tag.name));
            assert.ok(jutsu.battleDescription?.includes(casterOnly ? '%user' : '%target'), `${jutsu.id} names the affected fighter`);
            assert.notEqual(jutsu.battleDescription, `${jutsu.name} strikes %target`);
            assert.notEqual(jutsu.battleDescription, `${jutsu.name} strikes %target.`);
        }
    }
});
