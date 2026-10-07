import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFloorAlignment } from './check-floor-alignment.mjs';

test('all delivered floors pass actual painted standing-area and reciprocal road seam checks', async t => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'delivered-sector-alignment-'));
    t.after(() => fs.rm(out, { recursive: true, force: true }));
    // Read the real public WebPs; registry hashes and synthetic color samples alone are insufficient.
    const result = await checkFloorAlignment({ root, out, render: false });
    assert.equal(result.report.results.length, 66, '65 normal sectors plus the separate Death’s Gate arena');
    assert.ok(result.report.results.some(r => r.sector === 99), 'The arena painting must be checked too');
    assert.equal(result.report.seams.length, 93);
    assert.deepEqual(result.critical, [], 'A delivered painting obstructs an exit, arrival or landmark approach');
    assert.deepEqual(result.interior.map(r => ({ sector: r.sector, issues: r.issues })), [], 'A delivered floor exceeds the interior alignment allowance');
    assert.deepEqual(result.failedSeams.map(({ a, b, difference }) => ({ a, b, difference })), [], 'Delivered neighboring road mouths visibly diverge');
});
