import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { CHRONICLE_LEGACY_SOURCES } from '../../shared/legacy-card-sources';
import { hollowRifts, hollowRiftById } from '../src/data/hollow-rifts';
import { packStaticCatalog } from './pack-static-catalog.mjs';

test('packed lazy catalogs preserve all content, identifiers, functions and future fields', async () => {
    for (const [path, name, value] of [
        ['../../shared/legacy-card-sources.ts', 'CHRONICLE_LEGACY_SOURCES', CHRONICLE_LEGACY_SOURCES],
        ['../src/data/hollow-rifts.ts', 'hollowRifts', hollowRifts],
    ] as const) {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        const delivered = packStaticCatalog(source, name, value);
        const code = ts.transpileModule(delivered, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
        const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
        assert.deepEqual(module[name], value);
        if (name === 'hollowRifts') {
            for (const rift of hollowRifts) assert.deepEqual(module.hollowRiftById(rift.id), hollowRiftById(rift.id));
            assert.equal(module.hollowRiftById('missing'), null);
        }
        assert.equal(readFileSync(new URL(path, import.meta.url), 'utf8'), source);
    }
    assert.throws(() => packStaticCatalog('const other = [];', 'missing', []), /Missing static catalog/);
});
