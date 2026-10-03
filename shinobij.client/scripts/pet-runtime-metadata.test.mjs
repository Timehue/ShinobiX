import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const client = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const revisionSource = readFileSync(resolve(client, 'src/generated/pet-warfront-impostor-url-manifest.ts'), 'utf8');
const certified = JSON.parse(readFileSync(resolve(client, 'public/pet-models/warfront-impostors/manifest.json'), 'utf8'));
const expectedRevisions = Object.fromEntries(certified.entries.map(entry => [entry.sourceUrl, entry.atlasSha256.slice(0, 12)]));
const revisionWriter = readFileSync(resolve(client, 'scripts/generate-warfront-pet-impostors.mjs'), 'utf8');

// Execute the generator's actual pure renderer without invoking its asset bake.
const renderRevisionManifest = new Function('invariant', 'EXPECTED_SOURCE_COUNT', revisionWriter.slice(
    revisionWriter.indexOf('function tsUrlManifest(entries) {'), revisionWriter.indexOf('\nconst lodManifest ='),
) + '\nreturn tsUrlManifest;')((condition, message) => { if (!condition) throw new Error(message); }, 160);

function runtime(source) {
    const module = { exports: {} };
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText, { module, exports: module.exports });
    return module.exports;
}

test('all 160 emitted atlas revisions retain certified values and key order', () => {
    const actual = runtime(revisionSource).WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
    assert.equal(certified.entries.length, 160);
    assert.equal(JSON.stringify(actual), JSON.stringify(expectedRevisions));
});

test('packed atlas revisions keep ordinary object descriptors and independent mutation behavior', () => {
    const actual = runtime(revisionSource).WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
    const independent = runtime(revisionSource).WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
    assert.equal(Object.isFrozen(actual), false);
    assert.equal(Object.getPrototypeOf(actual).constructor.name, 'Object');
    assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(actual)), null);
    for (const key of Object.keys(expectedRevisions)) {
        assert.deepEqual(Object.getOwnPropertyDescriptor(actual, key), Object.getOwnPropertyDescriptor(expectedRevisions, key));
    }
    const [changed, removed] = Object.keys(expectedRevisions);
    actual[changed] = '__private_mutation__';
    delete actual[removed];
    actual.__private_key__ = 'new';
    assert.equal(independent[changed], expectedRevisions[changed]);
    assert.equal(independent[removed], expectedRevisions[removed]);
    assert.equal(Object.hasOwn(independent, '__private_key__'), false);
});

test('revision generator roundtrips the certified complete inventory and refuses unsupported keys or reassociated hashes', () => {
    const source = renderRevisionManifest(certified.entries);
    assert.equal(source, revisionSource.replaceAll('\r\n', '\n'));
    assert.equal(JSON.stringify(runtime(source).WARFRONT_IMPOSTOR_ATLAS_REVISIONS), JSON.stringify(expectedRevisions));
    const changed = (index, values) => certified.entries.map((entry, position) => position === index ? { ...entry, ...values } : entry);
    const reordered = [...certified.entries];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    for (const entries of [
        reordered,
        certified.entries.slice(1),
        changed(0, { sourceUrl: '/pet-models/roster/legendary-30.glb' }),
        changed(159, { sourceUrl: '/pet-models/unreviewed-extra.glb' }),
        changed(0, { sourceUrl: certified.entries[1].sourceUrl }),
    ]) assert.throws(() => renderRevisionManifest(entries), /source inventory\/order changed/);
    for (const atlasSha256 of ['not-a-hash', '0'.repeat(11), 'f'.repeat(63), 'F'.repeat(64)]) {
        assert.throws(() => renderRevisionManifest(changed(0, { atlasSha256 })), /invalid certified atlas SHA-256/);
    }
    assert.throws(() => renderRevisionManifest(changed(0, { sourceUrl: '/external/legendary-0.glb' })), /unexpected impostor source prefix/);
});

test('impostor metadata-only check exits before any asset bake, file mutation or directory traversal', async () => {
    const writerPrefix = revisionWriter.slice(0, revisionWriter.indexOf('\nconst lodManifest ='));
    const parsed = ts.createSourceFile('writer.mjs', writerPrefix, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    const executable = parsed.statements.filter(statement => !ts.isImportDeclaration(statement))
        .map(statement => statement.getFullText(parsed)).join('\n')
        .replaceAll('import.meta.url', JSON.stringify(new URL('./generate-warfront-pet-impostors.mjs', import.meta.url).href));
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fail = () => { throw new Error('Metadata-only check reached an asset or mutation operation'); };
    const stop = {};
    const reads = [];
    const files = new Map([
        [resolve(client, 'public/pet-models/warfront-impostors/manifest.json'), JSON.stringify(certified)],
        [resolve(client, 'src/generated/pet-warfront-impostor-url-manifest.ts'), revisionSource],
    ]);
    const readFile = async (path, encoding) => {
        assert.equal(encoding, 'utf8');
        assert.ok(files.has(path), `Unexpected metadata-only read: ${path}`);
        reads.push(path);
        return files.get(path);
    };
    const fakeProcess = { argv: ['node', 'writer', '--manifest-only', '--check'], exit(code) { assert.equal(code, 0); throw stop; } };
    const execute = new AsyncFunction('resolve', 'dirname', 'fileURLToPath', 'readFile', 'writeFile', 'mkdir', 'rename', 'unlink', 'process', 'console', executable);
    await assert.rejects(execute(resolve, dirname, fileURLToPath, readFile, fail, fail, fail, fail, fakeProcess, { log() {} }), error => error === stop);
    assert.deepEqual(reads, [...files.keys()]);
});


const lodSource = readFileSync(resolve(client, 'src/generated/pet-warfront-lod-manifest.ts'), 'utf8');

const lodCertified = JSON.parse(readFileSync(resolve(client, 'public/pet-models/warfront-lod/manifest.json'), 'utf8'));

const expectedLod = Object.fromEntries(lodCertified.entries.map(({ sourceUrl, lodUrl, sourceTriangles, lodTriangles }) => [sourceUrl, { lodUrl, sourceTriangles, lodTriangles }]));

const lodWriter = readFileSync(resolve(client, 'scripts/generate-warfront-pet-lods.mjs'), 'utf8');

const renderLodManifest = new Function('invariant', 'REVISION', lodWriter.slice(lodWriter.indexOf('function manifestTs(entries) {'), lodWriter.indexOf('\nconst sources = await existingRuntimeSources();')) + '\nreturn manifestTs;')((condition, message) => { if (!condition)
    throw new Error(message); }, lodCertified.revision);

test('all 160 LOD entries retain certified ordered URLs, suffixes and triangle counts', () => {
    const actual = runtime(lodSource);
    assert.equal(lodCertified.entries.length, 160);
    assert.equal(actual.WARFRONT_PET_LOD_REVISION, lodCertified.revision);
    assert.equal(JSON.stringify(actual.WARFRONT_PET_LOD_MANIFEST), JSON.stringify(expectedLod));
});

test('LOD metadata retains plain writable objects and independent nested entries', () => {
    const actual = runtime(lodSource).WARFRONT_PET_LOD_MANIFEST, independent = runtime(lodSource).WARFRONT_PET_LOD_MANIFEST;
    assert.equal(Object.isFrozen(actual), false);
    assert.equal(Object.getPrototypeOf(actual).constructor.name, 'Object');
    assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(actual)), null);
    for (const [source, expected] of Object.entries(expectedLod)) {
        const descriptor = Object.getOwnPropertyDescriptor(actual, source);
        for (const field of ['enumerable', 'writable', 'configurable'])
            assert.equal(descriptor[field], true);
        for (const property of ['lodUrl', 'sourceTriangles', 'lodTriangles'])
            assert.deepEqual(Object.getOwnPropertyDescriptor(actual[source], property), Object.getOwnPropertyDescriptor(expected, property));
        assert.equal(Object.getPrototypeOf(actual[source]).constructor.name, 'Object');
        assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(actual[source])), null);
    }
    const [changed, removed] = Object.keys(expectedLod);
    actual[changed].lodUrl = '__private_mutation__';
    delete actual[removed];
    actual.__private_key__ = 'new';
    assert.equal(JSON.stringify(independent), JSON.stringify(expectedLod));
});

test('LOD generator roundtrips all certified entries without changing URLs or metadata', () => {
    const generated = renderLodManifest(lodCertified.entries);
    assert.equal(generated, lodSource.replaceAll('\r\n', '\n'));
    assert.equal(JSON.stringify(runtime(generated).WARFRONT_PET_LOD_MANIFEST), JSON.stringify(expectedLod));
    const changed = (values) => lodCertified.entries.map((entry, index) => index === 0 ? { ...entry, ...values } : entry);
    assert.throws(() => renderLodManifest(changed({ sourceUrl: '/external/legendary-0.glb' })), /unexpected LOD source prefix/);
    assert.throws(() => renderLodManifest(changed({ lodUrl: '/pet-models/warfront-lod/another.glb?v=' + lodCertified.revision })), /unexpected certified LOD URL/);
});

for (const check of [true, false])
    test(`LOD metadata-only ${check ? 'check' : 'generation'} exits without processing any model`, async () => {
        const prefix = lodWriter.slice(0, lodWriter.indexOf('\nawait Promise.all([MeshoptDecoder.ready'));
        const parsed = ts.createSourceFile('writer.mjs', prefix, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
        const declarations = lodWriter.slice(lodWriter.indexOf('function manifestTs(entries) {'), lodWriter.indexOf('\nconst sources = await existingRuntimeSources();'));
        const executable = parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join('\n')
            .replaceAll('import.meta.url', JSON.stringify(new URL('./generate-warfront-pet-lods.mjs', import.meta.url).href))
            + '\nfunction invariant(condition,message){if(!condition)throw new Error(message);}\n' + declarations;
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor, stop = {}, reads = [], writes = [];
        const jsonPath = resolve(client, 'public/pet-models/warfront-lod/manifest.json'), tsPath = resolve(client, 'src/generated/pet-warfront-lod-manifest.ts');
        const files = new Map([[jsonPath, JSON.stringify(lodCertified)], [tsPath, lodSource]]);
        const readFile = async (file, encoding) => { assert.equal(encoding, 'utf8'); assert.ok(files.has(file)); reads.push(file); return files.get(file); };
        const writeFile = async (file, content) => { assert.equal(check, false); assert.equal(file, tsPath); assert.equal(content, lodSource.replaceAll('\r\n', '\n')); writes.push(file); };
        const fail = () => { throw new Error('metadata-only path reached model work'); };
        const fakeProcess = { argv: ['node', 'writer', '--manifest-only', ...(check ? ['--check'] : [])], exit(code) { assert.equal(code, 0); throw stop; } };
        const execute = new AsyncFunction('resolve', 'dirname', 'fileURLToPath', 'readFile', 'writeFile', 'mkdir', 'readdir', 'stat', 'MeshoptDecoder', 'MeshoptEncoder', 'MeshoptSimplifier', 'process', 'console', executable);
        await assert.rejects(execute(resolve, dirname, fileURLToPath, readFile, writeFile, fail, fail, fail, new Proxy({}, { get: fail }), new Proxy({}, { get: fail }), new Proxy({}, { get: fail }), fakeProcess, { log() { } }), error => error === stop);
        assert.deepEqual(reads, check ? [jsonPath, tsPath] : [jsonPath]);
        assert.deepEqual(writes, check ? [] : [tsPath]);
    });

test('both compact exports preserve every expanded readonly literal type', () => {
    const directory = resolve(client, '.audit-runtime-metadata-types');
    const before = `export const WARFRONT_IMPOSTOR_ATLAS_REVISIONS = ${JSON.stringify(expectedRevisions)} as const;\nexport const WARFRONT_PET_LOD_REVISION = ${JSON.stringify(lodCertified.revision)};\nexport const WARFRONT_PET_LOD_MANIFEST = ${JSON.stringify(expectedLod)} as const;\nexport type WarfrontPetLodSourceUrl = keyof typeof WARFRONT_PET_LOD_MANIFEST;\n`;
    const after = revisionSource + '\n' + lodSource;
    const assertion = `import * as old from './before'; import * as current from './after';
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true>=T;
type SameRevisions=Assert<Equal<typeof old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS,typeof current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS>>;
type SameLod=Assert<Equal<typeof old.WARFRONT_PET_LOD_MANIFEST,typeof current.WARFRONT_PET_LOD_MANIFEST>>;
type SameLodKeys=Assert<Equal<old.WarfrontPetLodSourceUrl,current.WarfrontPetLodSourceUrl>>;
type SameLodRevision=Assert<Equal<typeof old.WARFRONT_PET_LOD_REVISION,typeof current.WARFRONT_PET_LOD_REVISION>>;
const oldToNew:typeof current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS=old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
const newToOld:typeof old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS=current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
const lodOldToNew:typeof current.WARFRONT_PET_LOD_MANIFEST=old.WARFRONT_PET_LOD_MANIFEST;
const lodNewToOld:typeof old.WARFRONT_PET_LOD_MANIFEST=current.WARFRONT_PET_LOD_MANIFEST;`;
    const files = new Map([[resolve(directory, 'before.ts'), before], [resolve(directory, 'after.ts'), after], [resolve(directory, 'assert.ts'), assertion]]);
    const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, strict: true, skipLibCheck: true, types: [] };
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host), directoryExists = host.directoryExists.bind(host);
    host.readFile = file => files.get(resolve(file)) ?? read(file);
    host.fileExists = file => files.has(resolve(file)) || exists(file);
    host.directoryExists = file => resolve(file) === directory || directoryExists(file);
    host.getSourceFile = (file, version) => { const content = host.readFile(file); return content === undefined ? undefined : ts.createSourceFile(file, content, version); };
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([resolve(directory, 'assert.ts')], options, host));
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => client, getNewLine: () => '\n' }));
});
