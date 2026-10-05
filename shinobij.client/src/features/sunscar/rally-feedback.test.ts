import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRallyRace, stepRally } from '../../../../shared/sunscar/rally-simulation';
import { rallyProfile } from '../../../../shared/sunscar/rally-profiles';
import type { RallyPet, RallyShot } from '../../../../shared/sunscar/rally-types';
import { rallyFeedback } from './rally-feedback';

function fixture() {
    const pet: RallyPet = { id: 'starter-fire', templateId: 'starter-fire', name: 'Ember Hound', element: 'Fire',
        profile: rallyProfile({ id: 'starter-fire', name: 'Ember Hound' }) };
    const state = createRallyRace(1, 'grand-circuit', ['player', 'rival-1', 'rival-2', 'rival-3']
        .map(id => ({ id, pet, rivalId: null })));
    Object.assign(state.racers[0], { distance: 100, speed: 15 });
    return state;
}

function shot(overrides: Partial<RallyShot> = {}): RallyShot {
    return { ownerId: 'rival-1', element: 'Fire', distance: 80, lane: 0, remaining: 42, slowTicks: 40,
        slowSpeed: .7, speed: 38, width: .34, targetId: 'player', targetPassed: false, ...overrides };
}

test('rear shot warnings use closing time and the threatened lane, without mutating the race', () => {
    for (const [lane, direction] of [[-1, '← left'], [0, '↑ center'], [1, '→ right']] as const) {
        const state = fixture();
        state.racers[0].lane = state.racers[0].targetLane = lane;
        state.shots = [shot({ lane })];
        const before = structuredClone(state);
        assert.equal(rallyFeedback(state).incomingLabel, `Incoming ${direction} · jump or steer · 0.8s`);
        assert.deepEqual(state, before);
    }
});

test('warnings ignore your shots, escaped lanes, passed shots and shots that cannot reach you', () => {
    for (const overrides of [
        { ownerId: 'player' }, { lane: 1 }, { distance: 101 }, { speed: 15 }, { speed: 14 },
        { remaining: 0 }, { remaining: 30 },
    ]) {
        const state = fixture();
        state.shots = [shot(overrides)];
        assert.equal(rallyFeedback(state).incomingLabel, '', JSON.stringify(overrides));
    }
});

test('a wide gust threatens a changing lane until the player has actually steered clear', () => {
    const state = fixture();
    state.shots = [shot({ element: 'Wind', width: .48, lane: -.4 })];
    state.racers[0].targetLane = 1;
    assert.ok(rallyFeedback(state).incomingLabel, 'an input alone has not completed the dodge');
    state.racers[0].lane = .2;
    assert.equal(rallyFeedback(state).incomingLabel, '');
});

test('the soonest threat wins and an imminent hit says now', () => {
    const state = fixture();
    state.shots = [shot({ distance: 75 }), shot({ ownerId: 'rival-2', distance: 90, speed: 46 })];
    assert.equal(rallyFeedback(state).incomingLabel, 'Incoming ↑ center · jump or steer · 0.3s');
    state.shots.push(shot({ ownerId: 'rival-3', distance: 99 }));
    assert.equal(rallyFeedback(state).incomingLabel, 'Incoming ↑ center · jump or steer · now');
});

test('jumping and temporary guard retain the forecast; finishing removes it', () => {
    const state = fixture();
    state.shots = [shot()];
    Object.assign(state.racers[0], { jump: 1.2, verticalSpeed: -5, shieldTicks: 3 });
    assert.ok(rallyFeedback(state).incomingLabel, 'landing and guard expiry can happen before the shot arrives');
    state.racers[0].finishTick = state.tick;
    assert.equal(rallyFeedback(state).incomingLabel, '');
    state.racers[0].finishTick = null;
    state.finished = true;
    assert.equal(rallyFeedback(state).incomingLabel, '');
});

test('steering out of a warned lane clears the hint and dodges the real simulated projectile', () => {
    const state = fixture();
    Object.assign(state.racers[1], { distance: 80, speed: 15, lane: 0, targetLane: 0 });
    state.shots = [shot()];
    assert.ok(rallyFeedback(state).incomingLabel);
    stepRally(state, [{ tick: state.tick, kind: 'right' }]);
    for (let tick = 0; tick < 12; tick++) stepRally(state);
    assert.equal(rallyFeedback(state).incomingLabel, '');
    for (let tick = 0; tick < 90; tick++) stepRally(state);
    assert.equal(state.shots.length, 0);
    assert.equal(state.racers[0].slowTicks, 0);
    assert.equal(state.racers[1].shotsHit, 0);
    assert.ok(state.events.some(event => event.kind === 'shot-dodged' && event.targetId === 'player'));
});
