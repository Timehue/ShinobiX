"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _run_token_js_1 = require("./_run-token.js");
const _combat_session_js_1 = require("./_combat-session.js");
const COSTS = { sanctify: 14, 'arm-second-wind': 30 };
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
function isAction(value) {
    return value === 'sanctify' || value === 'arm-second-wind' || value === 'consume-second-wind';
}
/** Authoritative settlement-affecting Hollow Shard consumables. */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const action = body.action;
        if (!playerName || !token || !isAction(action))
            return res.status(400).json({ error: 'Invalid Hollow Gate consumable.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'hollow-gate-consumable', 30, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        const runKey = (0, _run_token_js_1.hollowGateRunKey)(playerName, token);
        const result = await (0, _lock_js_1.withKvLock)(runKey, async () => {
            const run = await _storage_js_1.kv.get(runKey);
            if (!run || run.playerName !== playerName)
                return { status: 409, body: { error: _run_token_js_1.HOLLOW_GATE_RUN_EXPIRED_MESSAGES.consumable } };
            if (run.activeEncounter)
                return { status: 409, body: { error: 'Finish the active encounter first.' } };
            if (action === 'arm-second-wind' && run.secondWindArmed)
                return { status: 409, body: { error: 'Second Wind is already armed.' } };
            if (action === 'consume-second-wind' && !run.secondWindArmed)
                return { status: 200, body: { ok: true, alreadyReported: true } };
            const saveKey = `save:${playerName}`;
            const saved = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const record = await _storage_js_1.kv.get(saveKey);
                const char = record?.character;
                if (!record || !char)
                    return null;
                const savedRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
                    ? char.hollowGateRun
                    : null;
                if (savedRun?.runToken && savedRun.runToken !== token)
                    return { error: 'The saved run does not match the sealed run.' };
                const cost = action === 'consume-second-wind' ? 0 : COSTS[action];
                if (num(char.hollowShards) < cost)
                    return { error: 'Not enough Hollow Shards.' };
                const nextChar = { ...char, hollowShards: Math.max(0, Math.floor(num(char.hollowShards) - cost)) };
                let nextRun = { ...run };
                let nextSavedRun = savedRun ? { ...savedRun } : null;
                if (action === 'sanctify') {
                    const entry = {};
                    for (const key of _run_token_js_1.HG_CLAWBACK_KEYS)
                        entry[key] = Math.max(0, Math.floor(num(nextChar[key])));
                    nextRun = { ...nextRun, entryCurrencies: entry, serverCreditedCurrencies: {} };
                    if (nextSavedRun)
                        nextSavedRun = { ...nextSavedRun, entryCurrencies: entry };
                }
                else {
                    const armed = action === 'arm-second-wind';
                    nextRun = { ...nextRun, secondWindArmed: armed };
                    if (nextSavedRun)
                        nextSavedRun = { ...nextSavedRun, secondWindArmed: armed };
                }
                if (nextSavedRun)
                    nextChar.hollowGateRun = nextSavedRun;
                const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...record, character: nextChar });
                await _storage_js_1.kv.set(runKey, nextRun, { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
                try {
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
                }
                catch (error) {
                    await _storage_js_1.kv.set(runKey, run, { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS }).catch(() => undefined);
                    throw error;
                }
                return {
                    character: nextChar,
                    saveVersion: Number(updated._saveVersion ?? 0),
                    entryCurrencies: nextRun.entryCurrencies,
                    secondWindArmed: nextRun.secondWindArmed === true,
                };
            }, { failClosed: true, ttlSec: 10 });
            if (!saved)
                return { status: 404, body: { error: 'Player save not found.' } };
            if ('error' in saved)
                return { status: 409, body: { error: saved.error } };
            return { status: 200, body: {
                    ok: true,
                    action,
                    character: saved.character,
                    entryCurrencies: saved.entryCurrencies,
                    secondWindArmed: saved.secondWindArmed,
                    _saveVersion: saved.saveVersion,
                } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        console.error('[hollow-gate/use-consumable]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
