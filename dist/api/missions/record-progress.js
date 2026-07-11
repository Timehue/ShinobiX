"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _eligibility_js_1 = require("./_eligibility.js");
const _mission_progress_receipt_js_1 = require("./_mission-progress-receipt.js");
const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;
// Authentication proves the account, not the gameplay event. Each call must
// redeem a private, single-use evidence row issued by an authoritative travel,
// combat, or raid service for this exact player + mission + event kind.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'mission-record-progress', 30, 10_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const missionId = String(body.missionId ?? '').slice(0, 80);
        const kind = (0, _mission_progress_receipt_js_1.cleanMissionProgressEventKind)(body.kind);
        const evidenceToken = (0, _mission_progress_receipt_js_1.cleanMissionProgressEvidenceToken)(body.evidenceToken);
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!missionId || !kind)
            return res.status(400).json({ error: 'Invalid mission progress event.' });
        if (!evidenceToken) {
            return res.status(403).json({
                ok: false,
                recorded: false,
                reason: 'server-evidence-required',
                error: 'A server-issued mission progress token is required.',
            });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only record your own mission progress.' });
        }
        const missionType = (0, _mission_progress_receipt_js_1.missionProgressTypeForKind)(kind);
        const mission = missionType === 'hunt' ? (0, _mission_catalog_js_1.huntMissionById)(missionId) : (0, _mission_catalog_js_1.fieldMissionById)(missionId);
        if (!mission) {
            return res.status(200).json({ ok: true, recorded: false, reason: 'unknown-mission' });
        }
        if (missionType === 'field' && (0, _mission_catalog_js_1.huntMissionById)(missionId)) {
            return res.status(200).json({ ok: true, recorded: false, reason: 'wrong-mission-type' });
        }
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = record?.character;
        const eligibility = (0, _eligibility_js_1.canPlayerReceiveMission)(char ?? {}, mission);
        if (!eligibility.ok) {
            return res.status(403).json({ ok: false, recorded: false, ...(0, _eligibility_js_1.missionEligibilityFailureBody)(eligibility) });
        }
        const key = (0, _mission_progress_receipt_js_1.missionProgressReceiptKey)(playerName, missionId);
        const evidenceKey = (0, _mission_progress_receipt_js_1.missionProgressEvidenceKey)(playerName, evidenceToken);
        const result = await (0, _lock_js_1.withKvLock)(key, () => (0, _lock_js_1.withKvLock)(evidenceKey, async () => {
            const evidence = (0, _mission_progress_receipt_js_1.cleanMissionProgressEvidence)(await _storage_js_1.kv.get(evidenceKey));
            const evidenceCheck = (0, _mission_progress_receipt_js_1.validateMissionProgressEvidence)(evidence, {
                evidenceId: evidenceToken,
                playerName,
                missionId,
                kind,
            });
            if (!evidenceCheck.ok)
                return { ok: false, reason: evidenceCheck.reason };
            const existing = (0, _mission_progress_receipt_js_1.cleanMissionProgressReceipt)(await _storage_js_1.kv.get(key));
            const duplicate = existing?.evidenceIds.includes(evidenceToken) === true;
            const next = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(existing, {
                playerName,
                missionId,
                missionType,
                kind,
                exploreTarget: mission.exploreCount,
                raidTarget: mission.raidCount ?? 0,
                evidenceId: evidenceToken,
            });
            await _storage_js_1.kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            // Consume only after the idempotent receipt write. If deletion throws,
            // a retry sees the same evidence id in `next` and cannot increment it
            // twice; if the row disappeared unexpectedly, fail closed.
            const consumed = await _storage_js_1.kv.del(evidenceKey);
            if (consumed <= 0 && !duplicate)
                throw new Error('Mission progress evidence disappeared before consumption.');
            return { ok: true, receipt: next, duplicate };
        }, { failClosed: true }), { failClosed: true });
        if (!result.ok) {
            return res.status(403).json({ ok: false, recorded: false, reason: result.reason });
        }
        const { receipt } = result;
        return res.status(200).json({
            ok: true,
            recorded: !result.duplicate,
            duplicate: result.duplicate,
            progress: {
                exploreCount: receipt.exploreCount,
                raidCount: receipt.raidCount,
                huntKill: receipt.huntKill,
            },
        });
    }
    catch (err) {
        console.error('[missions/record-progress]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
