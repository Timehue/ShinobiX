import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/nightly-backup.yml', import.meta.url), 'utf8');
const step = (name) => workflow.split(/^ {6}- /m).find((block) => block.includes(name)) ?? '';

test('the nightly backup can never fail a check suite Railway waits on', () => {
    assert.match(step('name: Export'), /continue-on-error: true/, 'the export may fail without failing the job');
    assert.match(step('actions/upload-artifact'), /continue-on-error: true/);
    assert.match(step('name: Report a failed backup'), /gh issue create/, 'a failure is reported as an issue instead');
    assert.doesNotMatch(workflow, /^\s+on:\s*\n\s+(push|pull_request|workflow_run|deployment_status):/m, 'only schedule and manual runs');
});

test('it is opt-in, encrypted, and runs the runbook command on the pinned Node', () => {
    assert.match(step('name: Check configuration'), /BACKUP_DATABASE_URL and KV_BACKUP_PASSPHRASE/);
    assert.match(step('name: Export'), /node scripts\/kv-backup\.mjs export --out/);
    assert.match(step('name: Export'), /SJKVENC/, 'an unencrypted backup is never uploaded');
    assert.match(workflow, /node-version-file: \.nvmrc/);
    assert.match(workflow, /retention-days: \d+/);
    assert.ok(Buffer.from([0x53, 0x4a, 0x4b, 0x56, 0x45, 0x4e, 0x43]).toString() === 'SJKVENC'
        && readFileSync(new URL('./kv-backup.mjs', import.meta.url), 'utf8').includes('0x53, 0x4a, 0x4b, 0x56, 0x45, 0x4e, 0x43, 0x01'),
    'the workflow checks the same header the script writes');
});
