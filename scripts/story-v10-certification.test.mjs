import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../shinobij.client/scripts/story-v10-certification.mjs', import.meta.url), 'utf8');

test('story v10 certification builds the current client before serving dist', () => {
    const buildCall = source.indexOf('await buildFreshClient();');
    const serverSpawn = source.indexOf('const server = spawn(');
    assert.notEqual(buildCall, -1, 'certification must build the client');
    assert.notEqual(serverSpawn, -1, 'certification must launch its isolated server');
    assert.ok(buildCall < serverSpawn, 'the fresh build must finish before dist is served');
});
