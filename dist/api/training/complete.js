"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const formulas_js_1 = require("../combat-core/formulas.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
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
        const cancel = body.cancel === true;
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!token)
            return res.status(400).json({ error: 'Missing training token.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only complete your own training.' });
        }
        const tokenKey = `training-token:${playerName}:${token}`;
        const saveKey = `save:${playerName}`;
        const activeKey = `training-active:${playerName}`;
        const outcome = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const character = (record?.character ?? null);
            if (!record || !character) {
                return { status: 404, body: { error: 'Player save not found.' } };
            }
            const activeRaw = await _storage_js_1.kv.get(activeKey);
            const active = (0, _session_js_1.normalizeActiveTrainingSession)(activeRaw);
            const activeMatches = (0, _session_js_1.activeTrainingMatches)(active, token);
            const persistedActive = record.activeTraining && typeof record.activeTraining === 'object'
                ? record.activeTraining
                : null;
            const persistedToken = typeof persistedActive?.token === 'string' ? persistedActive.token : '';
            const staleSessionMatches = activeMatches || (!active && persistedToken === token);
            const receipts = Array.isArray(record._trainingReceipts)
                ? record._trainingReceipts.filter((value) => typeof value === 'string').slice(-_session_js_1.MAX_TRAINING_RECEIPTS)
                : [];
            if (receipts.includes(token)) {
                await _storage_js_1.kv.del(tokenKey).catch(() => undefined);
                if (activeMatches)
                    await _storage_js_1.kv.del(activeKey).catch(() => undefined);
                return { status: 200, body: { ok: true, granted: false, reason: 'already-granted' } };
            }
            const data = await _storage_js_1.kv.get(tokenKey);
            if (!data) {
                // The token TTL and active lease share an expiry. If either was
                // lost independently, clear only the matching stale lease. No
                // reward is granted without the sealed token.
                if (staleSessionMatches) {
                    await (0, _mutate_player_save_js_1.writeVersionedPlayerSave)(saveKey, { ...record, activeTraining: null }, character);
                    if (activeMatches)
                        await _storage_js_1.kv.del(activeKey).catch(() => undefined);
                }
                return {
                    status: 200,
                    body: { ok: true, granted: false, reason: 'invalid-or-spent-token', staleSessionCleared: staleSessionMatches },
                };
            }
            if ((data.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return { status: 403, body: { error: 'Training token does not belong to this player.' } };
            }
            if (active && !activeMatches) {
                return { status: 409, body: { error: 'This is not the active training session.' } };
            }
            const now = Date.now();
            if (!cancel && now < data.endsAt) {
                return {
                    status: 200,
                    body: { ok: true, granted: false, reason: 'not-yet-complete', remainingMs: data.endsAt - now },
                };
            }
            let gain = Math.max(0, Math.floor(data.sealedGain));
            let xp = Math.max(0, Math.floor(data.sealedXp));
            if (cancel) {
                const totalMs = data.endsAt - data.startedAt;
                const frac = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
                gain = Math.floor(gain * frac);
                xp = Math.floor(xp * frac);
            }
            const leveled = (0, _xp_engine_js_1.gainXp)(character, xp);
            const stats = (leveled.stats && typeof leveled.stats === 'object')
                ? leveled.stats
                : {};
            const currentStat = Math.max(0, Math.floor(Number(stats[data.stat]) || 0));
            const cap = (0, formulas_js_1.statCapForLevel)(Math.max(1, Math.floor(Number(leveled.level) || 1)));
            const applied = Math.max(0, Math.min(gain, cap - currentStat));
            const nextCharacter = {
                ...leveled,
                totalStatsTrained: Math.max(0, Math.floor(Number(leveled.totalStatsTrained) || 0)) + applied,
                stats: { ...stats, [data.stat]: currentStat + applied },
            };
            const nextReceipts = [...receipts.filter((receipt) => receipt !== token), token].slice(-_session_js_1.MAX_TRAINING_RECEIPTS);
            const saved = await (0, _mutate_player_save_js_1.writeVersionedPlayerSave)(saveKey, { ...record, _trainingReceipts: nextReceipts, activeTraining: null }, nextCharacter);
            await _storage_js_1.kv.del(tokenKey).catch((error) => {
                console.error('[training/complete] token cleanup failed after durable receipt:', error);
            });
            if (activeMatches) {
                await _storage_js_1.kv.del(activeKey).catch((error) => {
                    console.error('[training/complete] active-session cleanup failed after durable receipt:', error);
                });
            }
            return {
                status: 200,
                body: {
                    ok: true,
                    granted: true,
                    stat: data.stat,
                    gain,
                    applied,
                    xp,
                    cap,
                    character: nextCharacter,
                    _saveVersion: saved._saveVersion,
                },
            };
        }, { failClosed: true });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
