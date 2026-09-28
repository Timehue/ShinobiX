import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    auditAllContent,
    auditItems,
    auditJutsu,
    auditPets,
    auditWandererVoices,
    diffAgainstBaseline,
    publicAssetExists,
    readBaseline,
} from './content-completeness.mts';

const findings = auditAllContent();

test('shipped content has no completeness errors', () => {
    const errors = findings.filter((f) => f.severity === 'error').map((f) => f.message);
    assert.deepEqual(errors, []);
});

test('no new content gaps appear, and fixed gaps leave the baseline', () => {
    const { added, fixed } = diffAgainstBaseline(findings, readBaseline());
    assert.deepEqual(added, [], 'New unfinished content. Finish it, or run `node --import tsx scripts/content-completeness.mts --write-baseline` if it is intentionally shipping unfinished.');
    assert.deepEqual(fixed, [], 'These gaps are fixed. Remove them from scripts/content-completeness-baseline.json (or rerun with --write-baseline).');
});

function fixturePublicDir(files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'completeness-'));
    for (const file of files) {
        const full = join(dir, file);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, '');
    }
    return dir;
}

test('art paths are checked against the public folder; data URIs and remote URLs are skipped', () => {
    const dir = fixturePublicDir(['items/a.webp']);
    assert.equal(publicAssetExists('/items/a.webp', dir), true);
    assert.equal(publicAssetExists('/items/missing.webp', dir), false);
    assert.equal(publicAssetExists('/items/a.webp?v=2', dir), true);
    assert.equal(publicAssetExists('data:image/png;base64,AAAA', dir), true);
    assert.equal(publicAssetExists('https://cdn.example/x.webp', dir), true);
});

test('jutsu audit flags blank battle text, duplicate ids and missing art files', () => {
    const dir = fixturePublicDir([]);
    const keys = auditJutsu([
        { id: 'a', name: 'Alpha', battleDescription: '%user strikes %target hard.', description: 'A clean strike.' },
        { id: 'a', name: 'Alpha Again', battleDescription: ' ', description: 'Another strike.', image: '/jutsu/a.webp' },
    ], 'jutsu', dir).map((f) => `${f.severity}:${f.key}`);
    assert.ok(keys.includes('error:jutsu:a:duplicate-id'));
    assert.ok(keys.includes('error:jutsu:a:missing-battleDescription'));
    assert.ok(keys.includes('error:jutsu:a:art-file-missing'));
});

test('items without art and pets without an idle pose are gaps, not errors', () => {
    const dir = fixturePublicDir(['pet-poses/p1-idle.webp']);
    const items = auditItems([{ id: 'i', name: 'Iron Band', description: 'A plain iron band.' }], 'item', dir);
    assert.deepEqual(items.map((f) => `${f.severity}:${f.key}`), ['gap:item:i:no-art']);
    const pets = auditPets([
        { id: 'p1', name: 'Fox', description: 'A quick red fox.' },
        { id: 'p2', name: 'Owl', description: 'A patient night owl.' },
    ], dir);
    assert.deepEqual(pets.map((f) => `${f.severity}:${f.key}`), ['gap:pet:p2:no-idle-pose']);
});

test('a borrowed pose sheet counts as battle art, but only if it exists', () => {
    const dir = fixturePublicDir(['pet-poses/donor-idle.webp']);
    const pets = [{ id: 'bred', name: 'Bred One', description: 'Known only from breeding records.' }];
    assert.deepEqual(auditPets(pets, dir, { bred: 'donor' }), []);
    assert.deepEqual(auditPets(pets, dir, { bred: 'missing-donor' }).map((f) => f.key), ['pet:bred:no-idle-pose']);
    assert.deepEqual(auditPets(pets, dir, {}).map((f) => f.key), ['pet:bred:no-idle-pose']);
});

test('short names are fine; short descriptions are not', () => {
    const dir = fixturePublicDir(['pet-poses/p-idle.webp']);
    const keys = auditPets([{ id: 'p', name: 'Fox', description: 'Fox.' }], dir).map((f) => f.key);
    assert.deepEqual(keys, ['pet:p:short-description']);
});

test('wanderer voices must have names and real greetings', () => {
    const keys = auditWandererVoices({
        ok: { names: ['Kano'], greetings: ['This road is mine, traveler.'] },
        bad: { names: [' '], greetings: [] },
    }).map((f) => f.key);
    assert.deepEqual(keys.sort(), ['wanderer:bad:blank-name', 'wanderer:bad:no-greeting']);
});

test('baseline diff reports both new and fixed gaps', () => {
    const diff = diffAgainstBaseline(
        [
            { severity: 'gap', key: 'item:new:no-art', message: '' },
            { severity: 'gap', key: 'item:still:no-art', message: '' },
            { severity: 'error', key: 'item:err:missing-name', message: '' },
        ],
        ['item:still:no-art', 'item:gone:no-art'],
    );
    assert.deepEqual(diff, { added: ['item:new:no-art'], fixed: ['item:gone:no-art'] });
});
