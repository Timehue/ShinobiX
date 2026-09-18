import { randomUUID } from 'node:crypto';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { MENTOR_MILESTONES, canAssignStudent, claimableMilestones } from './_mentor.js';
import {
    MentorRecordError,
    claimMentorMilestones,
    mentorRecordKey as senseiKey,
    mentorStudentMarkerKey as studentMarkerKey,
    pendingMilestonesFor,
    readMentorRecord,
    withPairingIds,
    type MentorExceptionReason,
    type MentorRecord,
    type MentorStudentEntry,
} from './_mentor-settlement.js';

/*
 * /api/clan/mentor — GET (a player's mentor view) + POST (assign / claim / release)
 *
 * Clan Sensei -> Student mentorship. See _mentor.ts for the model + rules and
 * _mentor-settlement.ts (docs/mentor-milestone-settlement.md) for how a claim
 * is paid exactly once across both saves.
 *
 *   GET  ?player=<name>            → { asSensei: {students...}, asStudent: {sensei} }
 *   POST { action:'assign',  playerName, studentName }
 *   POST { action:'claim',   playerName, studentName }   // pay reached milestones
 *   POST { action:'release', playerName, studentName }
 *
 * Storage:
 *   clan-mentor:<senseiSlug>         → { students: [{ studentSlug, studentName, startedAt, claimed, pairingId, settledBy }],
 *                                        settlements: [pending batches], settledLog: [recent, diagnostic] }
 *   clan-mentor-of:<studentSlug>     → senseiSlug   (one sensei per student; assign guard)
 *   clan-mentor-pending:<senseiSlug> → discovery pointer for the settlement reconciler
 * Every write to the mentor record is an exact compare-and-set.
 */

const AUDIT_PREFIX = 'audit:clan-mentor:';

function clanSlugBare(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

const EXCEPTION_TEXT: Record<MentorExceptionReason, string> = {
    'recipient-missing': 'a player in this pairing no longer has a save',
    'identity-mismatch': 'a player in this pairing was replaced by a new account with the same name',
    'receipts-malformed': 'a reward receipt is unreadable',
    'receipt-conflict': 'a reward receipt does not match this reward',
    'receipt-capacity': 'too many unfinished mentor rewards',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── A player's mentor view (own sensei + own students with claimable count) ──
    // Read-only and unauthenticated, as before: it never settles anything.
    if (req.method === 'GET') {
        const player = safeName(String(req.query.player ?? ''));
        if (!player) return res.status(400).json({ error: 'Missing player.' });
        const [raw, mySensei] = await Promise.all([
            kv.get<Record<string, unknown>>(senseiKey(player)),
            kv.get<string>(studentMarkerKey(player)),
        ]);
        let record: MentorRecord;
        try {
            record = readMentorRecord(raw);
        } catch {
            record = { students: Array.isArray(raw?.students) ? raw!.students as MentorStudentEntry[] : [], settlements: [] };
        }
        const enriched = await Promise.all(record.students.map(async (s) => {
            const save = await kv.get<Record<string, unknown>>(`save:${s.studentSlug}`);
            const char = (save?.character ?? {}) as Record<string, unknown>;
            // A reserved-but-unpaid milestone is still owed: keep it on the
            // "ready to claim" list so the existing Claim button resumes it.
            const pending: string[] = pendingMilestonesFor(record, s);
            const fresh = claimableMilestones({ onboardingStep: char.onboardingStep as string, level: num(char.level), rankedWins: num(char.rankedWins) }, s.claimed);
            const claimable = MENTOR_MILESTONES.filter((m) => pending.includes(m) || fresh.includes(m));
            const claimed = Object.keys(s.claimed ?? {}).filter((m) => !pending.includes(m));
            return { student: s.studentName, startedAt: s.startedAt, claimed, claimable, ...(pending.length ? { pending } : {}) };
        }));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ asSensei: { students: enriched }, asStudent: { sensei: mySensei ?? null } });
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = safeName(String(body.playerName ?? ''));     // the sensei
        const studentName = safeName(String(body.studentName ?? ''));
        if (!playerName || !studentName) return res.status(400).json({ error: 'Missing playerName or studentName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `clan-mentor-${action}`, 20, 60_000, identity.name))) return;
        const now = Date.now();

        // ── ASSIGN ──────────────────────────────────────────────────────────
        if (action === 'assign') {
            const [senseiRec, studentRec] = await Promise.all([
                kv.get<Record<string, unknown>>(`save:${playerName}`),
                kv.get<Record<string, unknown>>(`save:${studentName}`),
            ]);
            const senseiChar = (senseiRec?.character ?? null) as Record<string, unknown> | null;
            const studentChar = (studentRec?.character ?? null) as Record<string, unknown> | null;
            if (!senseiChar) return res.status(404).json({ error: 'Your save was not found.' });
            if (!studentChar) return res.status(404).json({ error: 'That player was not found.' });
            const senseiClan = clanSlugBare(String(senseiChar.clan ?? ''));
            const studentClan = clanSlugBare(String(studentChar.clan ?? ''));
            const studentDisplay = (studentChar.name as string) ?? studentName;

            if (!identity.admin) {
                try { if (await hasRecentIpOrFpOverlap(playerName, studentName)) return res.status(403).json({ error: "You can't mentor someone sharing your connection." }); } catch { /* fail open */ }
            }

            const out = await withKvLock<{ status: number; body: unknown }>(studentMarkerKey(studentName), async () => {
                const already = await kv.get<string>(studentMarkerKey(studentName));
                return await withKvLock<{ status: number; body: unknown }>(senseiKey(playerName), async () => {
                    const raw = await kv.get<Record<string, unknown>>(senseiKey(playerName));
                    const rec = readMentorRecord(raw);
                    const gate = canAssignStudent({
                        senseiSlug: playerName, studentSlug: studentName,
                        sameClan: !!senseiClan && senseiClan === studentClan,
                        studentLevel: num(studentChar.level),
                        studentAccountAgeMs: now - num(studentChar.createdAt),
                        studentAlreadyMentored: !!already,
                        senseiStudentCount: rec.students.length,
                    });
                    if (!gate.ok) return { status: 403, body: { error: gate.reason } };
                    const entry: MentorStudentEntry = { studentSlug: studentName, studentName: studentDisplay, startedAt: now, claimed: {}, pairingId: randomUUID() };
                    // CAS: a writer whose lock lapsed must not erase a pending settlement.
                    const next = { ...(raw ?? {}), students: [...withPairingIds(rec.students), entry] };
                    if (!(await kv.compareSet(senseiKey(playerName), raw ?? null, next))) {
                        return { status: 503, body: { error: 'Mentorship changed while assigning. Please retry.' } };
                    }
                    await kv.set(studentMarkerKey(studentName), playerName, { ex: 365 * 24 * 60 * 60 });
                    return { status: 200, body: { ok: true, student: studentDisplay } };
                }, { failClosed: true });
            }, { failClosed: true });

            if (out.status === 200) await kv.set(`${AUDIT_PREFIX}assign:${Date.now()}`, { ts: now, sensei: playerName, student: studentName }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }

        // ── CLAIM (pay reached milestones; resume any unfinished payment) ───
        if (action === 'claim') {
            // Anti-alt: a same-connection pairing earns nothing NEW (no
            // laundering ryo/seals to your main through an alt "student"). It
            // gates admission only; a batch already admitted was vetted then.
            let voided = false;
            if (!identity.admin) {
                try { voided = await hasRecentIpOrFpOverlap(playerName, studentName); } catch { /* fail open */ }
            }

            const result = await claimMentorMilestones({ senseiSlug: playerName, studentSlug: studentName, admitNew: !voided, now });
            if (result.kind === 'none') return res.status(200).json({ ok: true, claimed: 0 });
            if (result.kind === 'voided') return res.status(403).json({ error: 'Mentor reward voided: you and the student share a connection.' });
            if (result.kind === 'refused') return res.status(result.httpStatus).json({ error: result.error, ...(result.httpStatus === 503 ? { retryable: true } : {}) });
            if (result.kind === 'pending') {
                // Something is owed and admitted but not finished. Not a success,
                // and not a reason to give up: this or the server will finish it.
                return res.status(503).json({
                    error: 'Your mentor reward is still being delivered. It will finish automatically — you can also retry in a moment.',
                    retryable: true,
                    settlementId: result.settlement.id,
                    pending: result.settlement.milestones,
                });
            }
            if (result.kind === 'exception') {
                return res.status(409).json({
                    error: `This mentor reward is held for review: ${EXCEPTION_TEXT[result.reason]}.`,
                    review: true,
                    settlementId: result.settlement.id,
                    pending: result.settlement.milestones,
                });
            }

            const batches = result.completed;
            for (const batch of batches) {
                if (batch.replayed) continue;
                await kv.set(`${AUDIT_PREFIX}claim:${Date.now()}:${batch.settlement.id}`, {
                    ts: now, sensei: playerName, student: studentName, settlementId: batch.settlement.id,
                    milestones: batch.settlement.milestones, clanPoints: batch.teacherReceipt.clanPoints ?? null,
                }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            }
            // One record supplies both character and _saveVersion.
            const teacherRecord = batches[batches.length - 1].teacherRecord;
            return res.status(200).json({
                ok: true,
                claimed: batches.reduce((n, b) => n + b.settlement.milestones.length, 0),
                seals: batches.reduce((n, b) => n + b.settlement.teacher.seals, 0),
                contrib: batches.reduce((n, b) => n + b.settlement.teacher.contrib, 0),
                studentRyo: batches.reduce((n, b) => n + b.settlement.student.ryo, 0),
                milestones: batches.flatMap((b) => b.settlement.milestones),
                settlementIds: batches.map((b) => b.settlement.id),
                replayed: batches.every((b) => b.replayed),
                character: teacherRecord.character,
                _saveVersion: Number(teacherRecord._saveVersion ?? 0),
            });
        }

        // ── RELEASE (end the pairing) ───────────────────────────────────────────
        if (action === 'release') {
            // Releasing ends the pairing only. Any admitted-but-unfinished reward
            // stays in `settlements` and is still paid from its sealed terms.
            const released = await withKvLock(senseiKey(playerName), async () => {
                const raw = await kv.get<Record<string, unknown>>(senseiKey(playerName));
                const rec = readMentorRecord(raw);
                if (!raw || !rec.students.some((s) => s.studentSlug === studentName)) return true;
                const next = { ...raw, students: rec.students.filter((s) => s.studentSlug !== studentName) };
                return kv.compareSet(senseiKey(playerName), raw, next);
            }, { failClosed: true });
            if (!released) return res.status(503).json({ error: 'Mentorship changed while releasing. Please retry.', retryable: true });
            // Only clear the marker if it still points at THIS sensei (a student
            // re-assigned elsewhere in a race keeps their new sensei) — atomically.
            await kv.delIfEqual(studentMarkerKey(studentName), playerName).catch(() => undefined);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[clan/mentor]', safeLogValue(err));
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'Mentorship is busy. Please retry.', retryable: true });
        if (err instanceof MentorRecordError) return res.status(409).json({ error: 'This mentorship record needs review before it can change.', review: true });
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
