import assert from 'node:assert/strict';
import test from 'node:test';
import { presentEmbeddedTowerLog } from './tower-encounter-log.js';

test('embedded Tower result lines use the encounter identity and preserve round markers', () => {
    const source = ['--- Round 1 ---', 'Rill strikes.', 'Floor 9101 cleared!'];
    assert.deepEqual(presentEmbeddedTowerLog(source, 9101, 'caravan'), [
        '--- Round 1 ---', 'Rill strikes.', 'The road is open.',
    ]);
    assert.deepEqual(presentEmbeddedTowerLog(source, 9101, 'hunt'), [
        '--- Round 1 ---', 'Rill strikes.', 'Hunt encounter cleared!',
    ]);
});

test('embedded Tower failure causes do not expose floor language', () => {
    const failures = [
        'Squad wiped — floor failed.',
        'Round limit reached — floor failed.',
        'Floor resolution stalled — floor failed.',
    ];
    assert.deepEqual(presentEmbeddedTowerLog(failures, 9101, 'caravan'), Array(3).fill('The escort has ended.'));
    assert.deepEqual(presentEmbeddedTowerLog(failures, 9101, 'hunt'), Array(3).fill('Hunt encounter ended.'));
});
