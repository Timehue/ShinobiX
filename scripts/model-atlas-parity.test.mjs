// A player model's pose page must decode wherever it was allowed to publish. The worker publishes pages up to
// ATLAS_BYTES (workers/avatar-model/browser_motion.py) and the client's decoder refuses anything larger than its
// own cap (shinobij.client/src/lib/sector-pose.worker.ts). On 2026-11-20 the worker was raised to 32 MiB while the
// client stayed at 12 MiB, so a large costume would have published and then never drawn.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('the client decodes every pose page the worker may publish', () => {
    const worker = read('workers/avatar-model/browser_motion.py').match(/^ATLAS_BYTES = (\d+) \* 1024\*\*2$/m);
    const client = read('shinobij.client/src/lib/sector-pose.worker.ts').match(/width\*height\*4>(\d+)\*1024\*\*2/);
    assert.ok(worker, 'browser_motion.py still declares ATLAS_BYTES as N * 1024**2');
    assert.ok(client, 'sector-pose.worker.ts still caps the decoded atlas as width*height*4>N*1024**2');
    assert.ok(Number(client[1]) >= Number(worker[1]),
        `the client refuses pages over ${client[1]} MiB but the worker publishes up to ${worker[1]} MiB`);
});
