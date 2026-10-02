import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderLegacyRoster } from './generate-legacy-roster.mts';

test('generated Legacy roster matches the canonical identities and all trial variants', () => {
    assert.equal(fs.readFileSync(new URL('../docs/legacy-roster.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), renderLegacyRoster());
});
