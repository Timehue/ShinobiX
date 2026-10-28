import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ADDED_FILES, OVERRIDE_LABEL, evidenceGrowth, flattenPages } from './check-evidence-growth.mjs';

const file = (filename, status = 'added') => ({ filename, status });

test('code and small docs changes pass', () => {
    const result = evidenceGrowth([file('api/pet/gauntlet.ts', 'modified'), file('docs/CI.md', 'modified'), file('docs/archive/x.png')]);
    assert.deepEqual(result, { grown: 0, heavy: 0, failures: [], overridden: false });
});

test('a new screenshot under docs/screenshots fails', () => {
    const result = evidenceGrowth([file('docs/screenshots/pet-run/front.webp')]);
    assert.equal(result.heavy, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.overridden, false);
});

test('every watched folder counts, and a changed binary counts as growth', () => {
    for (const path of ['docs/screenshots/a.png', 'docs/evidence/b.mp4', 'docs/audits/c.jpg']) {
        assert.equal(evidenceGrowth([file(path, 'modified')]).heavy, 1, path);
    }
});

test('many small text files trip the file-count limit', () => {
    const files = Array.from({ length: MAX_ADDED_FILES + 1 }, (_, i) => file(`docs/audits/run-${i}.json`));
    const result = evidenceGrowth(files);
    assert.equal(result.heavy, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(evidenceGrowth(files.slice(0, MAX_ADDED_FILES)).failures.length, 0);
});

test('removing or renaming evidence is never growth', () => {
    const files = [file('docs/screenshots/a.png', 'removed'), file('docs/screenshots/b.png', 'renamed')];
    assert.equal(evidenceGrowth(files).failures.length, 0);
});

test('the allow-evidence label overrides a failure but still reports it', () => {
    const result = evidenceGrowth([file('docs/screenshots/a.png')], ['bug', OVERRIDE_LABEL]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.overridden, true);
    assert.equal(evidenceGrowth([file('docs/audits/ok.json')], [OVERRIDE_LABEL]).overridden, false);
});

test('paginated gh output is flattened, a plain list is left alone', () => {
    assert.deepEqual(flattenPages([[file('a')], [file('b')]]).map(f => f.filename), ['a', 'b']);
    assert.deepEqual(flattenPages([file('a')]).map(f => f.filename), ['a']);
});
