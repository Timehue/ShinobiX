import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transformSync } from 'esbuild';
import { packStaticCatalogLiteral, staticCatalogValue } from './pack-static-catalog.mjs';
import { progressionCatalogDelivery } from './progression-catalog-delivery.mjs';

async function moduleFrom(source, file) {
    const result = await build({
        stdin: { contents: source, resolveDir: dirname(file), sourcefile: file, loader: 'ts' },
        bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('on-demand catalog delivery retains every lesson, rumor choice, portrait URL and row order', async () => {
    for (const name of ['pet-tutorial', 'legacy-rumors', 'pet-portrait-assets.generated']) {
        const file = fileURLToPath(new URL(`../src/lib/${name}.ts`, import.meta.url));
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
        if (name === 'pet-tutorial') {
            for (const level of [1, 10, 50, 100]) for (const count of [0, 1, 3]) {
                const character = { level, pets: Array.from({ length: count }, () => ({})) };
                assert.deepEqual(after.nextPetTutorialLesson(character), before.nextPetTutorialLesson(character));
                for (const lesson of before.PET_TUTORIAL_LESSONS) {
                    assert.equal(after.petTutorialLessonAvailable(lesson, character), before.petTutorialLessonAvailable(lesson, character));
                    assert.deepEqual(after.completePetTutorialLesson({}, lesson.id), before.completePetTutorialLesson({}, lesson.id));
                }
            }
        }
        if (name === 'legacy-rumors') {
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
