"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _player_ips_js_1 = require("../_player-ips.js");
const _mentor_js_1 = require("./_mentor.js");
const AUDIT_PREFIX = 'audit:clan-mentor:';
function senseiKey(slug) { return `clan-mentor:${slug}`; }
function studentMarkerKey(slug) { return `clan-mentor-of:${slug}`; }
function clanSlugBare(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function loadRecord(rec) {
    return { students: Array.isArray(rec?.students) ? rec.students : [] };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    // ── A player's mentor view (own sensei + own students with claimable count) ──
    if (req.method === 'GET') {
        const player = (0, _utils_js_1.safeName)(String(req.query.player ?? ''));
        if (!player)
            return res.status(400).json({ error: 'Missing player.' });
        const [rec, mySensei] = await Promise.all([
            _storage_js_1.kv.get(senseiKey(player)),
            _storage_js_1.kv.get(studentMarkerKey(player)),
        ]);
        const students = loadRecord(rec).students;
        const enriched = await Promise.all(students.map(async (s) => {
            const save = await _storage_js_1.kv.get(`save:${s.studentSlug}`);
            const char = (save?.character ?? {});
            const claimable = (0, _mentor_js_1.claimableMilestones)({ onboardingStep: char.onboardingStep, level: num(char.level), rankedWins: num(char.rankedWins) }, s.claimed);
            return { student: s.studentName, startedAt: s.startedAt, claimed: Object.keys(s.claimed ?? {}), claimable };
        }));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ asSensei: { students: enriched }, asStudent: { sensei: mySensei ?? null } });
    }
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? '')); // the sensei
        const studentName = (0, _utils_js_1.safeName)(String(body.studentName ?? ''));
        if (!playerName || !studentName)
            return res.status(400).json({ error: 'Missing playerName or studentName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `clan-mentor-${action}`, 20, 60_000, identity.name)))
            return;
        const now = Date.now();
        // ── ASSIGN ──────────────────────────────────────────────────────────
        if (action === 'assign') {
            const [senseiRec, studentRec] = await Promise.all([
                _storage_js_1.kv.get(`save:${playerName}`),
                _storage_js_1.kv.get(`save:${studentName}`),
            ]);
            const senseiChar = (senseiRec?.character ?? null);
            const studentChar = (studentRec?.character ?? null);
            if (!senseiChar)
                return res.status(404).json({ error: 'Your save was not found.' });
            if (!studentChar)
                return res.status(404).json({ error: 'That player was not found.' });
            const senseiClan = clanSlugBare(String(senseiChar.clan ?? ''));
            const studentClan = clanSlugBare(String(studentChar.clan ?? ''));
            const studentDisplay = studentChar.name ?? studentName;
            if (!identity.admin) {
                try {
                    if (await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(playerName, studentName))
                        return res.status(403).json({ error: "You can't mentor someone sharing your connection." });
                }
                catch { /* fail open */ }
            }
            const out = await (0, _lock_js_1.withKvLock)(studentMarkerKey(studentName), async () => {
                const already = await _storage_js_1.kv.get(studentMarkerKey(studentName));
                return await (0, _lock_js_1.withKvLock)(senseiKey(playerName), async () => {
                    const rec = loadRecord(await _storage_js_1.kv.get(senseiKey(playerName)));
                    const gate = (0, _mentor_js_1.canAssignStudent)({
                        senseiSlug: playerName, studentSlug: studentName,
                        sameClan: !!senseiClan && senseiClan === studentClan,
                        studentLevel: num(studentChar.level),
                        studentAccountAgeMs: now - num(studentChar.createdAt),
                        studentAlreadyMentored: !!already,
                        senseiStudentCount: rec.students.length,
                    });
                    if (!gate.ok)
                        return { status: 403, body: { error: gate.reason } };
                    rec.students.push({ studentSlug: studentName, studentName: studentDisplay, startedAt: now, claimed: {} });
                    await _storage_js_1.kv.set(senseiKey(playerName), rec);
                    await _storage_js_1.kv.set(studentMarkerKey(studentName), playerName, { ex: 365 * 24 * 60 * 60 });
                    return { status: 200, body: { ok: true, student: studentDisplay } };
                }, { failClosed: true });
            }, { failClosed: true });
            if (out.status === 200)
                await _storage_js_1.kv.set(`${AUDIT_PREFIX}assign:${Date.now()}`, { ts: now, sensei: playerName, student: studentName }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }
        // ── CLAIM (pay reached-but-unclaimed milestones) ────────────────────────
        if (action === 'claim') {
            // Anti-alt: a same-connection pairing pays nothing (no laundering ryo/
            // seals to your main through an alt "student").
            if (!identity.admin) {
                try {
                    if (await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(playerName, studentName))
                        return res.status(403).json({ error: 'Mentor reward voided: you and the student share a connection.' });
                }
                catch { /* fail open */ }
            }
            const out = await (0, _lock_js_1.withKvLock)(senseiKey(playerName), async () => {
                const rec = loadRecord(await _storage_js_1.kv.get(senseiKey(playerName)));
                const entry = rec.students.find((s) => s.studentSlug === studentName);
                if (!entry)
                    return { status: 404, body: { error: 'That player is not your student.' } };
                const studentSave = await _storage_js_1.kv.get(`save:${studentName}`);
                const studentChar = (studentSave?.character ?? null);
                if (!studentSave || !studentChar)
                    return { status: 404, body: { error: 'Student save not found.' } };
                const claimable = (0, _mentor_js_1.claimableMilestones)({ onboardingStep: studentChar.onboardingStep, level: num(studentChar.level), rankedWins: num(studentChar.rankedWins) }, entry.claimed);
                if (claimable.length === 0)
                    return { status: 200, body: { ok: true, claimed: 0 } };
                const payout = (0, _mentor_js_1.mentorPayout)(claimable.length);
                // Credit the sensei (Honor Seals + clan contribution) under their save lock.
                const senseiOk = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                    const r = await _storage_js_1.kv.get(`save:${playerName}`);
                    const c = (r?.character ?? null);
                    if (!r || !c)
                        return false;
                    const next = (0, _save_version_js_1.bumpSaveVersion)({ ...r, character: { ...c, honorSeals: num(c.honorSeals) + payout.seals, clanEventContrib: num(c.clanEventContrib) + payout.contrib } });
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(next, r));
                    return true;
                }, { failClosed: true });
                if (!senseiOk)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                // Boost the student (ryo) under their save lock.
                await (0, _lock_js_1.withKvLock)(`save:${studentName}`, async () => {
                    const r = await _storage_js_1.kv.get(`save:${studentName}`);
                    const c = (r?.character ?? null);
                    if (r && c)
                        await _storage_js_1.kv.set(`save:${studentName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...r, character: { ...c, ryo: num(c.ryo) + payout.studentRyo } }), r));
                }, { failClosed: true });
                for (const m of claimable)
                    entry.claimed[m] = now;
                await _storage_js_1.kv.set(senseiKey(playerName), rec);
                return { status: 200, body: { ok: true, claimed: claimable.length, seals: payout.seals, contrib: payout.contrib, studentRyo: payout.studentRyo, milestones: claimable }, paid: claimable.length };
            }, { failClosed: true });
            if (out.paid)
                await _storage_js_1.kv.set(`${AUDIT_PREFIX}claim:${Date.now()}`, { ts: now, sensei: playerName, student: studentName, milestones: out.paid }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
            return res.status(out.status).json(out.body);
        }
        // ── RELEASE (end the pairing) ───────────────────────────────────────────
        if (action === 'release') {
            await (0, _lock_js_1.withKvLock)(senseiKey(playerName), async () => {
                const rec = loadRecord(await _storage_js_1.kv.get(senseiKey(playerName)));
                rec.students = rec.students.filter((s) => s.studentSlug !== studentName);
                await _storage_js_1.kv.set(senseiKey(playerName), rec);
            }, { failClosed: true });
            // Only clear the marker if it points at THIS sensei (don't free a student
            // who was re-assigned elsewhere in a race).
            const marker = await _storage_js_1.kv.get(studentMarkerKey(studentName));
            if (marker === playerName)
                await _storage_js_1.kv.del(studentMarkerKey(studentName)).catch(() => undefined);
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        console.error('[clan/mentor]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
