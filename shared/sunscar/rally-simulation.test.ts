import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../../api/pet/_catalog.js';
import { rallyProfile } from './rally-profiles.js';
import { RALLY_RIVALS } from './rally-rivals.js';
import { RALLY_TRACKS, rallyPath } from './rally-tracks.js';
import { createRallyRace, rallyResult, replayRallyCheckpoint, stepRally, validateRallyActions } from './rally-simulation.js';
import type { RallyElement, RallyPet } from './rally-types.js';

export function raceFixture(trackId = 'grand-circuit', element: RallyElement = 'Fire') {
    const pet = (id: string): RallyPet => {
        const catalog = PET_CATALOG[id];
        return { id, templateId: id, name: String(catalog.name), element: catalog.element as RallyElement, profile: rallyProfile({ id, name: String(catalog.name) }) };
    };
    return createRallyRace(345, trackId, [
        { id: 'player', pet: { ...pet('starter-fire'), element }, rivalId: null },
        ...RALLY_RIVALS.slice(0, 3).map(r => ({ id: r.id, pet: pet(r.petId), rivalId: r.id })),
    ]);
}
test('every rival uses a real catalog pet and five elements have normalized species profiles', () => {
    for (const rival of RALLY_RIVALS) assert.ok(PET_CATALOG[rival.petId], rival.petId);
    for (const [id, pet] of Object.entries(PET_CATALOG)) {
        const p = rallyProfile({ id, name: String(pet.name) });
        const values = [p.speed, p.acceleration, p.agility, p.endurance, p.stability];
        assert.equal(values.reduce((a, b) => a + b), 300);
        assert.ok(values.every(n => n >= 40 && n <= 85));
        assert.deepEqual(p, rallyProfile({ id, name: String(pet.name), speed: 999999, attack: 999999 }));
    }
});
test('race creation validates course and entrants', () => {
    assert.throws(() => createRallyRace(1, 'missing', []));
    assert.throws(() => createRallyRace(1, 'grand-circuit', []));
    assert.equal(raceFixture().racers.length, 4);
});
test('seeded simulation matches replay checkpoints exactly', () => {
    const direct = raceFixture();
    const actions = [{ tick: 0, kind: 'burst-on' }, { tick: 40, kind: 'left' }, { tick: 290, kind: 'jump' }, { tick: 300, kind: 'technique' }] as const;
    const replay = replayRallyCheckpoint(direct, 600, actions);
    for (let i = 0; i < 600; i++) stepRally(direct, actions.filter(a => a.tick === i));
    assert.deepEqual(direct, replay);
});
test('forged checkpoints, duplicated intents and backwards inputs are rejected', () => {
    for (const input of [[{ tick: -1, kind: 'left' }], [{ tick: 1, kind: 'win' }], [{ tick: 5, kind: 'left' }, { tick: 3, kind: 'jump' }], [{ tick: 0, kind: 'jump' }, { tick: 0, kind: 'jump' }]]) assert.throws(() => validateRallyActions(input, 0, 100));
    assert.throws(() => validateRallyActions([], 0, 601));
    assert.throws(() => validateRallyActions([], 50, 50));
});
test('burst drains and exhausts; repeated technique cannot extend or refill it', () => {
    const state = raceFixture();
    stepRally(state, [{ tick: 0, kind: 'burst-on' }, { tick: 0, kind: 'technique' }]);
    for (let i = 1; i < 239; i++) stepRally(state, [{ tick: i, kind: 'technique' }]);
    assert.equal(state.racers[0].techniqueTicks, 1);
    assert.ok(state.racers[0].stamina < 40);
    for (let i = 239; i < 480; i++) stepRally(state);
    assert.equal(state.racers[0].techniqueTicks, 0);
    assert.equal(state.racers[0].burst, false);
    assert.ok(state.racers.every(r => r.stamina >= 0 && r.stamina <= 100));
});
test('jump spamming cannot create flight and lane transitions interpolate', () => {
    const state = raceFixture();
    stepRally(state, [{ tick: 0, kind: 'left' }, { tick: 0, kind: 'jump' }]);
    assert.ok(state.racers[0].lane < 0 && state.racers[0].lane > -1);
    let highest = 0;
    for (let i = 1; i < 240; i++) {
        stepRally(state, [{ tick: i, kind: 'jump' }]);
        highest = Math.max(highest, state.racers[0].jump);
    }
    assert.ok(highest < 3 && highest > 1);
});
test('all four courses finish with actual ranked race times and active AI', () => {
    for (const track of RALLY_TRACKS) {
        const state = raceFixture(track.id);
        while (!state.finished) stepRally(state);
        const result = rallyResult(state);
        assert.equal(result.placements.length, 4);
        assert.deepEqual(result.placements.map(r => r.points), [10, 7, 5, 3]);
        assert.ok(result.placements.every(r => r.tick > 2500 && r.tick < 8500), track.name);
        assert.ok(state.racers.slice(1).every(r => r.techniqueUsed && r.aiDecision > 50));
        assert.ok(state.racers.slice(1).some(r => r.shortcuts > 0));
    }
});
test('course paths have continuous seams and no dead-end gaps', () => {
    for (const track of RALLY_TRACKS) {
        assert.equal(track.sections[0].from, 0);
        assert.equal(track.sections.at(-1)!.to, track.length);
        for (let i = 1; i < track.sections.length; i++) {
            const seam = track.sections[i].from;
            assert.equal(track.sections[i - 1].to, seam);
            assert.ok(Math.abs(rallyPath(track, seam - .001).x - rallyPath(track, seam + .001).x) < .01);
        }
        assert.ok(track.obstacles.every(o => o.at > 30 && o.at < track.length - 25));
    }
});
