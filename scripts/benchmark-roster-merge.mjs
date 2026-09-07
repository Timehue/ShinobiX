// Synthetic CPU/operation benchmark; it does not contact game services.
// Run: node --import tsx scripts/benchmark-roster-merge.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mergeRosterSnapshot } from '../shinobij.client/src/lib/roster-merge.ts';

function originalMerge(prev, incoming) {
    const merged = [...prev];
    for (const record of incoming) {
        const index = merged.findIndex(player => player.name.toLowerCase() === record.name.toLowerCase());
        if (index >= 0) merged[index] = { ...merged[index], ...record };
        else merged.push(record);
    }
    return merged;
}

function medianRun(fn, prev, incoming) {
    for (let i = 0; i < 3; i++) fn(prev, incoming);
    const timings = [];
    for (let i = 0; i < 9; i++) {
        const start = performance.now();
        fn(prev, incoming);
        timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    return Number(timings[4].toFixed(3));
}

const results = [];
for (const size of [500, 2000]) {
    const prev = Array.from({ length: 30 }, (_, i) => ({ name: `Player${i}`, character: { level: 1 } }));
    const incoming = Array.from({ length: size }, (_, i) => ({ name: `player${i}`, character: { level: 9 } }));
    assert.deepEqual(mergeRosterSnapshot(prev, incoming), originalMerge(prev, incoming));
    let oldReads = 0;
    let newReads = 0;
    const measuredRows = counter => incoming.map(row => ({
        character: row.character,
        get name() { counter(); return row.name; },
    }));
    originalMerge(prev, measuredRows(() => { oldReads++; }));
    mergeRosterSnapshot(prev, measuredRows(() => { newReads++; }));
    results.push({
        players: size,
        originalMedianMs: medianRun(originalMerge, prev, incoming),
        optimizedMedianMs: medianRun(mergeRosterSnapshot, prev, incoming),
        originalNameReads: oldReads,
        optimizedNameReads: newReads,
    });
}
console.log(JSON.stringify({ kind: 'synthetic-roster-merge', node: process.version, results }, null, 2));
