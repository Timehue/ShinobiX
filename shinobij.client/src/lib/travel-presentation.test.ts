import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTravelPresentationScope } from './travel-presentation';

test('leaving a map retires both delayed responses and queued arrival callbacks', () => {
    let fire: (() => void) | undefined;
    let cleared = 0;
    let arrived = 0;
    const scope = createTravelPresentationScope({
        set(callback) { fire = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
        clear() { cleared++; },
    });
    scope.scheduleArrival(() => arrived++, 3000);
    scope.dispose();
    assert.equal(scope.isCurrent(), false, 'a late network response is no longer applicable');
    assert.equal(cleared, 1);
    fire?.(); // A callback already queued by the browser must also be harmless.
    assert.equal(arrived, 0);
    scope.scheduleArrival(() => arrived++, 0);
    assert.equal(arrived, 0);
});

test('a current map receives one arrival and a replacement account has an independent scope', () => {
    let fire: (() => void) | undefined;
    let arrived = 0;
    const scope = createTravelPresentationScope({
        set(callback) { fire = callback; return 1 as unknown as ReturnType<typeof setTimeout>; }, clear() {},
    });
    scope.scheduleArrival(() => arrived++, 3000);
    fire?.();
    assert.equal(arrived, 1);
    scope.dispose();
    assert.equal(createTravelPresentationScope().isCurrent(), true);
});
