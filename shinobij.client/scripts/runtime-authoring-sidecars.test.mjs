import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('the production copy omits art receipts while retaining artwork and ordinary runtime JSON', () => {
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const source = config.slice(config.indexOf('const PUBLIC_AUTHORING_PREFIXES ='), config.indexOf('\nfunction recordId('));
    const client = path.resolve('runtime-copy-fixture');
    const publicRoot = path.join(client, 'public');
    const outputRoot = path.join(client, 'dist');
    const inputs = new Map([
        ['sector-life/shrine.json', '{"provider":"image_gen","areas":[]}'],
        ['sector-life/shrine.webp', 'reviewed sector artwork'],
        ['ui/village-war/manifest.json', '{"generator":"image_gen","assets":[]}'],
        ['ui/village-war/stronghold.webp', 'reviewed village artwork'],
        ['runtime/settings.json', '{"enabled":true}'],
    ].map(([name, bytes]) => [path.join(publicRoot, name), bytes]));
    const outputs = new Map();
    const children = directory => [...new Set([...inputs.keys()]
        .filter(name => name.startsWith(directory + path.sep))
        .map(name => path.relative(directory, name).split(path.sep)[0]))];
    const fs = {
        statSync: name => ({ isDirectory: () => !inputs.has(name) }),
        readdirSync: (name, options) => children(name).map(child => options?.withFileTypes ? { name: child } : child),
        mkdirSync() {},
        copyFileSync: (from, to) => { assert.ok(inputs.has(from)); outputs.set(to, inputs.get(from)); },
    };
    const javascript = ts.transpileModule(source + '\nglobalThis.plugin = runtimePublicAssetsPlugin();', {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const context = { fs, path, PUBLIC_ROOT: publicRoot, CLIENT_ROOT: client };
    runInNewContext(javascript, context);
    context.plugin.writeBundle({ dir: outputRoot });
    assert.deepEqual([...outputs.keys()].map(name => path.relative(outputRoot, name).replaceAll('\\', '/')).sort(), [
        'runtime/settings.json', 'sector-life/shrine.webp', 'ui/village-war/stronghold.webp',
    ]);
    for (const [name, bytes] of outputs) assert.equal(bytes, inputs.get(path.join(publicRoot, path.relative(outputRoot, name))));
    assert.equal(inputs.size, 5, 'authoring inputs remain available locally');
});
