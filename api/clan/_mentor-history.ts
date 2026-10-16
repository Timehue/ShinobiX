import { createHash } from 'node:crypto';
import { MENTOR_MILESTONES, mentorPayout, type MentorMilestone } from './_mentor.js';

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const slug = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,64}$/.test(v);

export type MentorHistoryEvidence = {
    studentSlug: string;
    settlementId: string;
    milestones: MentorMilestone[];
    at: number;
    source: string;
};
export type MentorHistoryResult = {
    paid: Record<string, number>;
    evidence: MentorHistoryEvidence[];
    unresolved: Array<{ source: string; reason: string }>;
};
const empty = (): MentorHistoryResult => ({ paid: {}, evidence: [], unresolved: [] });

/** Keep #413's flat per-student format. Invalid flags must not be silently erased. */
export function parseMentorPaidRecord(raw: unknown): Record<string, number> {
    if (raw === null || raw === undefined) return {};
    if (!object(raw) || Object.entries(raw).some(([m, at]) => !MENTOR_MILESTONES.includes(m as MentorMilestone) || !stamp(at))) {
        throw new Error('Mentor payment history needs review.');
    }
    return { ...raw } as Record<string, number>;
}

/**
 * A student receipt is co-written with its ryo credit in this very save. Teacher
 * receipts omit the student identity; a count, progress or balance proves no
 * named payout. Reject malformed/foreign/unknown receipts without inventing flags.
 */
export function mentorHistoryFromStudentSave(studentSlug: string, rawSave: unknown, now: number): MentorHistoryResult {
    const out = empty();
    const source = `save:${studentSlug}:mentorRewardReceipts`;
    if (!object(rawSave) || !object(rawSave.character)) {
        out.unresolved.push({ source, reason: 'student-save-missing' });
        return out;
    }
    const character = rawSave.character;
    const receipts = character.mentorRewardReceipts;
    if (receipts === undefined) return out;
    if (!Array.isArray(receipts)) {
        out.unresolved.push({ source, reason: 'receipts-malformed' });
        return out;
    }
    const seen = new Map<string, string>();
    const conflicts = new Set<string>();
    for (const [index, raw] of receipts.entries()) {
        const itemSource = `${source}[${index}]`;
        if (object(raw) && raw.role === 'teacher') continue;
        if (object(raw) && typeof raw.settlementId === 'string') {
            const own = JSON.stringify([raw.v, raw.role, raw.fingerprint, raw.senseiSlug, raw.pairingId, raw.milestones, raw.appliedAt, raw.ryo]);
            const previous = seen.get(raw.settlementId);
            if (previous !== undefined && previous !== own) conflicts.add(raw.settlementId);
            seen.set(raw.settlementId, own);
        }
        if (!object(raw) || raw.v !== 1 || raw.role !== 'student' || !slug(studentSlug)
            || !slug(raw.senseiSlug) || typeof raw.pairingId !== 'string' || !raw.pairingId
            || !Array.isArray(raw.milestones) || !raw.milestones.length
            || raw.milestones.some((m, i, all) => !MENTOR_MILESTONES.includes(m as MentorMilestone) || all.indexOf(m) !== i)
            || typeof raw.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint)
            || !stamp(raw.appliedAt) || raw.appliedAt > now
            || !stamp(character.createdAt) || character.createdAt > raw.appliedAt
            || raw.ryo !== mentorPayout(raw.milestones.length).studentRyo) {
            out.unresolved.push({ source: itemSource, reason: 'receipt-or-account-identity-malformed' });
            continue;
        }
        const milestones = raw.milestones as MentorMilestone[];
        const id = `mentor-${createHash('sha256').update(`clan-mentor-milestone/v1|${raw.pairingId}|${milestones.join(',')}`).digest('hex').slice(0, 32)}`;
        if (raw.settlementId !== id) {
            out.unresolved.push({ source: itemSource, reason: 'receipt-settlement-conflict' });
            continue;
        }
        out.evidence.push({ studentSlug, settlementId: id, milestones, at: raw.appliedAt, source: itemSource });
    }
    out.evidence = out.evidence.filter((e) => !conflicts.has(e.settlementId));
    if (conflicts.size) out.unresolved.push({ source, reason: 'conflicting-receipt-copies' });
    for (const e of out.evidence) for (const m of e.milestones) out.paid[m] = Math.min(out.paid[m] ?? Infinity, e.at);
    return out;
}

/** Logs and legacy reservations cannot identify the current account on their own. */
export function mentorHistoryFromRecord(senseiSlug: string, raw: unknown, studentSaves: Map<string, unknown>, now: number): MentorHistoryResult {
    const out = empty();
    const source = `clan-mentor:${senseiSlug}`;
    if (!object(raw)) {
        out.unresolved.push({ source, reason: 'mentor-record-malformed' });
        return out;
    }
    if (raw.students !== undefined && !Array.isArray(raw.students)) out.unresolved.push({ source, reason: 'students-malformed' });
    for (const entry of Array.isArray(raw.students) ? raw.students : []) {
        if (!object(entry) || !slug(entry.studentSlug) || !object(entry.claimed)) {
            out.unresolved.push({ source, reason: 'legacy-student-malformed' });
        } else if (Object.keys(entry.claimed).length) {
            out.unresolved.push({ source: `${source}:student:${entry.studentSlug}`, reason: 'claimed-is-a-reservation-not-proof-of-payment' });
        }
    }
    if (raw.settledLog !== undefined && !Array.isArray(raw.settledLog)) out.unresolved.push({ source, reason: 'settled-log-malformed' });
    for (const [index, log] of (Array.isArray(raw.settledLog) ? raw.settledLog : []).entries()) {
        const itemSource = `${source}:settledLog[${index}]`;
        if (!object(log) || !slug(log.student)) {
            out.unresolved.push({ source: itemSource, reason: 'settled-log-malformed' });
            continue;
        }
        const save = studentSaves.get(log.student);
        const history = mentorHistoryFromStudentSave(log.student, save, now);
        // Only corroboration. Receipt extraction supplies the actual flags;
        // a log without that anchor is an explicit operator review case.
        const anchored = history.evidence.some((e) => e.settlementId === log.id);
        if (!anchored) out.unresolved.push({ source: itemSource, reason: 'completion-log-has-no-current-account-receipt' });
    }
    if (Array.isArray(raw.settlements) && raw.settlements.length) out.unresolved.push({ source, reason: 'pending-settlements-must-resume-through-existing-recovery' });
    if (raw.settlements !== undefined && !Array.isArray(raw.settlements)) out.unresolved.push({ source, reason: 'settlements-malformed' });
    return out;
}
