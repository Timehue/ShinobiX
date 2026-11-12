import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the arithmetic actually used by the browser test, not a second
// implementation. Browser coverage still owns real movement and frame capture.
const source = readFileSync(new URL('../e2e/npc-prompt-event-copy.spec.ts', import.meta.url), 'utf8');
const intervalsStart = source.indexOf('        const lengths=samples.slice(1).map(');
const intervalsEnd = source.indexOf('        await info.attach(', intervalsStart);
const windowStart = source.indexOf('        let distance=0, seconds=0;', intervalsEnd);
const windowEnd = source.indexOf('        expect(distance).toBe(120);', windowStart);
assert.ok(intervalsStart >= 0 && intervalsEnd > intervalsStart && windowStart > intervalsEnd && windowEnd > windowStart,
    'browser pace calculation boundaries must exist');
const measure = new Function('samples', source.slice(intervalsStart, intervalsEnd)
    + source.slice(windowStart, windowEnd) + '\nreturn { distance, seconds, speed: distance / seconds };');

test('the browser gate retains the full distance and authored speed limits', () => {
    assert.match(source, /expect\(distance\)\.toBe\(120\)/);
    assert.match(source, /expect\(distance\/seconds\)\.toBeGreaterThan\(104\)/);
    assert.match(source, /expect\(distance\/seconds\)\.toBeLessThan\(136\)/);
    const result = measure([
        { x: 0, y: 0, width: 1080, wallTime: 0, motionTime: 0 },
        { x: 60, y: 0, width: 1080, wallTime: 500, motionTime: 500 },
        { x: 120, y: 0, width: 1080, wallTime: 1000, motionTime: 1000 },
    ]);
    assert.equal(result.distance, 120);
    assert.equal(result.seconds, 1);
    assert.equal(result.speed, 120);
});

test('a long wall-time stall cannot pass through the diagnostic motion clock', () => {
    const result = measure([
        { x: 0, y: 0, width: 1080, wallTime: 0, motionTime: 0 },
        { x: 114, y: 0, width: 1080, wallTime: 950, motionTime: 950 },
        // A 2.928-second gap advances only the bounded 50 ms motion step.
        { x: 120, y: 0, width: 1080, wallTime: 3878, motionTime: 1000 },
    ]);
    assert.equal(result.distance, 120);
    assert.equal(result.seconds, 3.878);
    assert.ok(result.speed < 104, 'the existing browser speed gate must reject this wall-time stall');
});

test('missing visible travel cannot satisfy the distance gate', () => {
    assert.equal(measure([]).distance, 0);
    assert.equal(measure([{ x: 120, y: 0, width: 1080, wallTime: 3878, motionTime: 1000 }]).distance, 0);
});
