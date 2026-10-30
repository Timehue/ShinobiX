import assert from 'node:assert/strict';
import { test } from 'node:test';
import { towerRoundPresentation } from './tower-round-presentation';
import type { TowerSession } from './towers-api';

const story = { towerId: 'celestial', floor: 7, round: 17, objectiveState: { kind: 'defeat-all' },
    sealedCatalogFloor: { roundBudget: 16 } } as TowerSession;

test('Story floor seven discloses its safety deadline after the score par', () => {
    const view = towerRoundPresentation(story);
    assert.equal(view.hardLimit, 25);
    assert.equal(view.hudLabel, 'Round 17/25 · Par 16');
    assert.match(view.hudTitle, /end of round 25 or the floor fails/);
});

test('sealed lower caps and timed hold objectives keep their own deadlines', () => {
    assert.equal(towerRoundPresentation({ ...story, roundCap: 20 }).hardLimit, 20);
    assert.equal(towerRoundPresentation({ ...story, roundCap: 50 }).hardLimit, 25);
    const hold = towerRoundPresentation({ ...story, objectiveState: { ...story.objectiveState, kind: 'survive', roundsSurvived: 5 } });
    assert.equal(hold.hudLabel, 'Hold 5/16');
});
