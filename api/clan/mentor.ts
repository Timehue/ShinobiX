import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { canAssignStudent, claimableMilestones, mentorPayout } from './_mentor.js';

/*
 * /api/clan/mentor — GET (a player's mentor view) + POST (assign / claim / release)
 *
 * Clan Sensei -> Student mentorship. See _mentor.ts for the model + rules.
 *
 *   GET  ?player=<name>            → { asSensei: {students...}, asStudent: {sensei} }
 *   POST { action:'assign',  playerName, studentName }
 *   POST { action:'claim',   playerName, studentName }   // pay reached milestones
 *   POST { action:'release', playerName, studentName }
 *
 * Storage:
 *   clan-mentor:<senseiSlug>     → { students: [{ studentSlug, studentName, startedAt, claimed }] }
 *   clan-mentor-of:<studentSlug> → senseiSlug   (one sensei per student; assign guard)
 */

type StudentEntry = { studentSlug: string; studentName: string; startedAt: number; claimed: Record<string, number> };
type MentorRecord = { students: StudentEntry[] };
const AUDIT_PREFIX = 'audit:clan-mentor:';

function senseiKey(slug: string): string { return `clan-mentor:${slug}`; }
function studentMarkerKey(slug: string): string { return `clan-mentor-of:${slug}`; }
function clanSlugBare(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function loadRecord(rec: MentorRecord | null | undefined): MentorRecord {
    return { students: Array.isArray(rec?.students) ? rec!.students : [] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── A player's mentor view (own sensei + own students with claimable count) ──
    if (req.method === 'GET') {
        const player = safeName(String(req.query.player ?? ''));
        if (!player) return res.status(400).json({ error: 'Missing player.' });
        const [rec, mySensei] = await Promise.all([
            kv.get<MentorRecord>(senseiKey(player)),
            kv.get<string>(studentMarkerKey(player)),
        ]);
        const students = loadRecord(rec).students;
        const enriched = await Promise.all(students.map(async (s) => {
            const save = await kv.get<Record<string, unknown>>(`save:${s.studentSlug}`);
            const char = (save?.character ?? {}) as Record<string, unknown>;
            const claimable = claimableMilestones({ onboardingStep: char.onboardingStep as string, level: num(char.level), rankedWins: num(char.rankedWins) }, s.claimed);
            return { student: s.studentName, startedAt: s.startedAt, claimed: Object.keys(s.claimed ?? {}), claimable };
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
                    const rec = loadRecord(await kv.get<MentorRecord>(senseiKey(playerName)));
                    const gate = canAssignStudent({
                        senseiSlug: playerName, studentSlug: studentName,
                        sameClan: !!senseiClan && senseiClan === studentClan,
                        studentLevel: num(studentChar.level),
                        studentAccountAgeMs: now - num(studentChar.createdAt),
                        studentAlreadyMentored: !!already,
                        senseiStudentCount: rec.students.length,
                    });
                    if (!gate.ok) return { status: 403, body: { error: gate.reason } };
                    rec.students.push({ studentSlug: studentName, studentName: studentDisplay, startedAt: now, claimed: {} });
                    await kv.set(senseiKey(playerName), rec);
                    await kv.set(studentMarkerKey(studentName), playerName, { ex: 365 * 24 * 60 * 60 });
                    return { status: 200, body: { ok: true, student: studentDisplay } };
                }, { failClosed: true });
            }, { failClosed: true });

            if (out.status === 200) await kv.set(`${AUDIT_PREFIX}assign:${Date.now()}`, { ts: now, sensei: playerName, student: studentName }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }

        // ── CLAIM (pay reached-but-unclaimed milestones) ────────────────────────
        if (action === 'claim') {
            // Anti-alt: a same-connection pairing pays nothing (no laundering ryo/
            // seals to your main through an alt "student").
            if (!identity.admin) {
                try { if (await hasRecentIpOrFpOverlap(playerName, studentName)) return res.status(403).json({ error: 'Mentor reward voided: you and the student share a connection.' }); } catch { /* fail open */ }
            }

            const out = await withKvLock<{ status: number; body: unknown; paid?: number }>(senseiKey(playerName), async () => {
                const rec = loadRecord(await kv.get<MentorRecord>(senseiKey(playerName)));
                const entry = rec.students.find((s) => s.studentSlug === studentName);
                if (!entry) return { status: 404, body: { error: 'That player is not your student.' } };
                const studentSave = await kv.get<Record<string, unknown>>(`save:${studentName}`);
                const studentChar = (studentSave?.character ?? null) as Record<string, unknown> | null;
                if (!studentSave || !studentChar) return { status: 404, body: { error: 'Student save not found.' } };
                const claimable = claimableMilestones({ onboardingStep: studentChar.onboardingStep as string, level: num(studentChar.level), rankedWins: num(studentChar.rankedWins) }, entry.claimed);
                if (claimable.length === 0) return { status: 200, body: { ok: true, claimed: 0 } };
                const payout = mentorPayout(claimable.length);

                // Verify the sensei save exists BEFORE marking claimed — we must not
                // mark a milestone paid if there's no save to credit (preserves the
                // old "credit only if both saves exist" guard).
                const senseiPre = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                if (!senseiPre || !senseiPre.character) return { status: 404, body: { error: 'Your save was not found.' } };

                // Mark the milestones claimed and persist the mentor record FIRST,
                // before crediting. Cross-key credits (sensei + student saves) can't
                // be atomic with this mark, so we choose the safe direction: a crash
                // or contention-throw after this point loses a payout (rare) but can
                // NEVER leave a milestone paid-but-unmarked → re-claimable (a mint).
                for (const m of claimable) entry.claimed[m] = now;
                await kv.set(senseiKey(playerName), rec);

                // Credit the sensei (Honor Seals + clan contribution) under their save lock.
                await withKvLock<void>(`save:${playerName}`, async () => {
                    const r = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const c = (r?.character ?? null) as Record<string, unknown> | null;
                    if (r && c) await kv.set(`save:${playerName}`, mergePreservingImages(bumpSaveVersion({ ...r, character: { ...c, honorSeals: num(c.honorSeals) + payout.seals, clanEventContrib: num(c.clanEventContrib) + payout.contrib } }), r));
                }, { failClosed: true });

                // Boost the student (ryo) under their save lock.
                await withKvLock<void>(`save:${studentName}`, async () => {
                    const r = await kv.get<Record<string, unknown>>(`save:${studentName}`);
                    const c = (r?.character ?? null) as Record<string, unknown> | null;
                    if (r && c) await kv.set(`save:${studentName}`, mergePreservingImages(bumpSaveVersion({ ...r, character: { ...c, ryo: num(c.ryo) + payout.studentRyo } }), r));
                }, { failClosed: true });

                return { status: 200, body: { ok: true, claimed: claimable.length, seals: payout.seals, contrib: payout.contrib, studentRyo: payout.studentRyo, milestones: claimable }, paid: claimable.length };
            }, { failClosed: true });

            if (out.paid) await kv.set(`${AUDIT_PREFIX}claim:${Date.now()}`, { ts: now, sensei: playerName, student: studentName, milestones: out.paid }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }

        // ── RELEASE (end the pairing) ───────────────────────────────────────────
        if (action === 'release') {
            await withKvLock(senseiKey(playerName), async () => {
                const rec = loadRecord(await kv.get<MentorRecord>(senseiKey(playerName)));
                rec.students = rec.students.filter((s) => s.studentSlug !== studentName);
                await kv.set(senseiKey(playerName), rec);
            }, { failClosed: true });
            // Only clear the marker if it points at THIS sensei (don't free a student
            // who was re-assigned elsewhere in a race).
            const marker = await kv.get<string>(studentMarkerKey(studentName));
            if (marker === playerName) await kv.del(studentMarkerKey(studentName)).catch(() => undefined);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        console.error('[clan/mentor]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
