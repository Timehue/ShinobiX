import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A named roll appends to creatorItems; it must keep as many definitions as the
// save sanitizer allows, or the oldest forged items lose their definitions.
test('a named roll keeps creatorItems up to the save cap', () => {
    // process.cwd(): api tests also compile into the CommonJS server build.
    const sanitizer = readFileSync(join(process.cwd(), 'api', 'save', '_sanitize-creator-items.ts'), 'utf8');
    const named = readFileSync(join(process.cwd(), 'api', 'craft', 'named.ts'), 'utf8');
    const saveCap = Number(/const CREATOR_ITEM_CAP = (\d+);/.exec(sanitizer)?.[1]);
    const rollCap = Number(/export const CREATOR_ITEM_CAP = (\d+);/.exec(named)?.[1]);
    assert.ok(saveCap > 0, 'the sanitizer still declares its cap');
    assert.equal(rollCap, saveCap);
    assert.doesNotMatch(named, /creatorItems\.slice\(-\d+\)/, 'no hard-coded trim below the cap');
    assert.equal((named.match(/creatorItems\.slice\(-\(CREATOR_ITEM_CAP - 1\)\)/g) ?? []).length, 2, 'both roll paths use the cap');
});
