import assert from 'node:assert/strict';
import test from 'node:test';
import { petTechniquePose, petTechniqueStyle } from './pet-technique-pose';

test('equipped physical techniques and spells get distinct bounded accents', () => {
    const names = ['Quick Jab', 'Open Wound', 'Earth Breaker', 'Eclipse Fang', 'Water Pulse'];
    const styles = names.map((name, i) => petTechniqueStyle(name, i === 4));
    assert.deepEqual(styles, ['jab', 'sweep', 'heavy', 'lunge', 'channel']);
    const poses = styles.map(style => petTechniquePose(style, 'strike', 0));
    assert.equal(new Set(poses.map(p => JSON.stringify(p))).size, 5);
    for (const style of styles) for (const motion of ['windup', 'strike', 'recover']) {
        for (let i = 0; i <= 100; i++) {
            const pose = petTechniquePose(style, motion, i / 100);
            assert.ok(Object.values(pose).every(value => Math.abs(value) <= .1));
            assert.deepEqual(Object.keys(pose), ['pitch', 'yaw', 'roll'], 'no root displacement or mesh stretch');
        }
    }
});
test('move accents release before idle, reactions, locomotion and defeat', () => {
    const zero = { pitch: 0, yaw: 0, roll: 0 };
    for (const style of ['jab', 'sweep', 'heavy', 'lunge', 'channel'] as const) {
        assert.deepEqual(petTechniquePose(style, 'windup', 0), zero);
        assert.deepEqual(petTechniquePose(style, 'recover', 1), zero);
        for (const motion of ['idle', 'guard', 'rest', 'stagger', 'dead', 'run', 'dodge']) {
            assert.deepEqual(petTechniquePose(style, motion, .5), zero);
        }
        assert.ok(Object.values(petTechniquePose(style, 'strike', NaN)).every(Number.isFinite));
    }
    assert.equal(petTechniqueStyle(), 'neutral');
});
