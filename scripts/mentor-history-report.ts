/** Offline only: no environment loader, KV client, network calls, or apply mode. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    mentorHistoryFromRecord,
    mentorHistoryFromStudentSave,
    parseMentorPaidRecord,
} from '../api/clan/_mentor-history.js';
import { MENTOR_MILESTONES } from '../api/clan/_mentor.js';

type Row = { key: string; value: unknown; expires_at?: string | null };
type Snapshot = { capturedAt: number; rows: Row[] };
type Evidence = { studentSlug: string; settlementId: string; milestones: string[]; at: number; source: string };
type Unresolved = { source: string; reason: string };
const SLUG = /^[a-z0-9_-]{1,32}$/;

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}
function rowKind(key: string): 'paid' | 'save' | 'mentor' | 'audit' | null {
    if (key.startsWith('clan-mentor-paid:') && SLUG.test(key.slice('clan-mentor-paid:'.length))) return 'paid';
    if (key.startsWith('save:') && SLUG.test(key.slice('save:'.length))) return 'save';
    if (key.startsWith('clan-mentor:') && SLUG.test(key.slice('clan-mentor:'.length))) return 'mentor';
    if (/^audit:clan-mentor:[a-zA-Z0-9:_-]+$/.test(key)) return 'audit';
    return null;
}
function validExpiry(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)
        || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Refuse full backups: project saves to the two named character fields first. */
export function validateMentorHistorySnapshot(raw: unknown, now = Date.now()): Snapshot {
    if (!object(raw) || !onlyKeys(raw, ['capturedAt', 'rows']) || !Array.isArray(raw.rows)
        || !Number.isSafeInteger(raw.capturedAt) || (raw.capturedAt as number) <= 0
        || (raw.capturedAt as number) > now) {
        throw new Error('Expected a sanitized mentor snapshot with a non-future capturedAt and rows array.');
    }
    const seen = new Set<string>();
    for (const row of raw.rows) {
        if (!object(row) || !onlyKeys(row, ['key', 'value', 'expires_at'])
            || typeof row.key !== 'string' || !Object.hasOwn(row, 'value') || !rowKind(row.key)) {
            throw new Error('Snapshot contains an unsupported row; only the documented mentor projection is accepted.');
        }
        if (seen.has(row.key)) throw new Error('Snapshot contains duplicate keys. Capture a consistent snapshot again.');
        seen.add(row.key);
        if (row.expires_at !== undefined && row.expires_at !== null
            && !validExpiry(row.expires_at)) {
            throw new Error('Snapshot contains an invalid expires_at.');
        }
        if (rowKind(row.key) === 'save' && row.value !== null) {
            if (!object(row.value) || !onlyKeys(row.value, ['character'])
                || (row.value.character !== undefined && row.value.character !== null
                    && (!object(row.value.character) || !onlyKeys(row.value.character, ['createdAt', 'mentorRewardReceipts'])))) {
                throw new Error('Save rows must contain only character.createdAt and character.mentorRewardReceipts.');
            }
        }
    }
    return raw as Snapshot;
}

function sortedPaid(paid: Record<string, number>): Record<string, number> {
    return Object.fromEntries(MENTOR_MILESTONES.filter((milestone) => Object.hasOwn(paid, milestone))
        .map((milestone) => [milestone, paid[milestone]]));
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** No source object is mutated. Output contains only payment fields and evidence references. */
export function buildMentorHistoryReport(raw: unknown, now = Date.now()) {
    const snapshot = validateMentorHistorySnapshot(raw, now);
    const expired = snapshot.rows.filter((row) => row.expires_at != null && Date.parse(row.expires_at) <= snapshot.capturedAt);
    const active = snapshot.rows.filter((row) => row.expires_at == null || Date.parse(row.expires_at) > snapshot.capturedAt)
        .slice().sort((a, b) => compare(a.key, b.key));
    const saves = new Map(active.filter((row) => rowKind(row.key) === 'save').map((row) => [row.key.slice(5), row.value]));
    const existing = new Map<string, Record<string, number>>();
    const existingExpected = new Map<string, Record<string, number> | null>();
    const existingExpiry = new Map<string, string | null>();
    const malformedPaid = new Set<string>();
    const unresolved: Unresolved[] = [];
    const evidence: Evidence[] = [];
    for (const row of active) {
        const kind = rowKind(row.key);
        if (kind === 'paid') {
            const slug = row.key.slice('clan-mentor-paid:'.length);
            try {
                const paid = parseMentorPaidRecord(row.value);
                existing.set(slug, paid);
                existingExpected.set(slug, row.value === null ? null : sortedPaid(paid));
                existingExpiry.set(slug, row.expires_at ?? null);
            }
            catch {
                malformedPaid.add(slug);
                unresolved.push({ source: row.key, reason: 'Existing ever-paid record is malformed; no automatic write is proposed for this student.' });
            }
        } else if (kind === 'save' || kind === 'mentor') {
            const result = kind === 'save'
                ? mentorHistoryFromStudentSave(row.key.slice(5), row.value, snapshot.capturedAt)
                : mentorHistoryFromRecord(row.key.slice('clan-mentor:'.length), row.value, saves, snapshot.capturedAt);
            evidence.push(...result.evidence.map((item) => ({
                studentSlug: item.studentSlug, settlementId: item.settlementId, milestones: [...item.milestones], at: item.at, source: item.source,
            })));
            unresolved.push(...result.unresolved.map((item) => ({ source: item.source, reason: item.reason })));
        } else if (kind === 'audit') {
            unresolved.push({ source: row.key, reason: 'Audit alone lacks a current-account receipt anchor; legacy claim counts also omit named milestones and may precede complete payouts.' });
        }
    }

    const uniqueEvidence = [...new Map(evidence.map((item) => [JSON.stringify(item), item])).values()]
        .sort((a, b) => compare(a.studentSlug, b.studentSlug) || a.at - b.at || compare(a.source, b.source)
            || compare(a.milestones.join(','), b.milestones.join(',')));
    const expiringStudents = [...existing].filter(([slug, paid]) => existingExpiry.get(slug) != null && Object.keys(paid).length > 0)
        .map(([slug]) => slug);
    const students = [...new Set([...uniqueEvidence.map((item) => item.studentSlug), ...expiringStudents])].sort(compare);
    const proposedWrites = students.flatMap((studentSlug) => {
        if (malformedPaid.has(studentSlug)) return [];
        const before = existing.get(studentSlug);
        const add: Record<string, number> = {};
        const studentEvidence = uniqueEvidence.filter((item) => item.studentSlug === studentSlug);
        for (const item of studentEvidence) {
            for (const milestone of item.milestones) {
                if (!Object.hasOwn(before ?? {}, milestone) && (!add[milestone] || item.at < add[milestone])) add[milestone] = item.at;
            }
        }
        const removeExpiry = existingExpiry.get(studentSlug) != null;
        if (Object.keys(add).length === 0 && !removeExpiry) return [];
        return [{ key: `clan-mentor-paid:${studentSlug}`, studentSlug, expected: existingExpected.get(studentSlug) ?? null,
            expectedExpiresAt: existingExpiry.get(studentSlug) ?? null, removeExpiry,
            add: sortedPaid(add), next: sortedPaid({ ...before, ...add }), evidence: studentEvidence }];
    });
    const uniqueUnresolved = [...new Map(unresolved.map((item) => [JSON.stringify(item), item])).values()]
        .sort((a, b) => compare(a.source, b.source) || compare(a.reason, b.reason));
    return {
        format: 'shinobix-mentor-history-report/v1', dryRun: true, capturedAt: snapshot.capturedAt,
        summary: { snapshotRows: snapshot.rows.length, activeRows: active.length, ignoredExpiredRows: expired.length,
            validatedEvidence: uniqueEvidence.length, proposedKeys: proposedWrites.length,
            proposedMilestones: proposedWrites.reduce((sum, item) => sum + Object.keys(item.add).length, 0),
            proposedExpiryRemovals: proposedWrites.filter((item) => item.removeExpiry).length,
            existingPaidKeys: existing.size, unresolved: uniqueUnresolved.length },
        proposedWrites,
        existingPaidRecords: [...existing].sort(([a], [b]) => compare(a, b)).map(([studentSlug, paid]) => ({
            key: `clan-mentor-paid:${studentSlug}`, paid: sortedPaid(paid), expiresAt: existingExpiry.get(studentSlug) ?? null,
        })),
        unresolved: uniqueUnresolved,
        ignoredExpiredKeys: expired.map((row) => row.key).sort(compare),
        limitations: [
            'Only validated co-written student receipts anchored in the current student save support automatic candidates.',
            'Missing, expired, overwritten, or compacted history can hide former pairs. An empty report does not establish that no replay exposure exists.',
            'Legacy claimed maps, claim counts, assignment/release audits, and settledLog alone cannot prove both named payment and current account identity.',
            'This report makes no reward, save, KV, or production changes and has no apply mode. Proposed timestamps preserve existing flags and add only validated missing milestones.',
            'Expiring valid canonical flags are proposed unchanged with removeExpiry=true, preventing their existing payment history from expiring; this requires the same explicit approval as additions.',
            'Before any separately approved application, pause all mentor writers including recovery and preserve evidence before compaction; revalidate current account identity, evidence, and exact expected record with compare-and-set. Resume owed settlements through existing recovery after preserving the approved history.',
        ],
    };
}

/** Local-file entry point. Only the report is written, exclusively; input cannot be overwritten. */
export async function runMentorHistoryReport(argv: string[]): Promise<void> {
    if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output' || !argv[1] || !argv[3]) {
        throw new Error('Usage: node --import tsx scripts/mentor-history-report.ts --input sanitized-snapshot.json --output report.json (offline dry-run only)');
    }
    const input = resolve(argv[1]);
    const output = resolve(argv[3]);
    if (input.toLowerCase() === output.toLowerCase()) throw new Error('Input and output must be different files.');
    let raw: unknown;
    try { raw = JSON.parse(await readFile(input, 'utf8')); }
    catch { throw new Error('Could not read a valid JSON input snapshot.'); }
    const report = buildMentorHistoryReport(raw);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

if (typeof require !== 'undefined' && require.main === module) {
    runMentorHistoryReport(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : 'Offline mentor history report failed.');
        process.exitCode = 1;
    });
}
