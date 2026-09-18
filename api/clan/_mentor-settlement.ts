/*
 * Crash-recoverable settlement for clan mentor milestone rewards
 * (api/clan/mentor.ts). Design notes: docs/mentor-milestone-settlement.md.
 *
 * A claim pays two players: the sensei (Honor Seals, clanEventContrib and one
 * full-batch Clan Points request) and the student (ryo). Those are two saves
 * plus the mentor record, so no single write can cover them. The previous
 * handler marked the milestones claimed first and then credited each save in
 * turn, so a failure part-way through lost whatever had not been written yet.
 *
 * The sequence here:
 *   1. ADMIT   — freeze the batch (milestones, amounts, recipient identities)
 *                as a pending settlement inside `clan-mentor:<sensei>`, in the
 *                same exact-CAS write that reserves the milestones. A pointer
 *                key published BEFORE that write lets the server find it again.
 *   2. PAY     — one mutatePlayerSave per recipient. The economic change and
 *                a receipt naming the settlement land in the same save write.
 *                A receipt already present means that side is paid.
 *   3. FINALIZE — once both receipts exist, remove the settlement from the
 *                mentor record (exact CAS) and record the milestones as
 *                settled by it.
 *
 * Any step can be repeated. A payer reads the save, THEN re-reads the mentor
 * record and pays only while the settlement is still pending there, and the
 * save write is an exact CAS against what it read. A receipt is only dropped
 * from a save after its settlement has left the mentor record, and dropping
 * it is itself a save write, so a writer that paused past its lock lease
 * cannot pay a settlement a second time.
 */
import { createHash, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { awardClanPoints } from '../_clan-points.js';
import { settlementFingerprint } from '../_durable-settlement.js';
import { mutatePlayerSave, type PlayerSaveRecord } from '../save/_mutate-player-save.js';
import {
    MENTOR_MILESTONES,
    claimableMilestones,
    mentorClanPointsRequest,
    mentorPayout,
    type MentorMilestone,
} from './_mentor.js';

export const MENTOR_RECEIPTS_FIELD = 'mentorRewardReceipts';
/** Hard ceiling on unfinalized/uncompacted receipts in one save. Never evicted — exceeding it is an exception. */
export const MENTOR_RECEIPT_CAPACITY = 64;
/** Recent finalized batches kept on the mentor record for diagnostics only. */
export const MENTOR_SETTLED_LOG_LIMIT = 20;
export const MENTOR_RECOVERY_STATUS_KEY = 'clan-mentor-settlement:status';
const POINTER_PREFIX = 'clan-mentor-pending:';
const PROTOCOL = 'clan-mentor-milestone/v1';

const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;
const EXCEPTION_BASE_MS = 60 * 60_000;
const EXCEPTION_MAX_MS = 24 * 60 * 60_000;

export function mentorRecordKey(senseiSlug: string): string { return `clan-mentor:${senseiSlug}`; }
export function mentorStudentMarkerKey(studentSlug: string): string { return `clan-mentor-of:${studentSlug}`; }
export function mentorPendingPointerKey(senseiSlug: string): string { return `${POINTER_PREFIX}${senseiSlug}`; }

// ── Types ────────────────────────────────────────────────────────────────────

export type MentorStudentEntry = {
    studentSlug: string;
    studentName: string;
    startedAt: number;
    /** milestone → timestamp. Reserved at admission; legacy entries carry only this. */
    claimed: Record<string, number>;
    /** Durable server-owned pairing identity. New pairings get one at assignment; legacy ones are backfilled once by CAS. */
    pairingId?: string;
    /** milestone → settlement id. Present only for milestones this protocol verified as paid to both players. */
    settledBy?: Record<string, string>;
};

export type MentorSettlementStep = 'teacher' | 'student' | 'finalize';
export type MentorExceptionReason =
    | 'recipient-missing'
    | 'identity-mismatch'
    | 'receipts-malformed'
    | 'receipt-conflict'
    | 'receipt-capacity';

export type MentorSettlementTerms = {
    id: string;
    pairingId: string;
    senseiSlug: string;
    studentSlug: string;
    studentName: string;
    milestones: MentorMilestone[];
    teacher: { createdAt: number | null; seals: number; contrib: number; clanPoints: number };
    student: { createdAt: number | null; ryo: number };
    /** Server-read student progress that made the milestones eligible. */
    evidence: { onboardingStep: string | null; level: number; rankedWins: number };
    admittedAt: number;
};

export type MentorSettlement = MentorSettlementTerms & {
    v: 1;
    fingerprint: string;
    attempts: number;
    nextAttemptAt: number;
    lastAttemptAt?: number;
    step?: MentorSettlementStep;
    lastError?: string;
    exception?: MentorExceptionReason;
};

export type MentorRecord = {
    students: MentorStudentEntry[];
    settlements: MentorSettlement[];
};

export type MentorClanPointsOutcome = { requested: number; awarded: number; weekKey: string; reason: string | null };

export type MentorRewardReceipt = {
    v: 1;
    settlementId: string;
    role: 'teacher' | 'student';
    fingerprint: string;
    senseiSlug: string;
    pairingId: string;
    milestones: string[];
    appliedAt: number;
    seals?: number;
    contrib?: number;
    clanPoints?: MentorClanPointsOutcome;
    ryo?: number;
};

export class MentorRecordError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MentorRecordError';
    }
}

// ── Identity, parsing, validation ────────────────────────────────────────────

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isObject(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isCount(v: unknown): v is number { return Number.isSafeInteger(v) && (v as number) >= 0; }
function errorText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 200); }

/** The account's immutable creation stamp — the stable identity behind a reusable name. */
export function accountCreatedAt(character: Record<string, unknown> | null | undefined): number | null {
    const n = Number(character?.createdAt);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export function mentorSettlementId(pairingId: string, milestones: readonly string[]): string {
    const digest = createHash('sha256').update(`${PROTOCOL}|${pairingId}|${milestones.join(',')}`).digest('hex');
    return `mentor-${digest.slice(0, 32)}`;
}

/** Flat, key-sorted fingerprint of every sealed term (Postgres jsonb does not keep nested key order). */
export function mentorTermsFingerprint(t: MentorSettlementTerms): string {
    return settlementFingerprint({
        protocol: PROTOCOL,
        id: t.id,
        pairingId: t.pairingId,
        senseiSlug: t.senseiSlug,
        studentSlug: t.studentSlug,
        studentName: t.studentName,
        milestones: t.milestones.join(','),
        teacherCreatedAt: t.teacher.createdAt,
        teacherSeals: t.teacher.seals,
        teacherContrib: t.teacher.contrib,
        teacherClanPoints: t.teacher.clanPoints,
        studentCreatedAt: t.student.createdAt,
        studentRyo: t.student.ryo,
        evidenceOnboardingStep: t.evidence.onboardingStep,
        evidenceLevel: t.evidence.level,
        evidenceRankedWins: t.evidence.rankedWins,
        admittedAt: t.admittedAt,
    });
}

const EXCEPTIONS = new Set<MentorExceptionReason>(['recipient-missing', 'identity-mismatch', 'receipts-malformed', 'receipt-conflict', 'receipt-capacity']);
const STEPS = new Set<MentorSettlementStep>(['teacher', 'student', 'finalize']);

function nullableStamp(v: unknown): number | null {
    if (v === null) return null;
    return Number.isFinite(v) && (v as number) > 0 ? v as number : NaN;
}

function parseSettlement(raw: unknown): MentorSettlement {
    const bad = (): never => { throw new MentorRecordError('Mentor settlement record is malformed.'); };
    if (!isObject(raw) || raw.v !== 1) return bad();
    const s = raw as Record<string, unknown>;
    const teacher = isObject(s.teacher) ? s.teacher : bad();
    const student = isObject(s.student) ? s.student : bad();
    const evidence = isObject(s.evidence) ? s.evidence : bad();
    const milestones = Array.isArray(s.milestones) ? s.milestones : bad();
    if (!milestones.length || milestones.some((m, i) => !MENTOR_MILESTONES.includes(m as MentorMilestone) || milestones.indexOf(m) !== i)) bad();
    for (const text of [s.id, s.pairingId, s.senseiSlug, s.studentSlug, s.studentName, s.fingerprint]) {
        if (typeof text !== 'string' || !text) bad();
    }
    const terms: MentorSettlementTerms = {
        id: s.id as string,
        pairingId: s.pairingId as string,
        senseiSlug: s.senseiSlug as string,
        studentSlug: s.studentSlug as string,
        studentName: s.studentName as string,
        milestones: milestones as MentorMilestone[],
        teacher: {
            createdAt: nullableStamp(teacher.createdAt),
            seals: teacher.seals as number,
            contrib: teacher.contrib as number,
            clanPoints: teacher.clanPoints as number,
        },
        student: { createdAt: nullableStamp(student.createdAt), ryo: student.ryo as number },
        evidence: {
            onboardingStep: evidence.onboardingStep === null ? null : String(evidence.onboardingStep ?? ''),
            level: evidence.level as number,
            rankedWins: evidence.rankedWins as number,
        },
        admittedAt: s.admittedAt as number,
    };
    if (Number.isNaN(terms.teacher.createdAt) || Number.isNaN(terms.student.createdAt)) bad();
    if (![terms.teacher.seals, terms.teacher.contrib, terms.teacher.clanPoints, terms.student.ryo, terms.evidence.level, terms.evidence.rankedWins].every(isCount)) bad();
    if (!Number.isFinite(terms.admittedAt) || terms.admittedAt <= 0) bad();
    // The id and fingerprint are derived from the sealed terms; anything else
    // means the record was edited after admission and cannot authorize value.
    if (terms.id !== mentorSettlementId(terms.pairingId, terms.milestones)) bad();
    if (s.fingerprint !== mentorTermsFingerprint(terms)) bad();
    return {
        v: 1,
        ...terms,
        fingerprint: s.fingerprint as string,
        attempts: isCount(s.attempts) ? s.attempts : 0,
        nextAttemptAt: num(s.nextAttemptAt),
        ...(Number.isFinite(s.lastAttemptAt) ? { lastAttemptAt: s.lastAttemptAt as number } : {}),
        ...(STEPS.has(s.step as MentorSettlementStep) ? { step: s.step as MentorSettlementStep } : {}),
        ...(typeof s.lastError === 'string' ? { lastError: s.lastError } : {}),
        ...(EXCEPTIONS.has(s.exception as MentorExceptionReason) ? { exception: s.exception as MentorExceptionReason } : {}),
    };
}

/**
 * Parse `clan-mentor:<sensei>`. Legacy student entries are tolerated as they
 * always were; pending settlements are validated strictly, because they
 * authorize payment.
 */
export function readMentorRecord(raw: unknown): MentorRecord {
    if (raw === null || raw === undefined) return { students: [], settlements: [] };
    if (!isObject(raw)) throw new MentorRecordError('Mentor record is malformed.');
    const students = Array.isArray(raw.students) ? raw.students as MentorStudentEntry[] : [];
    if (raw.settlements !== undefined && !Array.isArray(raw.settlements)) throw new MentorRecordError('Mentor settlements are malformed.');
    const settlements = ((raw.settlements as unknown[] | undefined) ?? []).map(parseSettlement);
    return { students, settlements };
}

/** Pending milestones reserved by unfinished settlements of one pairing. */
export function pendingMilestonesFor(record: MentorRecord, entry: MentorStudentEntry): MentorMilestone[] {
    if (!entry.pairingId) return [];
    const pending = new Set(record.settlements.filter((s) => s.pairingId === entry.pairingId).flatMap((s) => s.milestones));
    return MENTOR_MILESTONES.filter((m) => pending.has(m));
}

/** Give every pairing in the record a durable id (persisted only by the caller's CAS write). */
export function withPairingIds(students: MentorStudentEntry[]): MentorStudentEntry[] {
    return students.map((entry) => (entry.pairingId ? entry : { ...entry, pairingId: randomUUID() }));
}

function parseReceipt(raw: unknown): MentorRewardReceipt | null {
    if (!isObject(raw) || raw.v !== 1) return null;
    if (typeof raw.settlementId !== 'string' || !raw.settlementId) return null;
    if (raw.role !== 'teacher' && raw.role !== 'student') return null;
    if (typeof raw.fingerprint !== 'string' || !raw.fingerprint) return null;
    if (typeof raw.senseiSlug !== 'string' || !raw.senseiSlug) return null;
    if (typeof raw.pairingId !== 'string' || !raw.pairingId) return null;
    if (!Array.isArray(raw.milestones) || raw.milestones.some((m) => typeof m !== 'string')) return null;
    if (!Number.isFinite(raw.appliedAt)) return null;
    return raw as unknown as MentorRewardReceipt;
}

type ReceiptLookup =
    | { kind: 'found'; receipt: MentorRewardReceipt; receipts: MentorRewardReceipt[] }
    | { kind: 'absent'; receipts: MentorRewardReceipt[] }
    | { kind: 'exception'; reason: MentorExceptionReason };

function lookupReceipt(character: Record<string, unknown>, settlement: MentorSettlement, role: 'teacher' | 'student'): ReceiptLookup {
    const raw = character[MENTOR_RECEIPTS_FIELD];
    if (raw !== undefined && !Array.isArray(raw)) return { kind: 'exception', reason: 'receipts-malformed' };
    const receipts: MentorRewardReceipt[] = [];
    for (const entry of (raw as unknown[] | undefined) ?? []) {
        const parsed = parseReceipt(entry);
        if (!parsed) return { kind: 'exception', reason: 'receipts-malformed' };
        receipts.push(parsed);
    }
    const found = receipts.find((r) => r.settlementId === settlement.id && r.role === role);
    if (!found) return { kind: 'absent', receipts };
    if (found.fingerprint !== settlement.fingerprint) return { kind: 'exception', reason: 'receipt-conflict' };
    return { kind: 'found', receipt: found, receipts };
}

// ── Payment ──────────────────────────────────────────────────────────────────

type PayResult =
    | { status: 'paid'; receipt: MentorRewardReceipt; record: PlayerSaveRecord; wrote: boolean }
    | { status: 'gone' }
    | { status: 'retry'; error: string }
    | { status: 'exception'; reason: MentorExceptionReason };

class PayStop extends Error {
    constructor(public readonly result: Exclude<PayResult, { status: 'paid' }>) {
        super('mentor payment stopped');
    }
}

function recipientSlug(settlement: MentorSettlement, role: 'teacher' | 'student'): string {
    return role === 'teacher' ? settlement.senseiSlug : settlement.studentSlug;
}

/** Positive, co-written evidence in the stored save, or why there is none. */
function inspectStoredSave(record: PlayerSaveRecord | null, settlement: MentorSettlement, role: 'teacher' | 'student'):
    | { kind: 'paid'; receipt: MentorRewardReceipt }
    | { kind: 'unpaid' }
    | { kind: 'exception'; reason: MentorExceptionReason } {
    const character = isObject(record?.character) ? record!.character as Record<string, unknown> : null;
    if (!character) return { kind: 'exception', reason: 'recipient-missing' };
    const lookup = lookupReceipt(character, settlement, role);
    if (lookup.kind === 'exception') return lookup;
    if (lookup.kind === 'found') return { kind: 'paid', receipt: lookup.receipt };
    const expected = role === 'teacher' ? settlement.teacher.createdAt : settlement.student.createdAt;
    // A save under the same name but a different creation stamp is a new
    // account that reused a deleted player's name. Never redirect the reward.
    if (accountCreatedAt(character) !== expected) return { kind: 'exception', reason: 'identity-mismatch' };
    return { kind: 'unpaid' };
}

async function payRecipient(settlement: MentorSettlement, role: 'teacher' | 'student'): Promise<PayResult> {
    const slug = recipientSlug(settlement, role);
    const saveKey = `save:${slug}`;
    let stored: PlayerSaveRecord | null;
    try {
        stored = await kv.get<PlayerSaveRecord>(saveKey);
    } catch (error) {
        return { status: 'retry', error: errorText(error) };
    }
    const before = inspectStoredSave(stored, settlement, role);
    if (before.kind === 'exception') return { status: 'exception', reason: before.reason };
    if (before.kind === 'paid') return { status: 'paid', receipt: before.receipt, record: stored!, wrote: false };

    try {
        const out = await mutatePlayerSave<{ kind: 'found' | 'applied'; receipt: MentorRewardReceipt }>(slug, async ({ character }) => {
            const lookup = lookupReceipt(character, settlement, role);
            if (lookup.kind === 'exception') throw new PayStop({ status: 'exception', reason: lookup.reason });
            if (lookup.kind === 'found') return { ok: true as const, character, value: { kind: 'found' as const, receipt: lookup.receipt }, write: false };
            const expected = role === 'teacher' ? settlement.teacher.createdAt : settlement.student.createdAt;
            if (accountCreatedAt(character) !== expected) throw new PayStop({ status: 'exception', reason: 'identity-mismatch' });

            // Stale-writer fence: this save was read above, under its lock, and
            // the write below is an exact CAS against it. Only now re-read the
            // mentor record. If the settlement already left it, it was
            // finalized (and this receipt may have been compacted since).
            const authority = readMentorRecord(await kv.get(mentorRecordKey(settlement.senseiSlug)));
            const live = authority.settlements.find((s) => s.id === settlement.id);
            if (!live) throw new PayStop({ status: 'gone' });
            if (live.fingerprint !== settlement.fingerprint) throw new PayStop({ status: 'exception', reason: 'receipt-conflict' });

            // Compact only receipts whose settlement belongs to THIS mentor
            // record and has already been finalized out of it.
            const pendingIds = new Set(authority.settlements.map((s) => s.id));
            const kept = lookup.receipts.filter((r) => r.senseiSlug !== settlement.senseiSlug || pendingIds.has(r.settlementId));
            if (kept.length + 1 > MENTOR_RECEIPT_CAPACITY) throw new PayStop({ status: 'exception', reason: 'receipt-capacity' });

            const appliedAt = Date.now();
            const base: MentorRewardReceipt = {
                v: 1, settlementId: settlement.id, role, fingerprint: settlement.fingerprint,
                senseiSlug: settlement.senseiSlug, pairingId: settlement.pairingId,
                milestones: [...settlement.milestones], appliedAt,
            };
            let next: Record<string, unknown>;
            let receipt: MentorRewardReceipt;
            if (role === 'teacher') {
                const credited = {
                    ...character,
                    honorSeals: num(character.honorSeals) + settlement.teacher.seals,
                    clanEventContrib: num(character.clanEventContrib) + settlement.teacher.contrib,
                };
                // One full-batch request, decided now: current week, current
                // clan, current cap. The receipt records the decision, so a
                // retry — even in a later week — never asks again.
                const award = awardClanPoints(credited, 'mentorMilestone', settlement.teacher.clanPoints, {
                    eventId: `mentor:${settlement.id}`,
                    student: settlement.studentSlug,
                    milestones: settlement.milestones.length,
                }, new Date(appliedAt));
                next = award.character;
                receipt = {
                    ...base,
                    seals: settlement.teacher.seals,
                    contrib: settlement.teacher.contrib,
                    clanPoints: { requested: award.requested, awarded: award.awarded, weekKey: award.weekKey, reason: award.reason ?? null },
                };
            } else {
                next = { ...character, ryo: num(character.ryo) + settlement.student.ryo };
                receipt = { ...base, ryo: settlement.student.ryo };
            }
            return {
                ok: true as const,
                character: { ...next, [MENTOR_RECEIPTS_FIELD]: [receipt, ...kept] },
                value: { kind: 'applied' as const, receipt },
            };
        });
        if (!out.ok) return { status: 'exception', reason: 'recipient-missing' };
        if (out.value.kind === 'applied' && role === 'teacher' && (out.value.receipt.clanPoints?.awarded ?? 0) > 0) {
            const points = out.value.receipt.clanPoints!;
            // Audit only — never read back as payment evidence.
            await kv.set(`audit:clan-points:${slug}:${Date.now()}`, {
                ts: Date.now(), playerName: slug, source: 'mentorMilestone', amount: points.awarded, weekKey: points.weekKey,
                metadata: { eventId: `mentor:${settlement.id}`, student: settlement.studentSlug, milestones: settlement.milestones.length },
            }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return { status: 'paid', receipt: out.value.receipt, record: out.record, wrote: out.value.kind === 'applied' };
    } catch (error) {
        if (error instanceof PayStop) return error.result;
        // An exception does not prove the write was rejected. Only the stored
        // save can say whether this payment committed.
        const after = await kv.get<PlayerSaveRecord>(saveKey).catch(() => null);
        const seen = after ? inspectStoredSave(after, settlement, role) : null;
        if (seen?.kind === 'paid') return { status: 'paid', receipt: seen.receipt, record: after!, wrote: false };
        return { status: 'retry', error: errorText(error) };
    }
}

// ── Finalization and bookkeeping ─────────────────────────────────────────────

type FinalizeResult = { status: 'finalized' | 'gone' } | { status: 'retry'; error: string };

async function finalizeSettlement(
    settlement: MentorSettlement,
    teacherReceipt: MentorRewardReceipt,
    studentReceipt: MentorRewardReceipt,
): Promise<FinalizeResult> {
    const key = mentorRecordKey(settlement.senseiSlug);
    for (let attempt = 0; attempt < 3; attempt++) {
        let raw: Record<string, unknown> | null;
        let record: MentorRecord;
        try {
            raw = await kv.get<Record<string, unknown>>(key);
            record = readMentorRecord(raw);
        } catch (error) {
            return { status: 'retry', error: errorText(error) };
        }
        const live = record.settlements.find((s) => s.id === settlement.id);
        if (!live) return { status: 'gone' };
        const finalizedAt = Date.now();
        const log = Array.isArray(raw!.settledLog) ? raw!.settledLog : [];
        const next = {
            ...raw!,
            students: record.students.map((entry) => {
                // Only the pairing that admitted the batch. A released pairing is
                // not resurrected and a newer pairing is left untouched.
                if (entry.pairingId !== settlement.pairingId) return entry;
                const claimed = { ...(entry.claimed ?? {}) };
                const settledBy = { ...(entry.settledBy ?? {}) };
                for (const m of settlement.milestones) {
                    if (!claimed[m]) claimed[m] = settlement.admittedAt;
                    settledBy[m] = settlement.id;
                }
                return { ...entry, claimed, settledBy };
            }),
            settlements: record.settlements.filter((s) => s.id !== settlement.id),
            settledLog: [{
                id: settlement.id,
                pairingId: settlement.pairingId,
                student: settlement.studentSlug,
                milestones: settlement.milestones,
                seals: teacherReceipt.seals ?? 0,
                contrib: teacherReceipt.contrib ?? 0,
                clanPoints: teacherReceipt.clanPoints ?? null,
                studentRyo: studentReceipt.ryo ?? 0,
                admittedAt: settlement.admittedAt,
                finalizedAt,
            }, ...log].slice(0, MENTOR_SETTLED_LOG_LIMIT),
        };
        try {
            if (await kv.compareSet(key, raw, next)) return { status: 'finalized' };
        } catch (error) {
            const back = await kv.get(key).catch(() => undefined);
            if (back !== undefined) {
                try {
                    if (!readMentorRecord(back).settlements.some((s) => s.id === settlement.id)) return { status: 'finalized' };
                } catch { /* fall through to retry */ }
            }
            return { status: 'retry', error: errorText(error) };
        }
    }
    return { status: 'retry', error: 'mentor record changed during finalization' };
}

function backoffMs(attempts: number, exception: boolean): number {
    const n = Math.max(0, attempts - 1);
    return exception
        ? Math.min(EXCEPTION_MAX_MS, EXCEPTION_BASE_MS * 2 ** Math.min(n, 10))
        : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(n, 10));
}

/** Diagnostics + backoff on the pending settlement. Best effort: never moves value. */
async function recordAttempt(
    settlement: MentorSettlement,
    step: MentorSettlementStep,
    outcome: { error?: string; exception?: MentorExceptionReason },
): Promise<void> {
    const key = mentorRecordKey(settlement.senseiSlug);
    try {
        const raw = await kv.get<Record<string, unknown>>(key);
        const record = readMentorRecord(raw);
        const live = record.settlements.find((s) => s.id === settlement.id);
        if (!raw || !live || live.fingerprint !== settlement.fingerprint) return;
        const now = Date.now();
        const attempts = live.attempts + 1;
        const updated: MentorSettlement = {
            ...live,
            attempts,
            lastAttemptAt: now,
            nextAttemptAt: now + backoffMs(attempts, !!outcome.exception),
            step,
            lastError: (outcome.exception ?? outcome.error ?? 'unknown').slice(0, 200),
        };
        // A transient failure after an earlier exception clears the flag.
        if (outcome.exception) updated.exception = outcome.exception;
        else delete updated.exception;
        await kv.compareSet(key, raw, { ...raw, settlements: record.settlements.map((s) => (s.id === live.id ? updated : s)) });
    } catch { /* diagnostics only */ }
    console.warn(`[clan/mentor] settlement ${settlement.id} (${settlement.senseiSlug} → ${settlement.studentSlug}) unfinished at ${step}: ${outcome.exception ?? outcome.error}`);
}

/** Re-publish the discovery pointer whenever pending work is observed. Idempotent. */
async function ensurePendingPointer(senseiSlug: string): Promise<void> {
    const key = mentorPendingPointerKey(senseiSlug);
    if (await kv.get(key).catch(() => 'unknown') === null) await kv.set(key, randomUUID()).catch(() => undefined);
}

export type MentorSettleResult =
    | {
        status: 'completed';
        settlement: MentorSettlement;
        teacherReceipt: MentorRewardReceipt;
        studentReceipt: MentorRewardReceipt;
        /** The sensei save that holds the teacher receipt — character and _saveVersion from one record. */
        teacherRecord: PlayerSaveRecord;
        /** Nothing was credited by this call: both receipts already existed. */
        replayed: boolean;
    }
    | { status: 'gone'; settlementId: string }
    | { status: 'retry'; settlement: MentorSettlement; step: MentorSettlementStep; error: string }
    | { status: 'exception'; settlement: MentorSettlement; step: MentorSettlementStep; reason: MentorExceptionReason };

/**
 * Drive one admitted settlement as far as it can go. Safe to call from any
 * worker, any number of times, with or without the mentor lock: every effect
 * is guarded by an exact CAS plus co-written evidence.
 */
export async function settleMentorSettlement(settlement: MentorSettlement): Promise<MentorSettleResult> {
    const fail = async (step: MentorSettlementStep, result: Exclude<PayResult, { status: 'paid' | 'gone' }>): Promise<MentorSettleResult> => {
        await ensurePendingPointer(settlement.senseiSlug);
        if (result.status === 'exception') {
            await recordAttempt(settlement, step, { exception: result.reason });
            return { status: 'exception', settlement, step, reason: result.reason };
        }
        await recordAttempt(settlement, step, { error: result.error });
        return { status: 'retry', settlement, step, error: result.error };
    };

    const teacher = await payRecipient(settlement, 'teacher');
    if (teacher.status === 'gone') return { status: 'gone', settlementId: settlement.id };
    if (teacher.status !== 'paid') return fail('teacher', teacher);

    const student = await payRecipient(settlement, 'student');
    if (student.status === 'gone') return { status: 'gone', settlementId: settlement.id };
    if (student.status !== 'paid') return fail('student', student);

    // Both outcomes are proven by co-written receipts in the saves themselves.
    const finalized = await finalizeSettlement(settlement, teacher.receipt, student.receipt);
    if (finalized.status === 'retry') {
        // The finalize write may have landed with its acknowledgement and first
        // readback both lost. One more authoritative read decides.
        const settledNow = await kv.get(mentorRecordKey(settlement.senseiSlug))
            .then((raw) => !readMentorRecord(raw).settlements.some((s) => s.id === settlement.id))
            .catch(() => false);
        if (!settledNow) return fail('finalize', finalized);
    }
    return {
        status: 'completed',
        settlement,
        teacherReceipt: teacher.receipt,
        studentReceipt: student.receipt,
        teacherRecord: teacher.record,
        replayed: !teacher.wrote && !student.wrote,
    };
}

// ── Admission ────────────────────────────────────────────────────────────────

export type MentorAdmission =
    | { status: 'admitted'; settlement: MentorSettlement }
    | { status: 'none' }
    | { status: 'refused'; httpStatus: number; error: string }
    | { status: 'retry'; error: string };

/**
 * Freeze the reached-but-unclaimed milestones of one pairing as a pending
 * settlement. Reads real server-side progress; trusts nothing from the client.
 */
export async function admitMentorClaim(senseiSlug: string, studentSlug: string, now: number): Promise<MentorAdmission> {
    const key = mentorRecordKey(senseiSlug);
    const raw = await kv.get<Record<string, unknown>>(key);
    const record = readMentorRecord(raw);
    const entry = record.students.find((s) => s.studentSlug === studentSlug);
    if (!raw || !entry) return { status: 'refused', httpStatus: 404, error: 'That player is not your student.' };

    const studentSave = await kv.get<Record<string, unknown>>(`save:${studentSlug}`);
    const studentChar = isObject(studentSave?.character) ? studentSave!.character as Record<string, unknown> : null;
    if (!studentChar) return { status: 'refused', httpStatus: 404, error: 'Student save not found.' };
    const evidence = {
        onboardingStep: typeof studentChar.onboardingStep === 'string' ? studentChar.onboardingStep : null,
        level: Math.max(0, Math.floor(num(studentChar.level))),
        rankedWins: Math.max(0, Math.floor(num(studentChar.rankedWins))),
    };
    const milestones = claimableMilestones({ onboardingStep: evidence.onboardingStep ?? undefined, level: evidence.level, rankedWins: evidence.rankedWins }, entry.claimed);
    if (milestones.length === 0) return { status: 'none' };

    // A milestone must never be paid to a sensei with no save to credit.
    const senseiSave = await kv.get<Record<string, unknown>>(`save:${senseiSlug}`);
    const senseiChar = isObject(senseiSave?.character) ? senseiSave!.character as Record<string, unknown> : null;
    if (!senseiChar) return { status: 'refused', httpStatus: 404, error: 'Your save was not found.' };

    const students = withPairingIds(record.students);
    const pairingId = students[record.students.indexOf(entry)].pairingId!;
    const payout = mentorPayout(milestones.length);
    const terms: MentorSettlementTerms = {
        id: mentorSettlementId(pairingId, milestones),
        pairingId,
        senseiSlug,
        studentSlug,
        studentName: String(entry.studentName ?? studentSlug),
        milestones,
        teacher: { createdAt: accountCreatedAt(senseiChar), seals: payout.seals, contrib: payout.contrib, clanPoints: mentorClanPointsRequest(milestones.length) },
        student: { createdAt: accountCreatedAt(studentChar), ryo: payout.studentRyo },
        evidence,
        admittedAt: now,
    };
    const settlement: MentorSettlement = { v: 1, ...terms, fingerprint: mentorTermsFingerprint(terms), attempts: 0, nextAttemptAt: now };
    const reserved = Object.fromEntries(milestones.map((m) => [m, now]));
    const next = {
        ...raw,
        students: students.map((s) => (s.pairingId === pairingId ? { ...s, claimed: { ...(s.claimed ?? {}), ...reserved } } : s)),
        settlements: [...record.settlements, settlement],
    };

    // Publish discovery BEFORE the admission it describes, so no crash can
    // leave an admitted claim that the reconciler cannot find. A pointer
    // without a matching admission is harmless; the reconciler clears it.
    await kv.set(mentorPendingPointerKey(senseiSlug), randomUUID());
    try {
        if (await kv.compareSet(key, raw, next) !== true) return { status: 'retry', error: 'mentor record changed during admission' };
    } catch (error) {
        const back = await kv.get(key).catch(() => undefined);
        if (back !== undefined) {
            try {
                const found = readMentorRecord(back).settlements.find((s) => s.id === settlement.id);
                if (found && found.fingerprint === settlement.fingerprint) return { status: 'admitted', settlement: found };
            } catch { /* fall through */ }
        }
        throw error;
    }
    return { status: 'admitted', settlement };
}

// ── The claim path (authenticated POST) ─────────────────────────────────────

export type MentorClaimResult =
    | { kind: 'ok'; completed: Extract<MentorSettleResult, { status: 'completed' }>[] }
    | { kind: 'none' }
    | { kind: 'voided' }
    | { kind: 'refused'; httpStatus: number; error: string }
    | { kind: 'pending'; settlement: MentorSettlement; step: MentorSettlementStep; error: string }
    | { kind: 'exception'; settlement: MentorSettlement; step: MentorSettlementStep; reason: MentorExceptionReason };

/**
 * Finish anything already admitted for this student first — unchanged, from
 * its sealed terms — and only then admit newly reached milestones. `admitNew`
 * carries the caller's new-claim eligibility (the anti-alt check); it never
 * blocks work that was admitted when it was eligible.
 */
export async function claimMentorMilestones(input: {
    senseiSlug: string;
    studentSlug: string;
    admitNew: boolean;
    now: number;
}): Promise<MentorClaimResult> {
    const { senseiSlug, studentSlug } = input;
    return withKvLock(mentorRecordKey(senseiSlug), async () => {
        const completed: Extract<MentorSettleResult, { status: 'completed' }>[] = [];
        // A batch another worker finalized mid-call reports nothing here.
        const done = (): MentorClaimResult => (completed.length ? { kind: 'ok', completed } : { kind: 'none' });
        const drive = async (settlement: MentorSettlement): Promise<MentorClaimResult | null> => {
            const result = await settleMentorSettlement(settlement);
            if (result.status === 'completed') { completed.push(result); return null; }
            if (result.status === 'gone') return null;
            if (result.status === 'retry') return { kind: 'pending', settlement: result.settlement, step: result.step, error: result.error };
            return { kind: 'exception', settlement: result.settlement, step: result.step, reason: result.reason };
        };

        const record = readMentorRecord(await kv.get(mentorRecordKey(senseiSlug)));
        for (const settlement of record.settlements.filter((s) => s.studentSlug === studentSlug)) {
            const stop = await drive(settlement);
            if (stop) return stop;
        }

        if (!input.admitNew) return completed.length ? done() : { kind: 'voided' };
        const admission = await admitMentorClaim(senseiSlug, studentSlug, input.now);
        if (admission.status !== 'admitted') {
            if (completed.length) return done();
            if (admission.status === 'none') return { kind: 'none' };
            if (admission.status === 'refused') return { kind: 'refused', httpStatus: admission.httpStatus, error: admission.error };
            return { kind: 'refused', httpStatus: 503, error: 'The mentor record is busy. Please retry.' };
        }
        const stop = await drive(admission.settlement);
        return stop ?? done();
    }, { failClosed: true });
}

// ── Server-side reconciliation ──────────────────────────────────────────────

export type MentorRecoverySummary = {
    ranAt: number;
    senseisScanned: number;
    pointersRepublished: number;
    pointersCleared: number;
    completed: string[];
    deferred: number;
    unfinished: Array<{ settlementId: string; sensei: string; student: string; step: MentorSettlementStep; error: string; attempts: number }>;
    exceptions: Array<{ settlementId: string; sensei: string; student: string; step: MentorSettlementStep; reason: MentorExceptionReason; attempts: number }>;
    failures: Array<{ sensei: string; error: string }>;
    truncated: boolean;
};

/**
 * Bounded recovery pass for the in-process scheduler. Finds pending work
 * through the per-sensei pointer keys (proportional to unsettled work, never
 * a player-save scan), finishes each due settlement from its sealed terms,
 * and backs off failing ones. `discover` additionally walks mentor records
 * once (boot) to re-publish any pointer that is missing.
 */
export async function recoverPendingMentorSettlements(opts: {
    now?: number;
    senseiLimit?: number;
    settlementLimit?: number;
    budgetMs?: number;
    discover?: boolean;
} = {}): Promise<MentorRecoverySummary> {
    const started = Date.now();
    const now = opts.now ?? started;
    const senseiLimit = Math.max(1, Math.min(200, Math.floor(opts.senseiLimit ?? 25)));
    const settlementLimit = Math.max(1, Math.min(500, Math.floor(opts.settlementLimit ?? 50)));
    const budgetMs = Math.max(1_000, Math.floor(opts.budgetMs ?? 60_000));
    const summary: MentorRecoverySummary = {
        ranAt: now, senseisScanned: 0, pointersRepublished: 0, pointersCleared: 0,
        completed: [], deferred: 0, unfinished: [], exceptions: [], failures: [], truncated: false,
    };

    if (opts.discover) {
        for (const key of await kv.keys('clan-mentor:*')) {
            if (!key.startsWith('clan-mentor:')) continue;
            try {
                const record = readMentorRecord(await kv.get(key));
                const sensei = key.slice('clan-mentor:'.length);
                if (record.settlements.length && await kv.get(mentorPendingPointerKey(sensei)) === null) {
                    await kv.set(mentorPendingPointerKey(sensei), randomUUID());
                    summary.pointersRepublished += 1;
                }
            } catch (error) {
                summary.failures.push({ sensei: key.slice('clan-mentor:'.length), error: errorText(error) });
            }
        }
    }

    const senseis = (await kv.keys(`${POINTER_PREFIX}*`))
        .filter((key) => key.startsWith(POINTER_PREFIX))
        .map((key) => key.slice(POINTER_PREFIX.length))
        .sort();
    if (senseis.length > senseiLimit) summary.truncated = true;
    let budget = settlementLimit;
    for (const sensei of senseis.slice(0, senseiLimit)) {
        if (Date.now() - started > budgetMs || budget <= 0) { summary.truncated = true; break; }
        summary.senseisScanned += 1;
        try {
            // Read the pointer BEFORE the record: an admission publishes a fresh
            // token before its CAS, so this guarded delete can only remove a
            // pointer that no newer admission has touched.
            const token = await kv.get<string>(mentorPendingPointerKey(sensei));
            await withKvLock(mentorRecordKey(sensei), async () => {
                const record = readMentorRecord(await kv.get(mentorRecordKey(sensei)));
                for (const settlement of record.settlements) {
                    if (settlement.nextAttemptAt > now) { summary.deferred += 1; continue; }
                    if (budget <= 0 || Date.now() - started > budgetMs) { summary.truncated = true; break; }
                    budget -= 1;
                    const result = await settleMentorSettlement(settlement);
                    if (result.status === 'completed') summary.completed.push(settlement.id);
                    else if (result.status === 'retry') {
                        summary.unfinished.push({ settlementId: settlement.id, sensei, student: settlement.studentSlug, step: result.step, error: result.error, attempts: settlement.attempts + 1 });
                    } else if (result.status === 'exception') {
                        summary.exceptions.push({ settlementId: settlement.id, sensei, student: settlement.studentSlug, step: result.step, reason: result.reason, attempts: settlement.attempts + 1 });
                    }
                }
                const after = readMentorRecord(await kv.get(mentorRecordKey(sensei)));
                if (after.settlements.length === 0 && token !== null && await kv.delIfEqual(mentorPendingPointerKey(sensei), token)) {
                    summary.pointersCleared += 1;
                }
            }, { failClosed: true });
        } catch (error) {
            summary.failures.push({ sensei, error: errorText(error) });
        }
    }

    await kv.set(MENTOR_RECOVERY_STATUS_KEY, summary, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
    return summary;
}
