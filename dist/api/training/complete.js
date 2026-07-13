"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _grant_js_1 = require("./_grant.js");
const _legacy_js_1 = require("./_legacy.js");
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
        const now = Date.now();
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ record, character }) => {
            const redeemed = Array.isArray(character.redeemedTrainingTokens)
                ? character.redeemedTrainingTokens.filter((v) => !!v && typeof v === 'object' && typeof v.token === 'string')
                : [];
            const legacyData = legacy ? (0, _legacy_js_1.parseLegacyTraining)(record.activeTraining) : null;
            const priorLegacy = legacy && !record.activeTraining
                ? [...redeemed].reverse().find((entry) => entry.token.startsWith('legacy'))
                : undefined;
            if (priorLegacy) {
                return {
                    ok: true,
                    character,
                    recordPatch: { activeTraining: null },
                    value: { granted: true, alreadyGranted: true, ...priorLegacy },
                };
            }
            if (legacy && !legacyData)
                return { ok: false, status: 409, error: 'No eligible legacy training session was found.' };
            const redemptionToken = legacyData?.token ?? token;
            const prior = redeemed.find((entry) => entry.token === redemptionToken);
            if (prior) {
                return {
                    ok: true,
                    character,
                    recordPatch: { activeTraining: null },
                    value: { granted: true, alreadyGranted: true, ...prior },
                };
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
            const grant = (0, _grant_js_1.applyTrainingGrant)(character, data.stat, gain, xp);
            const redemption = { token: redemptionToken, stat: data.stat, gain, xp, applied: grant.applied, cap: grant.cap };
            return {
                ok: true,
                character: { ...grant.character, redeemedTrainingTokens: [...redeemed.slice(-99), redemption] },
                recordPatch: { activeTraining: null },
                value: { granted: true, alreadyGranted: false, ...redemption },
            };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        if (tokenKey)
            await _storage_js_1.kv.del(tokenKey).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
