import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_EGG_GAMEPLAY_MS, tickPetIncubation } from './pet-incubation.js';

const activity = { id: 'foreground-game-session', active: true, elapsedMs: 15_000 };
const egg = { incubationRemainingMs: PET_EGG_GAMEPLAY_MS, incubationUpdatedAt: 1000 };
test('only continuous foreground play counts, never offline time or background time', () => {
    const first = tickPetIncubation(egg, 10_000, activity);
    assert.equal(first.incubationRemainingMs, PET_EGG_GAMEPLAY_MS, 'first contact establishes the activity lease');
    const playing = tickPetIncubation(first, 25_000, activity);
    assert.equal(playing.incubationRemainingMs, PET_EGG_GAMEPLAY_MS - 15_000);
    const hidden = tickPetIncubation(playing, 40_000, { ...activity, active: false });
    assert.equal(hidden.incubationRemainingMs, playing.incubationRemainingMs);
    assert.equal(tickPetIncubation(hidden, 55_000, activity).incubationRemainingMs, playing.incubationRemainingMs, 'resume establishes a fresh interval');
    assert.equal(tickPetIncubation(playing, 86_400_000, activity).incubationRemainingMs, playing.incubationRemainingMs, 'offline gaps do not catch up');
});

test('retries, multiple tabs, forged deltas and clock rollback cannot accelerate incubation', () => {
    const first = tickPetIncubation(egg, 10_000, activity);
    const counted = tickPetIncubation(first, 25_000, { ...activity, elapsedMs: Number.MAX_SAFE_INTEGER });
    assert.equal(counted.incubationRemainingMs, PET_EGG_GAMEPLAY_MS - 15_000);
    assert.equal(tickPetIncubation(counted, 25_000, activity).incubationRemainingMs, counted.incubationRemainingMs);
    assert.equal(tickPetIncubation(counted, 25_001, { ...activity, id: 'second-tab' }).incubationRemainingMs, counted.incubationRemainingMs);
    assert.equal(tickPetIncubation(counted, 0, activity).incubationRemainingMs, counted.incubationRemainingMs);
    assert.equal(tickPetIncubation({ ...counted, incubationRemainingMs: 5 }, 40_000, activity).incubationRemainingMs, 0);
});
