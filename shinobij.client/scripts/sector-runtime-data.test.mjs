import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { sectorRuntimeData } from './sector-runtime-data.mjs';

test('browser delivery preserves every runtime sector value and leaves its canonical source intact', () => {
    const file = join(import.meta.dirname, '../../shared/sector-floor-layout-data.json');
    const source = readFileSync(file, 'utf8'), original = JSON.parse(source);
    const delivered = JSON.parse(sectorRuntimeData(source));
    assert.equal(Object.keys(delivered.layouts).length, 66);
    assert.deepEqual(delivered.floors, original.floors, 'cache hashes remain complete');
    assert.deepEqual(delivered.landmarks, original.landmarks);
    for (const [key, layout] of Object.entries(original.layouts)) {
        const expected = { ...layout };
        delete expected.name; delete expected.exits; delete expected.hydrology;
        assert.deepEqual(delivered.layouts[key], expected,
            `all mask cells, footprint coordinates, village access and other runtime data stay exact: ${key}`);
    }
    assert.equal(readFileSync(file, 'utf8'), source, 'the authoring and server registry is untouched');
    assert(Buffer.byteLength(JSON.stringify(original)) - Buffer.byteLength(JSON.stringify(delivered)) > 10_000);
    const future = { layouts: { 1: { mask: ['.'], futureRuntimeField: { value: 7 } } }, floors: {}, landmarks: {} };
    assert.deepEqual(JSON.parse(sectorRuntimeData(JSON.stringify(future))), future, 'unrecognized future fields are retained');
});
