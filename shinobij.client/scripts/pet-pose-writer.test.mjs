import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { petPoseMembership, petPoseManifestTs, syncPetPoseManifest } from './pet-pose-manifest.mjs';

const scripts = fileURLToPath(new URL('./', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const writers = ['finalize-pet-poses.mjs', 'finalize-evo-poses.mjs', 'slice-all-move-frames.mjs'];
const combat = ['idle', 'attack', 'hurt', 'cast'];
const run = ['run-a', 'run-b'];
const move = ['windup', 'lunge', 'impact', 'recover'];

function fixture(t) {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'ninjak-pose-writer-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        assert.ok(path.basename(root).startsWith('ninjak-pose-writer-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const poses = path.join(root, 'public', 'pet-poses');
    const stage = path.join(root, 'asset-gen-out', 'pet-poses-all');
    const sheets = path.join(root, 'asset-gen-out', 'pet-moveframes');
    for (const directory of [poses, stage, sheets, path.join(root, 'src', 'assets', 'coliseum')]) {
        fs.mkdirSync(directory, { recursive: true });
    }
    // Tiny placeholders certify writer control flow; no image decoder runs.
    for (const category of [...combat, ...run, ...move]) {
        fs.writeFileSync(path.join(poses, `existing-${category}.webp`), category);
    }
    syncPetPoseManifest(root);
    return { root, poses, stage, sheets };
}

async function executeWriter(writer, setup, argv, overrides = {}) {
    const source = fs.readFileSync(path.join(scripts, writer), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(setup.root, 'scripts', writer)).href));
    const execute = new AsyncFunction('fs', 'path', 'fileURLToPath', 'sharp', 'syncPetPoseManifest', 'execFileSync', 'process', 'console', source);
    const stopped = {};
    let exited = false;
    const fakeProcess = { argv: ['node', writer, ...argv], exit(code) { assert.equal(code, 0); exited = true; throw stopped; } };
    try {
        await execute(overrides.fs ?? fs, path, fileURLToPath, overrides.sharp,
            syncPetPoseManifest, overrides.execFileSync, fakeProcess,
            { log() {}, warn() {}, error() {} });
    } catch (error) {
        if (error !== stopped) throw error;
    }
    return exited;
}

for (const writer of writers) {
    test(`${writer} updates every export without dropping existing public frames`, async (t) => {
        const setup = fixture(t);
        const conversions = [];
        if (writer === 'slice-all-move-frames.mjs') {
            fs.writeFileSync(path.join(setup.sheets, 'evolved-moves.png'), 'sheet');
        } else {
            for (const category of [...combat, ...run]) {
                fs.writeFileSync(path.join(setup.stage, `evolved-${category}.webp`), category);
            }
        }
        const sharp = input => ({
            resize(width, height, options) {
                assert.deepEqual([width, height, options], [384, 384, { fit: 'inside' }]);
                return { webp(options) {
                    assert.deepEqual(options, { quality: 86 });
                    return { async toFile(output) { conversions.push(output); fs.copyFileSync(input, output); } };
                } };
            },
        });
        const execFileSync = (command, args, options) => {
            assert.equal(command, 'node');
            assert.equal(args[0], 'scripts/slice-move-frames.mjs');
            assert.equal(options.cwd, setup.root);
            const id = args[args.indexOf('--out-name') + 1];
            for (const category of move) {
                const output = path.join(setup.poses, `${id}-${category}.webp`);
                conversions.push(output);
                fs.writeFileSync(output, category);
            }
        };
        assert.equal(await executeWriter(writer, setup, [], { sharp, execFileSync }), false);
        assert.equal(conversions.length, writer === 'slice-all-move-frames.mjs' ? 4 : 6);
        const memberships = petPoseMembership(fs.readdirSync(setup.poses));
        assert.deepEqual(memberships, writer === 'slice-all-move-frames.mjs'
            ? { POSED_PET_IDS: ['existing'], POSED_MOVE_IDS: ['evolved', 'existing'], POSED_RUN_IDS: ['existing'] }
            : { POSED_PET_IDS: ['evolved', 'existing'], POSED_MOVE_IDS: ['existing'], POSED_RUN_IDS: ['evolved', 'existing'] });
        assert.equal(fs.readFileSync(path.join(setup.root, 'src/assets/coliseum/pet-poses-manifest.ts'), 'utf8'), petPoseManifestTs(memberships));
    });

    test(`${writer} metadata-only check exits before staging or artwork work`, async (t) => {
        const setup = fixture(t);
        const manifestPath = path.join(setup.root, 'src/assets/coliseum/pet-poses-manifest.ts');
        const before = fs.readFileSync(manifestPath);
        const fail = () => { throw new Error('Metadata-only check reached staging or artwork work'); };
        const guardedFs = { ...fs, mkdirSync: fail, readdirSync: fail, writeFileSync: fail };
        assert.equal(await executeWriter(writer, setup, ['--manifest-only', '--check'], {
            fs: guardedFs, sharp: fail, execFileSync: fail,
        }), true);
        assert.deepEqual(fs.readFileSync(manifestPath), before);
        assert.equal(fs.readdirSync(setup.stage).length, 0);
        assert.equal(fs.readdirSync(setup.sheets).length, 0);
    });
}
