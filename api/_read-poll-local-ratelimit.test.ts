import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const readApi = (file: string) => readFileSync(join(process.cwd(), 'api', file), 'utf8');

// Read-only polls count their rate-limit window in process memory
// (`{ local: true }`), which decides exactly what the database window decides on
// the single Railway replica (api/_ratelimit.local.test.ts) without one database
// increment per poll. Endpoints that write, settle or pay keep the database
// window, so this list is deliberately explicit.
const READ_ONLY_POLL_BUCKETS: Array<[file: string, bucket: string]> = [
    ['village/state.ts', 'village-state'],
    ['world-crisis.ts', 'world-crisis-read'],
    ['world-crisis-80.ts', 'world-crisis-80-read'],
    ['sector/contract.ts', 'sector-contract-read'],
    ['pet/sanctuary-list.ts', 'pet-sanctuary-list'],
];

for (const [file, bucket] of READ_ONLY_POLL_BUCKETS) {
    test(`${bucket} counts its window in memory`, () => {
        const source = readApi(file);
        const call = new RegExp(`enforceRateLimitKv\\(req, res, '${bucket}',[^;]*\\{[^}]*local: true`);
        assert.match(source, call);
    });
}

test('the sector contract CLAIM keeps its database window', () => {
    const source = readApi('sector/contract.ts');
    assert.match(source, /enforceRateLimitKv\(req, res, 'sector-contract-claim', 12, 60_000, identity\.name\)\)\)/);
});
