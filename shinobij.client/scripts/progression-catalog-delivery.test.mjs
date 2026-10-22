import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { packStaticCatalogLiteral, staticCatalogValue } from './pack-static-catalog.mjs';
import { progressionCatalogDelivery } from './progression-catalog-delivery.mjs';

async function moduleFrom(source) {
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('packed progression retains every species, unlock boundary, mastery and authored override', async () => {
    const source = readFileSync(new URL('../../shared/pet-ability-progression.ts', import.meta.url), 'utf8');
    const packed = progressionCatalogDelivery().transform(source, '/shared/pet-ability-progression.ts').code;
    const before = await moduleFrom(source);
    const after = await moduleFrom(packed);
    const definitions = staticCatalogValue(source, 'SPECIES_ABILITIES');
    assert.equal(Object.keys(definitions).length, 161);
    assert.deepEqual(after.PET_ABILITY_SPECIES_IDS, before.PET_ABILITY_SPECIES_IDS);
    for (const [id, definition] of Object.entries(definitions)) {
        for (const level of [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100]) {
            for (const abilities of [undefined, Object.values(definition.moves), ...(definition.overrideMoves ? [Object.values(definition.overrideMoves)] : [])]) {
                const input = { templateId: id, level, ...(abilities ? { abilities } : {}) };
                assert.deepEqual(after.resolvePetAbilityProgression(input), before.resolvePetAbilityProgression(input), `${id} at ${level}`);
            }
            const input = { templateId: id, level, abilities: [
                { id: 'fire-strike', name: 'Fire Strike', kind: 'damage', power: 85 },
                { id: 'mend', name: 'Mend', kind: 'heal', power: 0, cooldown: 2 },
                { id: id + '-signature', name: 'Final Art', kind: 'damage', power: 100, signature: true },
            ] };
            for (const ruleset of ['progression', 'competitive-tactics']) {
                const options = { abilitySource: 'tactics', ruleset };
                assert.deepEqual(after.resolvePetAbilityProgression(input, options), before.resolvePetAbilityProgression(input, options));
            }
        }
    }
    assert(packed.length < source.length - 85000, 'both app and worker avoid the repeated full literal');
});

test('packed URL registries preserve all paths, Unicode and frozen lookup contracts', async () => {
    const source = readFileSync(new URL('../../shared/chronicle-painted-art.ts', import.meta.url), 'utf8');
    const packed = progressionCatalogDelivery().transform(source, '/shared/chronicle-painted-art.ts').code;
    const before = await moduleFrom(source);
    const after = await moduleFrom(packed);
    for (const name of ['CHRONICLE_PAINTED_ART', 'CHRONICLE_PAINTED_FIGURES']) {
        assert.deepEqual(after[name], before[name]);
        assert(Object.isFrozen(after[name]));
    }
    assert(packed.length < source.length - 35000);
    const fixture = 'export const catalog = Object.freeze({text:"\u96ea\u00e9\\n\\\"", cooldown:0, currentCooldown:3, signature:true, future:{enabled:false,value:null}, delta:-1});';
    const result = await moduleFrom(packStaticCatalogLiteral(fixture, 'catalog'));
    assert.deepEqual(result.catalog, (await moduleFrom(fixture)).catalog);
    assert(Object.isFrozen(result.catalog));
});

test('literal packing refuses executable expressions and leaves unrelated modules alone', () => {
    assert.throws(() => staticCatalogValue('const data = {get value(){return 1}};', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const data = execute();', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const shared = {}; const data = {shared};', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const shared = {}; const data = {shared:shared};', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('let mutable = "before"; const data = {value:mutable};', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const executable = execute(); const data = {value:executable};', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const data = {value:future}; const future = "later";', 'data'), /Non-literal/);
    assert.throws(() => staticCatalogValue('const data = {value:future}, future = "later";', 'data'), /Non-literal/);
    assert.equal(progressionCatalogDelivery().transform('const value = 1;', '/shared/other.ts'), undefined);
});

test('world catalog delivery retains every card, reviewed effect, reckoning and technique description', async () => {
    for (const [relative, name] of [
        ['../../shared/tile-cards.ts', 'shinobiTileCards'],
        ['../../shared/chronicle-duel.ts', 'REVIEWED_MONSTER_EFFECTS'],
        ['../src/data/story-reckonings.ts', 'storyReckonings'],
        ['../src/data/jutsu.ts', 'nonBloodlineFlavor'],
    ]) {
        const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
        const parsed = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true);
        const declaration = parsed.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
            .find(binding => binding.name.getText(parsed) === name);
        const isolated = `export const ${name} = ${declaration.initializer.getText(parsed)};`;
        const original = (await moduleFrom(isolated))[name];
        const packed = progressionCatalogDelivery().transform(isolated, relative.replace('../../shared/', '/shared/').replace('../src/', '/src/')).code;
        const delivered = (await moduleFrom(packed))[name];
        assert.deepEqual(delivered, original);
        assert.equal(Object.isFrozen(delivered), Object.isFrozen(original));
        assert.deepEqual(Object.keys(delivered), Object.keys(original));
        assert.deepEqual(staticCatalogValue(source, name), original);
        assert(packed.length < isolated.length - 6000);
    }
});

test('pet identities and legacy technique rows pack exactly with safe scalar constants', async () => {
    for (const [relative, name, minimum] of [
        ['../../shared/pet-tactics-catalog.ts', 'PET_TACTICS_IDENTITIES', 4500],
        ['../src/data/legacy-jutsu.ts', 'ROWS', 32000],
    ]) {
        const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
        const value = staticCatalogValue(source, name);
        const parsed = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true);
        const declaration = parsed.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
            .find(binding => binding.name.getText(parsed) === name);
        const isolated = `const S = "S Rank"; const A = "A Rank"; export const ${name} = ${declaration.initializer.getText(parsed)};`;
        const packed = packStaticCatalogLiteral(isolated, name);
        const original = (await moduleFrom(isolated))[name];
        assert.deepEqual(value, original, 'AST reading agrees with the original literal execution');
        assert.deepEqual((await moduleFrom(packed))[name], original);
        assert(isolated.length - packed.length > minimum);
        const transformed = progressionCatalogDelivery().transform(source, relative.replace('../src/', '/src/').replace('../../shared/', '/shared/'));
        assert.ok(transformed?.code.includes('JSON.parse('));
    }
    const source = 'const fixed = "S Rank"; const alias = fixed; export const data = [{rank:alias, cooldown:0, signature:false}];';
    assert.deepEqual((await moduleFrom(packStaticCatalogLiteral(source, 'data'))).data, (await moduleFrom(source)).data);
});
