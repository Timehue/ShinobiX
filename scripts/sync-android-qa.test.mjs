import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

// `bubblewrap build` compares a SHA-1 of twa-manifest.json with
// manifest-checksum.txt. On a mismatch it offers to regenerate the Android
// project, with Yes as the default, and regeneration rewrites app/build.gradle,
// the manifest and LauncherActivity, discarding everything the sync applied.
// On 2026-09-16 a sync left the checksum stale, so the next signed build would
// have shipped without the Play update/review sources or the pinned
// androidbrowserhelper 2.7.3. Regeneration also restores Bubblewrap's 2.6.2
// pin, so the sync has to put 2.7.3 back.

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts/sync-android-qa.mjs');

// Same computation as Bubblewrap 1.25.0's computeChecksum
// (@bubblewrap/cli dist/lib/cmds/shared.js): SHA-1 hex of the raw file bytes.
const bubblewrapChecksum = bytes => createHash('sha1').update(bytes).digest('hex');

async function fakeBubblewrapProject({ helperVersion = '2.6.2' } = {}) {
    const project = await mkdtemp(join(tmpdir(), 'shinobi-twa-sync-'));
    const manifest = { packageId: 'com.shinobijourney.app', appVersionCode: 3, appVersionName: '3', appVersion: '3' };
    const manifestText = JSON.stringify(manifest, null, 2);
    await writeFile(join(project, 'twa-manifest.json'), manifestText);
    await writeFile(join(project, 'manifest-checksum.txt'), bubblewrapChecksum(Buffer.from(manifestText)));
    await mkdir(join(project, 'app/src/main'), { recursive: true });
    await writeFile(join(project, 'app/build.gradle'),
        'android {\n    defaultConfig {\n        versionCode 3\n        versionName "3"\n    }\n}\ndependencies {\n'
        + `        implementation 'com.google.androidbrowserhelper:billing:1.2.0'\n`
        + `        implementation 'com.google.androidbrowserhelper:androidbrowserhelper:${helperVersion}'\n}\n`);
    await writeFile(join(project, 'app/src/main/AndroidManifest.xml'), '<manifest>\n    <application>\n    </application>\n</manifest>\n');
    return project;
}

async function assertBubblewrapSeesNoChange(project) {
    const manifest = await readFile(join(project, 'twa-manifest.json'));
    const checksum = await readFile(join(project, 'manifest-checksum.txt'), 'utf8');
    assert.equal(checksum, bubblewrapChecksum(manifest),
        'manifest-checksum.txt must match twa-manifest.json, or `bubblewrap build` regenerates the project');
    return JSON.parse(manifest.toString('utf8'));
}

describe('sync-android-qa', () => {
    it('leaves the Bubblewrap checksum matching the manifest it rewrites', async () => {
        const project = await fakeBubblewrapProject();
        try {
            execFileSync(process.execPath, [script, project], { stdio: 'pipe' });
            const manifest = await assertBubblewrapSeesNoChange(project);
            assert.equal(manifest.appVersionCode, 4);

            // A repeat sync (the README's "reapply" path) must stay consistent too.
            execFileSync(process.execPath, [script, project], { stdio: 'pipe' });
            assert.equal((await assertBubblewrapSeesNoChange(project)).appVersionCode, 4);
        } finally {
            await rm(project, { recursive: true, force: true });
        }
    });

    it('restores androidbrowserhelper 2.7.3 after a Bubblewrap regeneration, and never downgrades', async () => {
        for (const [before, after] of [['2.6.2', '2.7.3'], ['2.7.0-alpha02', '2.7.3'], ['2.7.3', '2.7.3'], ['2.8.0', '2.8.0']]) {
            const project = await fakeBubblewrapProject({ helperVersion: before });
            try {
                execFileSync(process.execPath, [script, project], { stdio: 'pipe' });
                const gradle = await readFile(join(project, 'app/build.gradle'), 'utf8');
                assert.match(gradle, new RegExp(`androidbrowserhelper:androidbrowserhelper:${after.replace(/\./g, '\\.')}'`), `${before} should become ${after}`);
                assert.match(gradle, /androidbrowserhelper:billing:1\.2\.0'/, 'the billing module is a different artifact and must be left alone');
            } finally {
                await rm(project, { recursive: true, force: true });
            }
        }
    });
});
