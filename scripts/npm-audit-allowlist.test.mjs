import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blockingAdvisories, uncovered } from './npm-audit-allowlist.mjs';

const advisory = (id, severity = 'high', name = 'picomatch') => ({ source: 1, name, title: `${id} title`, url: `https://github.com/advisories/${id}`, severity });
const report = (...vias) => ({ vulnerabilities: {
    picomatch: { name: 'picomatch', via: vias },
    vite: { name: 'vite', via: ['picomatch'] }, // derived entries name the package, not an advisory
} });
const allowlist = { advisories: [{ id: 'GHSA-fc5q-39xc-vjpf', reason: 'build tooling only', expires: '2026-12-15' }] };

test('an allowlisted, unexpired advisory passes and nothing else is excused', () => {
    assert.deepEqual(uncovered(blockingAdvisories(report(advisory('GHSA-fc5q-39xc-vjpf'))), allowlist, '2026-11-17'), []);
    const left = uncovered(blockingAdvisories(report(advisory('GHSA-fc5q-39xc-vjpf'), advisory('GHSA-aaaa-bbbb-cccc', 'critical'))), allowlist, '2026-11-17');
    assert.deepEqual(left.map(a => a.id), ['GHSA-aaaa-bbbb-cccc']);
});

test('the allowance lapses after its date, needs a reason, and moderate advisories never block', () => {
    assert.equal(uncovered(blockingAdvisories(report(advisory('GHSA-fc5q-39xc-vjpf'))), allowlist, '2026-12-16').length, 1);
    assert.equal(uncovered(blockingAdvisories(report(advisory('GHSA-fc5q-39xc-vjpf'))), { advisories: [{ id: 'GHSA-fc5q-39xc-vjpf', expires: '2026-12-15' }] }, '2026-11-17').length, 1);
    assert.deepEqual(blockingAdvisories(report(advisory('GHSA-zzzz-zzzz-zzzz', 'moderate'))), []);
});

test('an advisory without a GHSA id is never excused', () => {
    const odd = { source: 7, name: 'x', title: 'no url', severity: 'high' };
    assert.equal(uncovered(blockingAdvisories(report(odd)), allowlist, '2026-11-17').length, 1);
});

test('every allowlist entry is justified and expires within 60 days of being written', () => {
    const file = JSON.parse(readFileSync(new URL('./npm-audit-allowlist.json', import.meta.url), 'utf8'));
    for (const entry of file.advisories) {
        assert.match(entry.id, /^GHSA-/);
        assert.ok(entry.reason.length > 40, `${entry.id} needs a real reason`);
        assert.match(entry.expires, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(entry.expires <= '2027-01-16', `${entry.id} must expire soon; renew it deliberately if still needed`);
    }
});
