import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'test-results/performance-gauntlet-2026-09-16/startup');
const input = JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8'));
function spread(values) {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return { n: ordered.length, median: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
        min: ordered[0], max: ordered.at(-1) };
}
const groups = Map.groupBy(input.rows, row => `${row.profile}/${row.journey}`);
const summaries = Object.fromEntries([...groups].map(([key, rows]) => {
    const metrics = {
        usableMs: row => row.usableMs,
        // Zero is the observer's initial value, not a measured zero-ms paint.
        lcpMs: row => row.lcp > 0 ? row.lcp : null,
        observedLayoutShift: row => row.cls,
        scriptMs: row => row.scriptDurationMs,
        taskMs: row => row.taskDurationMs,
        longTaskCount: row => row.longTasks.length,
        longTaskTotalMs: row => row.longTasks.reduce((sum, duration) => sum + duration, 0),
        // Sampled event durations are diagnostics, not field INP.
        maxObservedEventMs: row => row.interactions.length ? Math.max(...row.interactions) : null,
        wireBytes: row => row.resources.reduce((sum, resource) => sum + resource.transferredBytes, 0),
        codeWireBytes: row => row.resources.filter(resource => ['Script', 'Stylesheet'].includes(resource.type))
            .reduce((sum, resource) => sum + resource.transferredBytes, 0),
        resourceCount: row => row.resources.length,
        acknowledgmentMs: row => row.action?.acknowledgmentMs,
        actionRenderedMs: row => row.action?.renderedMs,
    };
    return [key, {
        ...Object.fromEntries(Object.entries(metrics).map(([name, select]) => [name, spread(rows.map(select))])),
        pageOrNetworkErrors: rows.flatMap(row => row.failures),
        // Schema 1 called this "durable", but it only checked the local memory
        // store. Schema 2 uses the explicit name; neither proves DB durability.
        canonicalLocalSaveChecks: rows.filter(row => row.action?.canonicalLocalSaveVerified ?? row.action?.durable).length,
    }];
}));
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n');
console.log(JSON.stringify(summaries, null, 2));
