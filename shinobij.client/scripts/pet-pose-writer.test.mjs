import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scripts = fileURLToPath(new URL('./', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const writer = 'finalize-pet-poses.mjs';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'ninjak-pose-writer-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        assert.ok(path.basename(root).startsWith('ninjak-pose-writer-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const poses = path.join(root, 'public', 'pet-poses');
    const stage = path.join(root, 'asset-gen-out', 'pet-poses-all');
    for (const directory of [poses, stage]) fs.mkdirSync(directory, { recursive: true });
    // Tiny placeholders certify writer control flow; no image decoder runs.
    fs.writeFileSync(path.join(poses, 'existing-idle.webp'), 'idle');
    fs.writeFileSync(path.join(poses, 'standard-3-windup.webp'), 'reviewed card frame');
    return { root, poses, stage };
}

async function executeWriter(setup, sharp) {
    const source = fs.readFileSync(path.join(scripts, writer), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(setup.root, 'scripts', writer)).href));
    const execute = new AsyncFunction('fs', 'path', 'fileURLToPath', 'sharp', 'console', source);
    await execute(fs, path, fileURLToPath, sharp, { log() {}, warn() {}, error() {} });
}

test(`${writer} publishes only staged idle poses and keeps every existing public frame`, async (t) => {
    const setup = fixture(t);
    for (const category of ['idle', 'attack', 'hurt', 'cast', 'run-a', 'run-b']) {
        fs.writeFileSync(path.join(setup.stage, `evolved-${category}.webp`), category);
    }
    const conversions = [];
    const sharp = input => ({
        resize(width, height, options) {
            assert.deepEqual([width, height, options], [384, 384, { fit: 'inside' }]);
            return { webp(options) {
                assert.deepEqual(options, { quality: 86 });
                return { async toFile(output) { conversions.push(path.basename(output)); fs.copyFileSync(input, output); } };
            } };
        },
    });
    await executeWriter(setup, sharp);
    assert.deepEqual(conversions, ['evolved-idle.webp']);
    assert.deepEqual(fs.readdirSync(setup.poses).sort(), ['evolved-idle.webp', 'existing-idle.webp', 'standard-3-windup.webp']);
    assert.equal(fs.existsSync(path.join(setup.root, 'src')), false, 'no generated manifest is written');
});
