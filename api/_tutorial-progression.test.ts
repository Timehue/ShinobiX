import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earnedForLevel, earnedStatPoints } from './_xp-engine.js';
import { ACADEMY_LEVEL_FLOORS, grantAcademyLevelFloor } from './_tutorial-progression.js';

test('Academy checkpoint floors grant only the shortfall and derive the target level', () => {
    const starting = { level: 1, stats: {}, unspentStats: 20 };
    const spar = grantAcademyLevelFloor(starting, ACADEMY_LEVEL_FLOORS.spar);
    assert.equal(spar.statPoints, earnedForLevel(2) - 20);
    assert.equal(earnedStatPoints(spar.character), earnedForLevel(2));
    assert.equal(spar.character.level, 2);

    const repeated = grantAcademyLevelFloor(spar.character, ACADEMY_LEVEL_FLOORS.spar);
    assert.equal(repeated.statPoints, 0, 'reapplying a checkpoint floor must not duplicate points');
    assert.equal(earnedStatPoints(repeated.character), earnedForLevel(2));
});

test('Academy level floors preserve earned progress above the checkpoint', () => {
    const alreadyAhead = {
        level: 2,
        stats: {},
        unspentStats: earnedForLevel(2) + 37,
    };
    const result = grantAcademyLevelFloor(alreadyAhead, ACADEMY_LEVEL_FLOORS.spar);
    assert.equal(result.statPoints, 0);
    assert.equal(earnedStatPoints(result.character), earnedForLevel(2) + 37);
    assert.equal(result.character.level, 2);
});
