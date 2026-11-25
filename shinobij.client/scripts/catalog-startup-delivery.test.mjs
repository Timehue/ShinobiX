import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import { packStaticCatalogLiteral, staticCatalogValue } from './pack-static-catalog.mjs';
import { progressionCatalogDelivery } from './progression-catalog-delivery.mjs';

async function moduleFrom(source, file) {
    const result = await build({
        stdin: { contents: source, resolveDir: dirname(file), sourcefile: file, loader: 'ts' },
        bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('packed room layouts preserve every door, tile, resident and dialogue line', async () => {
    const file = fileURLToPath(new URL('../src/lib/first-pact-interiors.ts', import.meta.url));
    const source = readFileSync(file, 'utf8');
    const original = await moduleFrom(source, file);
    const packed = await moduleFrom(packStaticCatalogLiteral(source, 'FIRST_PACT_INTERIORS'), file);
    assert.deepEqual(packed.FIRST_PACT_INTERIORS, original.FIRST_PACT_INTERIORS);
});

test('compact map delivery preserves roads, standing tiles, gathering sites and find descriptions', async () => {
    for (const [path, names] of [
        ['../../shared/coast-resource-nodes.ts', ['placements']],
        ['../../shared/sector-geo.ts', ['SECTOR_PLACES']],
        ['../../shared/sector-links.ts', ['SECTOR_POINTS', 'SECTOR_ROAD_PAIRS']],
        ['../../shared/sector-life-standing.ts', ['LIFE_STANDING_CODES']],
        ['../../shared/resource-node-terrain.ts', ['RESOURCE_MEADOW_TILES', 'RESOURCE_ROCK_TILES']],
        ['../src/lib/gathering-vn.ts', ['FIND_SCENES']],
    ]) {
        const file = fileURLToPath(new URL(path, import.meta.url));
        const source = readFileSync(file, 'utf8');
        const before = await moduleFrom(source, file);
        const after = await moduleFrom(names.reduce((text, name) => packStaticCatalogLiteral(text, name), source), file);
        for (const [key, value] of Object.entries(before)) {
            if (typeof value !== 'function') assert.deepEqual(after[key], value, path + '/' + key);
        }
    }
});

test('packed fieldwork catalogs preserve outpost guidance, professions and NPC choices', async () => {
    for (const [path, name] of [
        ['components/OutpostResourcePanel.tsx', 'PANEL'],
        ['data/professions.ts', 'PROFESSION_INFO'],
        ['lib/hunt-encounter.ts', 'SIGNS'],
        ['lib/wanderers.ts', 'WANDERER_QUEST_CATALOG'],
    ]) {
        const file = fileURLToPath(new URL('../src/' + path, import.meta.url));
        const tree = ts.createSourceFile(path, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const declarations = tree.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]);
        const binding = declarations.find(d => d.name.getText(tree) === name);
        assert.ok(binding?.initializer, path);
        const constants = declarations.filter(d => d.initializer && ts.isStringLiteral(d.initializer))
            .map(d => 'const ' + d.getText(tree) + ';');
        const source = [...constants, `export const ${name} = ${binding.initializer.getText(tree)};`].join('\n');
        const original = await moduleFrom(source, file);
        const packed = await moduleFrom(packStaticCatalogLiteral(source, name), file);
        assert.deepEqual(packed[name], original[name], path);
    }
});

test('on-demand catalog delivery retains lessons, rumors, portrait and model URLs, and row order', async () => {
    for (const name of ['lib/pet-tutorial', 'lib/legacy-rumors', 'lib/pet-portrait-assets.generated', 'generated/pet-warfront-lod-manifest']) {
        const file = fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
        const source = readFileSync(file, 'utf8');
        const transformed = progressionCatalogDelivery().transform(source, file).code;
        const before = await moduleFrom(source, file);
        const after = await moduleFrom(transformed, file);
        assert.deepEqual(Object.keys(after), Object.keys(before), name);
        for (const [key, value] of Object.entries(before)) {
            if (typeof value === 'function') continue;
            assert.deepEqual(after[key], value, `${name}/${key}`);
            assert.equal(Object.isFrozen(after[key]), Object.isFrozen(value), `${name}/${key}: freezing`);
        }
        if (name === 'lib/pet-tutorial') {
            for (const level of [1, 10, 50, 100]) for (const count of [0, 1, 3]) {
                const character = { level, pets: Array.from({ length: count }, () => ({})) };
                assert.deepEqual(after.nextPetTutorialLesson(character), before.nextPetTutorialLesson(character));
                for (const lesson of before.PET_TUTORIAL_LESSONS) {
                    assert.equal(after.petTutorialLessonAvailable(lesson, character), before.petTutorialLessonAvailable(lesson, character));
                    assert.deepEqual(after.completePetTutorialLesson({}, lesson.id), before.completePetTutorialLesson({}, lesson.id));
                }
            }
        }
        if (name === 'lib/legacy-rumors') {
            for (const category of [...before.RUMOR_CATEGORIES, 'unknown', undefined]) {
                assert.deepEqual(after.rumorArc(category), before.rumorArc(category));
                for (const level of [1, 10, 20, 30, 40, 45, 100]) for (const playerName of ['', 'Maple', 'River']) {
                    for (const tier of ['stirring', 'taking shape', 'strong', 'dominant']) {
                        const options = { playerName, tier };
                        assert.equal(after.rumorForCategory(category, level, options), before.rumorForCategory(category, level, options));
                    }
                }
            }
        }
    }
});

test('eager technique descriptions remain exact while using the smaller gzip representation', async () => {
    const file = fileURLToPath(new URL('../src/data/jutsu.ts', import.meta.url));
    const source = readFileSync(file, 'utf8');
    assert.equal(progressionCatalogDelivery().transform(source, file), undefined);
    const value = staticCatalogValue(source, 'nonBloodlineFlavor');
    const literal = `export const flavor = ${JSON.stringify(value)};`;
    const packed = packStaticCatalogLiteral(literal, 'flavor');
    assert.deepEqual((await moduleFrom(packed, file)).flavor, (await moduleFrom(literal, file)).flavor);
    const bytes = code => gzipSync(transformSync(code, { minify: true }).code, { level: 9 }).length;
    const shipped = bytes(literal);
    assert.ok(shipped <= 2900, 'eager technique descriptions must fit the shipped gzip budget');
    assert.ok(shipped < bytes(packed), 'eager prose should use the smaller gzip representation');
});
