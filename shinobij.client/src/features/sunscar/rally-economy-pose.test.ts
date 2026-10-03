import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RallyMotion } from '../../../../shared/sunscar/rally-types';
import { RALLY_ECONOMY_CONTACT_ANCHOR, rallyEconomyPose, rallyEconomyRunFrame } from './rally-economy-pose';

const pose = (overrides: Partial<Parameters<typeof rallyEconomyPose>[0]> = {}) => rallyEconomyPose({
    groundY: 400, spriteHeight: 100, jumpLift: 0, motion: 'run', landingTicks: 0, reducedMotion: false, ...overrides,
});
const footY = (placed: ReturnType<typeof pose>) => placed.top + placed.height * RALLY_ECONOMY_CONTACT_ANCHOR;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

test('running crops stay inside the atlas before the start line and across positive stride transitions', () => {
    const cases = [
        [-6.25, 3], [-5, 0], [-3.75, 1], [-2.5, 2], [-1.25, 3], [-.001, 3],
        [0, 0], [1.249, 0], [1.25, 1], [2.5, 2], [3.75, 3], [4.999, 3], [5, 0], [6.25, 1],
    ];
    for (const [distance, expected] of cases) assert.equal(rallyEconomyRunFrame(distance), expected, `distance ${distance}`);
    for (let distance = -12.5; distance <= 20; distance += .1) {
        const frame = rallyEconomyRunFrame(distance);
        assert.ok(Number.isInteger(frame) && frame >= 0 && frame < 4, `distance ${distance} selects a running cell`);
    }
});

test('ready, grounded strides and finish poses keep the baked contact surface on the road at every scale', () => {
    const motions: RallyMotion[] = ['ready', 'start', 'run', 'sprint', 'technique', 'stagger', 'victory', 'defeat'];
    for (const groundY of [0, 142, 500]) for (const spriteHeight of [12, 64, 128]) for (const motion of motions) {
        const placed = pose({ groundY, spriteHeight, motion });
        near(footY(placed), groundY);
        assert.equal(placed.contactY, groundY);
        assert.equal(placed.height, spriteHeight);
        assert.equal(placed.width, spriteHeight);
        assert.equal(placed.shadowScale, 1);
        assert.equal(placed.shadowOpacity, 1);
    }
});

test('landing recovery compresses the body around planted feet and returns continuously to full size', () => {
    let previousHeight = 0, previousWidth = Infinity;
    for (const landingTicks of [11, 8, 4, 0]) {
        const placed = pose({ motion: 'land', landingTicks });
        near(footY(placed), 400);
        assert.ok(placed.height >= previousHeight && placed.height >= 92 && placed.height <= 100);
        assert.ok(placed.width <= previousWidth && placed.width >= 100 && placed.width <= 104);
        previousHeight = placed.height; previousWidth = placed.width;
    }
    assert.deepEqual(pose({ motion: 'land', landingTicks: 0 }), pose());
    assert.deepEqual(pose({ motion: 'land', landingTicks: 100 }), pose({ motion: 'land', landingTicks: 11 }));
    assert.deepEqual(pose({ motion: 'land', landingTicks: -1 }), pose());
    assert.deepEqual(pose({ motion: 'run', landingTicks: 11 }), pose(), 'stale landing ticks cannot squash an active stride');
});

test('physical jumps alone separate feet from the road while their shadow remains bounded', () => {
    let previousScale = Infinity, previousOpacity = Infinity;
    for (const jumpLift of [0, 16, 64, 180]) {
        const placed = pose({ jumpLift, motion: 'airborne' });
        near(footY(placed), 400 - jumpLift);
        assert.equal(placed.contactY, 400 - jumpLift);
        assert.equal(placed.height, 100);
        assert.equal(placed.width, 100);
        assert.ok(placed.shadowScale <= previousScale && placed.shadowScale >= .55 && placed.shadowScale <= 1);
        assert.ok(placed.shadowOpacity <= previousOpacity && placed.shadowOpacity >= .4 && placed.shadowOpacity <= 1);
        previousScale = placed.shadowScale; previousOpacity = placed.shadowOpacity;
    }
    assert.deepEqual(pose({ jumpLift: -5 }), pose(), 'a below-ground numerical residue cannot sink the pet');
});

test('reduced motion removes landing squash while preserving the actual jump position', () => {
    const planted = pose({ motion: 'land', landingTicks: 11, reducedMotion: true });
    assert.deepEqual(planted, pose());
    for (const jumpLift of [0, 20, 80]) {
        const placed = pose({ motion: 'land', landingTicks: 11, reducedMotion: true, jumpLift });
        near(footY(placed), 400 - jumpLift);
        assert.equal(placed.height, 100);
        assert.equal(placed.width, 100);
        assert.deepEqual(placed, pose({ jumpLift }), 'the jump shadow still reflects physical height');
    }
});
