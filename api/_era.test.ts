import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERA_DEFS, ERA_BY_ID } from './_era-defs.js';
import { effectiveStatus, effectiveRequired, eraMilestonesMet, buildEraViews } from './_era.js';

const MYTHIC_ERA = ERA_BY_ID.get('mythic-legacies')!;

test('era roster: five numbered eras, 1-4 launch unlocked, 5 gated with a credited trigger', () => {
    assert.equal(ERA_DEFS.length, 5);
    assert.deepEqual(ERA_DEFS.map((e) => e.number), [1, 2, 3, 4, 5]);
    for (const e of ERA_DEFS.slice(0, 4)) assert.equal(e.initialStatus, 'unlocked');
    assert.equal(MYTHIC_ERA.initialStatus, 'milestone_active');
    assert.ok(MYTHIC_ERA.milestones.length >= 3, 'anti-chore rule: milestones span multiple categories');
    assert.ok(new Set(MYTHIC_ERA.milestones.map((m) => m.metric)).size === MYTHIC_ERA.milestones.length);
    assert.ok(MYTHIC_ERA.trigger, 'era 5 needs its credited finisher');
});

test('milestone evaluation: all floors must be met, overrides retune live', () => {
    const done = Object.fromEntries(MYTHIC_ERA.milestones.map((m) => [m.metric, m.required]));
    assert.equal(eraMilestonesMet(MYTHIC_ERA, done), true);
    const short = { ...done, missions: MYTHIC_ERA.milestones[0].required - 1 };
    assert.equal(eraMilestonesMet(MYTHIC_ERA, short), false);
    // Admin lowers the missions floor → the same counters now pass.
    assert.equal(eraMilestonesMet(MYTHIC_ERA, short, { milestoneOverrides: { missions: 10 } }), true);
    // Override of 0 waives a milestone entirely.
    assert.equal(effectiveRequired(MYTHIC_ERA, 'missions', { milestoneOverrides: { missions: 0 } }), 0);
});

test('status override wins over the definition', () => {
    assert.equal(effectiveStatus(MYTHIC_ERA), 'milestone_active');
    assert.equal(effectiveStatus(MYTHIC_ERA, { status: 'locked' }), 'locked');
    assert.equal(effectiveStatus(MYTHIC_ERA, { status: 'unlocked' }), 'unlocked');
});

test('view builder: progress clamps to required, trigger + credit surface', () => {
    const views = buildEraViews(
        { overrides: { 'mythic-legacies': { milestoneOverrides: { pvpWins: 100 } } } },
        { missions: 999_999, pvpWins: 50 },
        { 'mythic-legacies': { player: 'Rill', village: 'Moonshadow', ts: 1 } },
    );
    const v = views.find((x) => x.id === 'mythic-legacies')!;
    const missions = v.milestones.find((m) => m.metric === 'missions')!;
    assert.equal(missions.current, missions.required, 'current clamps to required');
    assert.equal(missions.done, true);
    const pvp = v.milestones.find((m) => m.metric === 'pvpWins')!;
    assert.equal(pvp.required, 100, 'override applied to the view');
    assert.equal(pvp.done, false);
    assert.equal(v.trigger?.fired, true);
    assert.equal(v.trigger?.firedBy, 'Rill');
    const era1 = views.find((x) => x.number === 1)!;
    assert.equal(era1.status, 'unlocked');
    assert.equal(era1.milestones.length, 0);
});
