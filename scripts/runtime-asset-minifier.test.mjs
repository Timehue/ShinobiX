import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { minifyRuntimeSource } from './runtime-asset-minifier.mjs';

const repoRoot = join(import.meta.dirname, '..');

for (const name of ['boot-watchdog.js', 'sw.js']) {
    test(`production minification preserves valid ${name} output and reduces bytes`, () => {
        const source = readFileSync(join(repoRoot, 'shinobij.client', 'public', name), 'utf8');
        const minified = minifyRuntimeSource(source);
        assert.ok(Buffer.byteLength(minified) < Buffer.byteLength(source), 'the shipped script should be smaller');
        assert.doesNotThrow(() => new Script(minified, { filename: name }), 'the minified classic script should parse');
    });
}
