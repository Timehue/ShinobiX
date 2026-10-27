import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Bank keeps transport and interaction logic out of its presentation', () => {
    const source = readFileSync(new URL('./Bank.tsx', import.meta.url), 'utf8');
    assert.ok(source.split('\n').length <= 225, 'Keep the banking extraction: add logic in the controller/API module.');
    assert.doesNotMatch(source, /\bfetch\(|\basync function\b/);
});
