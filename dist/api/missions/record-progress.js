"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _mission_progress_receipt_js_1 = require("./_mission-progress-receipt.js");
const PROGRESS_RECEIPT_TTL_SECONDS = 14 * 24 * 60 * 60;
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
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!missionId || !kind)
            return res.status(400).json({ error: 'Invalid mission progress event.' });
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
        const key = (0, _mission_progress_receipt_js_1.missionProgressReceiptKey)(playerName, missionId);
        const receipt = await (0, _lock_js_1.withKvLock)(key, async () => {
            const existing = (0, _mission_progress_receipt_js_1.cleanMissionProgressReceipt)(await _storage_js_1.kv.get(key));
            const next = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(existing, {
                playerName,
                missionId,
                missionType,
                kind,
                exploreTarget: mission.exploreCount,
                raidTarget: mission.raidCount ?? 0,
            });
            await _storage_js_1.kv.set(key, next, { ex: PROGRESS_RECEIPT_TTL_SECONDS });
            return next;
        }, { failClosed: true });
        return res.status(200).json({
            ok: true,
            recorded: true,
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
