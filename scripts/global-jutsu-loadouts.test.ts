import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { GLOBAL_JUTSU_VARIANTS, globalJutsuLoadoutIds } from './global-jutsu-loadouts.js';

test('global diagnostic baselines reproduce the original roster selection and variants fit the slot budget', () => {
    const original = Object.values(JUTSU_CATALOG).filter(j => !/-[56]$/.test(j.id) && !j.id.startsWith('starter-any-'));
    for (const element of ['Earth', 'Wind', 'Lightning', 'Fire', 'Water']) {
        for (const discipline of ['nin', 'gen', 'tai', 'buki']) {
            for (const slots of [6, 12, 15]) for (const rotation of [0, 1, 2]) {
                const baseline = globalJutsuLoadoutIds(discipline, element, slots, rotation);
                const omitted = ['nin', 'gen', 'tai', 'buki'].filter(style => style !== discipline)[rotation];
                const historical = original.filter(j =>
                    j.id.startsWith(`starter-${discipline}-${element.toLowerCase()}-`)
                    || j.id === 'starter-universal-flicker'
                    || (slots > 6 && j.id.startsWith('starter-') && j.element === element && j.type === 'Any'
                        && (slots === 15 || !j.id.startsWith(`starter-${omitted}-`))),
                ).map(j => j.id).sort();
                assert.deepEqual(baseline, historical);
                for (const variant of GLOBAL_JUTSU_VARIANTS) {
                    const ids = globalJutsuLoadoutIds(discipline, element, slots, rotation, variant);
                    assert.equal(ids.length, slots);
                    assert.equal(new Set(ids).size, slots);
                    assert.ok(ids.every(id => JUTSU_CATALOG[id]));
                    assert.ok(ids.includes('starter-universal-flicker'));
                    assert.ok(ids.every(id => JUTSU_CATALOG[id].element === element || JUTSU_CATALOG[id].element === 'None'));
                    assert.equal(ids.filter(id => !baseline.includes(id)).length, variant === 'baseline' ? 0 : variant === 'expanded' ? 3 : 1);
                }
            }
        }
    }
});

test('global diagnostic rejects invalid selections instead of truncating loadouts', () => {
    assert.throws(() => globalJutsuLoadoutIds('nin', 'Wind', 7, 0), /slots/);
    assert.throws(() => globalJutsuLoadoutIds('nin', 'Wind', 6, 3), /rotation/);
    assert.throws(() => globalJutsuLoadoutIds('any', 'Wind', 6, 0), /discipline/);
    assert.throws(() => globalJutsuLoadoutIds('nin', 'None', 6, 0), /element/);
});
