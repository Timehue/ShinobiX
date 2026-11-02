import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { minifyRuntimeJson, minifyRuntimeSource } from './runtime-asset-minifier.mjs';

const repoRoot = join(import.meta.dirname, '..');

for (const name of ['boot-watchdog.js', 'sw.js']) {
    test(`production minification preserves valid ${name} output and reduces bytes`, () => {
        const source = readFileSync(join(repoRoot, 'shinobij.client', 'public', name), 'utf8');
        const minified = minifyRuntimeSource(source);
        assert.ok(Buffer.byteLength(minified) < Buffer.byteLength(source), 'the shipped script should be smaller');
        assert.doesNotThrow(() => new Script(minified, { filename: name }), 'the minified classic script should parse');
    });
}

test('JSON minification preserves the manifest graph, ordering and escaped text', () => {
    const manifest = {
        'src/main.tsx': { file: 'assets/main-abc.js', isEntry: true,
            imports: ['_shared.js'], dynamicImports: ['src/screens/StoryHall.tsx'], css: ['assets/main.css'] },
        '_shared.js': { file: 'assets/shared-def.js' },
        'src/screens/StoryHall.tsx': { file: 'assets/story-ghi.js', isDynamicEntry: true,
            imports: ['_shared.js'], assets: ['assets/story.json'], name: '\u96ea\n"Story"' },
    };
    const source = `${JSON.stringify(manifest, null, 2)}\n`;
    const minified = minifyRuntimeJson(source);
    assert.deepEqual(JSON.parse(minified), manifest);
    assert.deepEqual(Object.keys(JSON.parse(minified)), Object.keys(manifest));
    assert.ok(Buffer.byteLength(minified) < Buffer.byteLength(source));
    assert.equal(minifyRuntimeJson(minified), minified, 'reruns leave compact JSON unchanged');
    assert.throws(() => minifyRuntimeJson('{broken'), SyntaxError, 'malformed metadata fails the build');
});
