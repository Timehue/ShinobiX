import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FindingReport,
    canonicalJson,
    definitionsEqual,
    scanScope,
    strictLedgerCompatibilityReasons,
    subjectLabel,
} from './data-integrity-scan-core.mjs';

test('finding totals remain exact after samples hit their privacy/size cap', () => {
    const report = new FindingReport(['forged'], 2);
    for (let index = 0; index < 501; index += 1) report.add('forged', { index });
    assert.equal(report.counts.forged, 501);
    assert.equal(report.samples.forged.length, 2);
    assert.equal(report.total(), 501);
});

test('canonical comparison ignores object key order but not definition changes', () => {
    const left = { id: 'named-weapon-a', effects: { attack: 5, speed: 2 }, tags: ['a', 'b'] };
    const reordered = { tags: ['a', 'b'], effects: { speed: 2, attack: 5 }, id: 'named-weapon-a' };
    const changed = { ...reordered, effects: { speed: 2, attack: 6 } };
    assert.equal(definitionsEqual(left, reordered), true);
    assert.equal(definitionsEqual(left, changed), false);
    assert.equal(canonicalJson(left), canonicalJson(reordered));
});

test('subject labels are stable pseudonyms unless identifiers are explicitly requested', () => {
    const pseudonym = subjectLabel('Rill');
    assert.match(pseudonym, /^player-[0-9a-f]{12}$/);
    assert.equal(subjectLabel('rill'), pseudonym);
    assert.equal(subjectLabel('Rill', true), 'Rill');
});

test('limited scans are explicitly incomplete and cannot certify the full target', () => {
    assert.deepEqual(scanScope(500, 25), {
        available: 500,
        limit: 25,
        selected: 25,
        completeScan: false,
    });
    assert.equal(scanScope(500, 0).completeScan, true);
    assert.equal(scanScope(12, 25).completeScan, true);
});

test('strict-ledger candidate scan names incomplete stat ledgers and legacy versions', () => {
    assert.deepEqual(
        strictLedgerCompatibilityReasons({ character: { stats: { strength: 4 } } }, ['strength', 'speed']),
        [
            { reason: 'missing-stat-ledger-fields', fields: ['speed'] },
            { reason: 'missing-save-version' },
        ],
    );
    assert.deepEqual(
        strictLedgerCompatibilityReasons({ _saveVersion: 3, character: { stats: { strength: 4, speed: 2 } } }, ['strength', 'speed']),
        [],
    );
});
