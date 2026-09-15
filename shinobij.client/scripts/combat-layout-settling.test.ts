import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleStableGrid } from './combat-layout-settling.ts';

test('a delayed responsive commit resets prior agreements and needs four new stable samples', async () => {
    let elapsedMs = 0;
    const observations: Array<{ elapsedMs: number; value: string; agreements: number }> = [];
    const result = await sampleStableGrid(
        async () => elapsedMs < 150 ? 'old responsive geometry' : 'new responsive geometry',
        async () => { elapsedMs += 50; },
        (value, agreements) => observations.push({ elapsedMs, value, agreements }),
    );
    // Two transient agreements before the delayed commit cannot contribute to
    // the four required agreements after it. One sample cannot settle a grid.
    assert.equal(elapsedMs, 350);
    assert.deepEqual(result, { agreements: 4, attempts: 7 });
    assert.deepEqual(observations.map(({ agreements }) => agreements), [0, 1, 2, 0, 1, 2, 3, 4]);
    assert.equal(observations.at(-1)?.value, 'new responsive geometry');
});

test('a missing grid never counts as stable and preserves the 24-attempt bound', async () => {
    let elapsedMs = 0;
    let samples = 0;
    const result = await sampleStableGrid(
        async () => { samples += 1; return ''; },
        async () => { elapsedMs += 50; },
    );
    assert.deepEqual(result, { agreements: 0, attempts: 24 });
    assert.equal(samples, 25);
    assert.equal(elapsedMs, 1200);
});

test('continuous geometry changes cannot accumulate non-consecutive agreements', async () => {
    let elapsedMs = 0;
    const result = await sampleStableGrid(
        async () => Math.floor(elapsedMs / 100) % 2 ? 'offset one' : 'offset two',
        async () => { elapsedMs += 50; },
    );
    assert.equal(result.attempts, 24);
    assert.equal(result.agreements, 0);
});
