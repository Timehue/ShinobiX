import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterSavedBloodlines } from './jutsu';

test('every built-in bloodline technique has authored battle flavor', () => {
    for (const bloodline of starterSavedBloodlines) {
        for (const jutsu of bloodline.jutsus) {
            assert.ok(jutsu.battleDescription?.includes('%target'), `${jutsu.id} names its target`);
            assert.notEqual(jutsu.battleDescription, `${jutsu.name} strikes %target`);
            assert.notEqual(jutsu.battleDescription, `${jutsu.name} strikes %target.`);
        }
    }
});
