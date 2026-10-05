import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { petPoseMembership, petPoseManifestTs } from './pet-pose-manifest.mjs';

const client = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const poseSource = readFileSync(resolve(client, 'src/assets/coliseum/pet-poses-manifest.ts'), 'utf8');
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
    runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2023' }).code, { module, exports: module.exports });
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

test('all three 158-member pose Sets retain the actual complete artwork inventory', () => {
    const expected = petPoseMembership(readdirSync(resolve(client, 'public/pet-poses')));
    const actual = runtime(poseSource);
    for (const [name, ids] of Object.entries(expected)) {
        assert.equal(ids.length, 158, name);
        assert.equal(JSON.stringify(Array.from(actual[name])), JSON.stringify(ids), name);
    }
    assert.equal(poseSource.replaceAll('\r\n', '\n'), petPoseManifestTs(expected));
});

test('shared compact input keeps independently mutable Set instances', () => {
    const actual = runtime(poseSource);
    const sets = Object.values(actual);
    assert.equal(new Set(sets).size, 3);
    sets[0].add('__private_mutation__');
    assert.equal(sets[1].has('__private_mutation__'), false);
    assert.equal(sets[2].has('__private_mutation__'), false);
    const removed = sets[1].values().next().value;
    sets[1].delete(removed);
    assert.equal(sets[0].has(removed), true);
    assert.equal(sets[2].has(removed), true);
});

test('membership requires every frame and ignores unrelated files', () => {
    assert.deepEqual(petPoseMembership([
        'complete-idle.webp', 'complete-attack.webp', 'complete-hurt.webp', 'complete-cast.webp',
        'partial-idle.webp', 'partial-attack.webp', 'partial-hurt.webp',
        'runner-run-a.webp', 'runner-run-b.webp', 'half-runner-run-a.webp',
        'striker-windup.webp', 'striker-lunge.webp', 'striker-impact.webp', 'striker-recover.webp',
        'incomplete-windup.webp', 'incomplete-lunge.webp', 'incomplete-impact.webp', 'master.png',
    ]), { POSED_PET_IDS: ['complete'], POSED_MOVE_IDS: ['striker'], POSED_RUN_IDS: ['runner'] });
});

test('compact ranges preserve sparse/noncanonical ids and independent memberships', () => {
    const expected = {
        POSED_PET_IDS: ['mythic-00', 'rare-1', 'rare-3', 'standard-0', 'standard-1', 'z-extra'],
        POSED_MOVE_IDS: ['rare-3'],
        POSED_RUN_IDS: [],
    };
    const actual = runtime(petPoseManifestTs(expected));
    for (const [name, ids] of Object.entries(expected)) assert.equal(JSON.stringify(Array.from(actual[name])), JSON.stringify(ids));
});

test('compact revisions and pose exports preserve exact expanded readonly types', () => {
    const directory = resolve(client, '.audit-runtime-metadata-types');
    const before = `export const WARFRONT_IMPOSTOR_ATLAS_REVISIONS = ${JSON.stringify(expectedRevisions)} as const;\n`
        + Object.keys(petPoseMembership([])).map(name => `export const ${name}: ReadonlySet<string> = new Set();`).join('\n');
    const after = revisionSource + '\n' + poseSource;
    const assertion = `
import * as old from './before';
import * as current from './after';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type SameRevisions = Assert<Equal<typeof old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS, typeof current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS>>;
type SamePetSet = Assert<Equal<typeof old.POSED_PET_IDS, typeof current.POSED_PET_IDS>>;
type SameMoveSet = Assert<Equal<typeof old.POSED_MOVE_IDS, typeof current.POSED_MOVE_IDS>>;
type SameRunSet = Assert<Equal<typeof old.POSED_RUN_IDS, typeof current.POSED_RUN_IDS>>;
const oldToNew: typeof current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS = old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
const newToOld: typeof old.WARFRONT_IMPOSTOR_ATLAS_REVISIONS = current.WARFRONT_IMPOSTOR_ATLAS_REVISIONS;
`;
    const files = new Map([
        [resolve(directory, 'before.ts'), before], [resolve(directory, 'after.ts'), after],
        [resolve(directory, 'assert.ts'), assertion],
    ]);
    const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, strict: true, skipLibCheck: true, types: [] };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const directoryExists = host.directoryExists.bind(host);
    host.readFile = file => files.get(resolve(file)) ?? read(file);
    host.fileExists = file => files.has(resolve(file)) || exists(file);
    host.directoryExists = file => resolve(file) === directory || directoryExists(file);
    host.getSourceFile = (file, version) => {
        const content = host.readFile(file);
        return content === undefined ? undefined : ts.createSourceFile(file, content, version);
    };
    const program = ts.createProgram([resolve(directory, 'assert.ts')], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: file => file, getCurrentDirectory: () => client, getNewLine: () => '\n',
    }));
});
