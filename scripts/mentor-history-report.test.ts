import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMentorHistoryReport, runMentorHistoryReport, validateMentorHistorySnapshot } from './mentor-history-report.js';

const NOW = 1_700_000_010_000;
const CREATED = NOW - 100_000;
const AT = NOW - 10_000;
function receipt(milestones = ['academy'], pairingId = 'old-released-pair', appliedAt = AT) {
    const id = createHash('sha256').update(`clan-mentor-milestone/v1|${pairingId}|${milestones.join(',')}`).digest('hex').slice(0, 32);
    return { v: 1, role: 'student', settlementId: `mentor-${id}`, fingerprint: 'a'.repeat(64),
        senseiSlug: 'oldteacher', pairingId, milestones, appliedAt, ryo: milestones.length * 1_000 };
}
function save(student: string, receipts: unknown = [receipt()]) {
    return { key: `save:${student}`, value: { character: { createdAt: CREATED, mentorRewardReceipts: receipts } } };
}
function snapshot(rows: Array<{ key: string; value: unknown; expires_at?: string | null }> = []) {
    return { capturedAt: NOW, rows };
}
function deepFreeze(value: unknown) {
    if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
}

test('released pairs need no surviving mentor record when the current student receipt proves payment', () => {
    const report = buildMentorHistoryReport(snapshot([save('student')]), NOW);
    assert.deepEqual(report.proposedWrites.map(({ key, expected, add, next }) => ({ key, expected, add, next })), [
        { key: 'clan-mentor-paid:student', expected: null, add: { academy: AT }, next: { academy: AT } },
    ]);
    assert.equal(report.dryRun, true);
    assert.equal(report.summary.proposedMilestones, 1);
});

test('multiple releases/rejoins aggregate once per milestone and preserve existing flags', () => {
    const report = buildMentorHistoryReport(snapshot([
        save('student', [receipt(['academy'], 'pair-b', AT + 1), receipt(['academy', 'level20'], 'pair-a', AT)]),
        { key: 'clan-mentor-paid:student', value: { rankedWin: AT - 2, academy: AT - 3 } },
    ]), NOW);
    assert.deepEqual(report.proposedWrites[0].expected, { academy: AT - 3, rankedWin: AT - 2 });
    assert.deepEqual(report.proposedWrites[0].add, { level20: AT });
    assert.deepEqual(report.proposedWrites[0].next, { academy: AT - 3, level20: AT, rankedWin: AT - 2 });
    const replay = buildMentorHistoryReport(snapshot([
        save('student', [receipt(['academy', 'level20'])]),
        { key: 'clan-mentor-paid:student', value: report.proposedWrites[0].next },
    ]), NOW);
    assert.deepEqual(replay.proposedWrites, []);
});

test('legacy reservations, count-only audits, and settled logs never invent paid milestones', () => {
    const report = buildMentorHistoryReport(snapshot([
        { key: 'clan-mentor:oldteacher', value: { students: [{ studentSlug: 'student', claimed: { academy: AT } }],
            settledLog: [{ id: 'legacy', student: 'student', milestones: ['academy'], completedAt: AT }] } },
        { key: 'audit:clan-mentor:claim:1700000000000', value: { ts: AT, sensei: 'oldteacher', student: 'student', milestones: 2 } },
    ]), NOW);
    assert.deepEqual(report.proposedWrites, []);
    assert.ok(report.unresolved.some((item) => item.reason.includes('reservation')));
    assert.ok(report.unresolved.some((item) => item.reason.includes('no-current-account-receipt')));
    assert.ok(report.unresolved.some((item) => item.source.startsWith('audit:')));
});

test('unpaid students and missing history remain eligible without automatic denial', () => {
    const report = buildMentorHistoryReport(snapshot([
        { key: 'save:newstudent', value: { character: { createdAt: CREATED } } },
        { key: 'save:missingstudent', value: null },
        { key: 'save:missingcharacter', value: {} },
        { key: 'save:nullcharacter', value: { character: null } },
    ]), NOW);
    assert.deepEqual(report.proposedWrites, []);
    assert.ok(report.unresolved.some((item) => item.source.includes('missingstudent')));
    assert.ok(report.unresolved.some((item) => item.source.includes('missingcharacter')));
    assert.ok(report.unresolved.some((item) => item.source.includes('nullcharacter')));
    assert.ok(report.limitations.some((item) => item.includes('empty report does not establish')));
});

test('malformed existing history is reported without proposing its replacement', () => {
    const report = buildMentorHistoryReport(snapshot([
        save('broken'), save('valid'),
        { key: 'clan-mentor-paid:broken', value: { academy: 'unknown' } },
    ]), NOW);
    assert.deepEqual(report.proposedWrites.map((item) => item.studentSlug), ['valid']);
    assert.ok(report.unresolved.some((item) => item.source === 'clan-mentor-paid:broken'));
});

test('null paid row has the exact null comparison expected by a future CAS', () => {
    const report = buildMentorHistoryReport(snapshot([save('student'), { key: 'clan-mentor-paid:student', value: null }]), NOW);
    assert.equal(report.proposedWrites[0].expected, null);
});

test('valid existing flags with an active TTL are proposed unchanged for durable retention', () => {
    const expiresAt = new Date(NOW + 100_000).toISOString();
    const report = buildMentorHistoryReport(snapshot([
        { key: 'clan-mentor-paid:student', value: { academy: AT }, expires_at: expiresAt },
    ]), NOW);
    assert.equal(report.proposedWrites.length, 1);
    assert.deepEqual(report.proposedWrites[0], {
        key: 'clan-mentor-paid:student', studentSlug: 'student', expected: { academy: AT },
        expectedExpiresAt: expiresAt, removeExpiry: true, add: {}, next: { academy: AT }, evidence: [],
    });
    assert.equal(report.summary.proposedMilestones, 0);
    assert.equal(report.summary.proposedExpiryRemovals, 1);
    const rerun = buildMentorHistoryReport(snapshot([
        { key: 'clan-mentor-paid:student', value: { academy: AT }, expires_at: null },
    ]), NOW);
    assert.deepEqual(rerun.proposedWrites, []);
});

test('malformed and future student receipts produce no candidates', () => {
    const report = buildMentorHistoryReport(snapshot([
        save('malformed', { academy: AT }), save('future', [receipt(['academy'], 'future', NOW + 1)]),
    ]), NOW);
    assert.deepEqual(report.proposedWrites, []);
    assert.equal(report.unresolved.length, 2);
});

test('rows expired at snapshot capture are ignored, even if they held plausible evidence', () => {
    const report = buildMentorHistoryReport(snapshot([
        { ...save('expired'), expires_at: new Date(NOW).toISOString() },
        save('valid'), { key: 'clan-mentor-paid:valid', value: { academy: AT }, expires_at: new Date(NOW - 1).toISOString() },
    ]), NOW);
    assert.deepEqual(report.ignoredExpiredKeys, ['clan-mentor-paid:valid', 'save:expired']);
    assert.equal(report.proposedWrites[0].studentSlug, 'valid');
    assert.equal(report.proposedWrites[0].expected, null);
});

test('report is deterministic across row order and makes no input mutations', () => {
    const input = snapshot([save('zed'), save('alpha'), { key: 'clan-mentor-paid:zed', value: { academy: AT } }]);
    const before = JSON.stringify(input);
    deepFreeze(input);
    const first = buildMentorHistoryReport(input, NOW);
    const reversed = buildMentorHistoryReport({ ...input, rows: [...input.rows].reverse() }, NOW);
    assert.deepEqual(first, reversed);
    assert.equal(JSON.stringify(input), before);
});

test('input rejects duplicate keys, future captures, malformed expiry, and full saves without leaking values', () => {
    assert.throws(() => buildMentorHistoryReport(snapshot([save('student'), save('student')]), NOW), /duplicate/);
    assert.throws(() => buildMentorHistoryReport({ capturedAt: NOW + 1, rows: [] }, NOW), /non-future/);
    assert.throws(() => buildMentorHistoryReport(snapshot([{ ...save('student'), expires_at: 'yesterday' }]), NOW), /expires_at/);
    assert.throws(() => buildMentorHistoryReport(snapshot([{ ...save('student'), expires_at: '2023-02-30T00:00:00Z' }]), NOW), /expires_at/);
    assert.throws(() => buildMentorHistoryReport(snapshot([{ ...save('student'), expires_at: '2023-02-28T00:00:00' }]), NOW), /expires_at/);
    assert.throws(() => buildMentorHistoryReport(snapshot([{ key: 'save:student', value: { passwordHash: 'sensitive-fixture', character: {} } }]), NOW), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /only character/);
        assert.ok(!error.message.includes('sensitive-fixture'));
        return true;
    });
    assert.throws(() => validateMentorHistorySnapshot({ format: 'shinobix-kv-v2', base: { rows: [] } }, NOW), /sanitized/);
    assert.throws(() => buildMentorHistoryReport(snapshot([{ key: 'auth:student', value: {} }]), NOW), /unsupported row/);
});

test('CLI writes only an exclusive local report, preserves its input, and rejects apply flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mentor-history-report-'));
    try {
        const inputPath = join(dir, 'sanitized.json');
        const outputPath = join(dir, 'report.json');
        const input = `${JSON.stringify(snapshot([save('student')]))}\n`;
        await writeFile(inputPath, input);
        await runMentorHistoryReport(['--input', inputPath, '--output', outputPath]);
        const reportText = await readFile(outputPath, 'utf8');
        const report = JSON.parse(reportText);
        assert.equal(report.dryRun, true);
        assert.equal(report.proposedWrites[0].key, 'clan-mentor-paid:student');
        assert.equal(await readFile(inputPath, 'utf8'), input);
        assert.ok(!reportText.includes('fingerprint'));
        assert.ok(!reportText.includes('old-released-pair'));
        await assert.rejects(runMentorHistoryReport(['--input', inputPath, '--output', inputPath]), /different files/);
        await assert.rejects(runMentorHistoryReport(['--input', inputPath, '--output', outputPath]), /EEXIST/);
        await assert.rejects(runMentorHistoryReport(['--input', inputPath, '--output', join(dir, 'apply.json'), '--apply']), /Usage/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
