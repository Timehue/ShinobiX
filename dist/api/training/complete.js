"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _grant_js_1 = require("./_grant.js");
const _legacy_js_1 = require("./_legacy.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _session_js_1 = require("./_session.js");
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
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'training-complete', 8, 30_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
        const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
        const legacy = body.legacy === true;
        const cancel = body.cancel === true;
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!token && !legacy)
            return res.status(400).json({ error: 'Missing training token.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only complete your own training.' });
        const tokenKey = token ? `training-token:${playerName}:${token}` : '';
        const saveKey = `save:${playerName}`;
        const now = Date.now();
        const result = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const character = record?.character;
            if (!record || !character)
                return { ok: false, status: 404, error: 'Player save not found.' };
            const receipts = Array.isArray(record._trainingReceipts)
                ? record._trainingReceipts.filter((v) => typeof v === 'string')
                : [];
            const legacyData = legacy ? (0, _legacy_js_1.parseLegacyTraining)(record.activeTraining) : null;
            if (legacy && !legacyData)
                return { ok: false, status: 409, error: 'No eligible legacy training session was found.' };
            const redemptionToken = legacyData?.token ?? token;
            if (receipts.includes(token)) {
                return { ok: true, character, _saveVersion: Number(record._saveVersion ?? 0), value: { granted: true, alreadyGranted: true, token: redemptionToken } };
            }
            const data = legacyData ?? await _storage_js_1.kv.get(tokenKey);
            if (!data)
                return { ok: false, status: 409, error: 'Training token is invalid or already spent.' };
            if ('playerName' in data && (data.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return { ok: false, status: 403, error: 'Training token does not belong to this player.' };
            }
            if (!cancel && now < data.endsAt) {
                return { ok: false, status: 409, error: `Training is not finished. ${data.endsAt - now}ms remaining.` };
            }
            let gain = Math.max(0, Math.floor(data.sealedGain));
            let xp = Math.max(0, Math.floor(data.sealedXp));
            if (cancel) {
                const totalMs = data.endsAt - data.startedAt;
                const fraction = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
                gain = Math.floor(gain * fraction);
                xp = Math.floor(xp * fraction);
            }
            const leveled = (0, _xp_engine_js_1.gainXp)(character, xp);
            const grant = (0, _grant_js_1.applyTrainingGrant)(leveled, data.stat, gain, 0);
            const redemption = { token: redemptionToken, stat: data.stat, gain, xp, applied: grant.applied, cap: grant.cap };
            const nextReceipts = [...receipts.filter((entry) => entry !== redemptionToken), redemptionToken].slice(-_session_js_1.MAX_TRAINING_RECEIPTS);
            const nextCharacter = { ...grant.character, redeemedTrainingTokens: [redemption] };
            const written = await (0, _mutate_player_save_js_1.writeVersionedPlayerSave)(saveKey, {
                ...record,
                _trainingReceipts: nextReceipts,
                activeTraining: null,
            }, nextCharacter);
            return { ok: true, character: nextCharacter, _saveVersion: written._saveVersion, value: { granted: true, alreadyGranted: false, ...redemption } };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        if (tokenKey)
            await _storage_js_1.kv.del(tokenKey).catch(() => console.error('active-session cleanup failed after durable receipt'));
        await _storage_js_1.kv.del(`training-active:${playerName}`).catch(() => console.error('active-session cleanup failed after durable receipt'));
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
