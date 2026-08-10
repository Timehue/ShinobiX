import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPetArenaStaticIsolation, auditPetArenaStaticGraph } from './pet-arena-static-graph.ts';

const petArena = 'C:\\repo\\shinobij.client\\src\\screens\\PetArena.tsx';
const match = 'C:\\repo\\shinobij.client\\src\\components\\PetWarfrontMatch.tsx';
const sim = 'C:\\repo\\shinobij.client\\src\\lib\\pet-warfront-sim.ts';
const map = 'C:\\repo\\shinobij.client\\src\\lib\\pet-warfront-map.ts';
const mask = 'C:\\repo\\shinobij.client\\src\\lib\\pet-warfront-mask-baked.ts';

test('Pet Arena setup follows static imports and rejects the full simulator', () => {
    const chunks = [
        { fileName: '/assets/PetArena.js', imports: ['setup.js'], modules: { [petArena]: {} } },
        { fileName: 'assets/setup.js', imports: ['./sim.js'], modules: { '/src/lib/pet-warfront-strategy.ts': {} } },
        { fileName: 'assets/sim.js', imports: [], modules: { [sim]: {} } },
    ];

    const audit = auditPetArenaStaticGraph(chunks);
    assert.deepEqual(audit.reachableChunks, ['assets/PetArena.js', 'assets/setup.js', 'assets/sim.js']);
    assert.deepEqual(audit.forbiddenModules, [{ chunk: 'assets/sim.js', module: sim.replaceAll('\\', '/') }]);
    assert.throws(() => assertPetArenaStaticIsolation(chunks), /statically reaches the full Warfront runtime/);
});

test('dynamic imports stay outside the Pet Arena setup graph', () => {
    const chunks = [
        { fileName: 'assets/PetArena.js', imports: ['assets/setup.js'], dynamicImports: ['assets/PetWarfrontMatch.js'], modules: { [petArena]: {} } },
        { fileName: 'assets/setup.js', imports: [], dynamicImports: [], modules: { '/src/lib/pet-warfront-strategy.ts': {} } },
        { fileName: 'assets/PetWarfrontMatch.js', imports: [], dynamicImports: [], modules: { [match]: {}, [sim]: {} } },
    ];

    const audit = auditPetArenaStaticGraph(chunks);
    assert.deepEqual(audit.reachableChunks, ['assets/PetArena.js', 'assets/setup.js']);
    assert.deepEqual(audit.forbiddenModules, []);
    assert.doesNotThrow(() => assertPetArenaStaticIsolation(chunks));
});

test('a forbidden module co-located with the Pet Arena facade is rejected', () => {
    const chunks = [
        { fileName: 'assets/PetArena.js', imports: [], modules: { [petArena]: {}, [`${match}?v=1`]: {} } },
    ];

    assert.throws(() => assertPetArenaStaticIsolation(chunks), /PetWarfrontMatch\.tsx/);
});

test('the procedural map and baked mask cannot regress into the setup graph', () => {
    for (const forbidden of [map, mask]) {
        const chunks = [
            { fileName: 'assets/PetArena.js', imports: ['./warfront-data.js'], modules: { [petArena]: {} } },
            { fileName: 'assets/warfront-data.js', imports: [], modules: { [forbidden]: {} } },
        ];
        const audit = auditPetArenaStaticGraph(chunks);
        assert.deepEqual(audit.forbiddenModules, [{
            chunk: 'assets/warfront-data.js',
            module: forbidden.replaceAll('\\', '/'),
        }]);
        assert.throws(() => assertPetArenaStaticIsolation(chunks), /pet-warfront-(?:map|mask-baked)\.ts/);
    }
});

test('a missing or duplicated Pet Arena facade fails closed', () => {
    assert.throws(() => assertPetArenaStaticIsolation([]), /found 0/);
    assert.throws(() => assertPetArenaStaticIsolation([
        { fileName: 'assets/a.js', imports: [], modules: { [petArena]: {} } },
        { fileName: 'assets/b.js', imports: [], modules: { [petArena]: {} } },
    ]), /found 2/);
});
