"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _jutsu_ryo_js_1 = require("./_jutsu-ryo.js");
const _jutsu_catalog_js_1 = require("../pvp/_jutsu-catalog.js");
const JUTSU_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{12,80}$/;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        const requestId = String(body.requestId ?? '');
        if (!playerName || !['start', 'complete', 'cancel', 'finish', 'queue', 'cancel-queue', 'advance'].includes(action) || !REQUEST_ID.test(requestId))
            return res.status(400).json({ error: 'Invalid jutsu training request.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your training.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'jutsu-ryo', 20, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ record, character }) => {
            const receipts = Array.isArray(character.redeemedJutsuTrainingActions) ? character.redeemedJutsuTrainingActions.slice(-127) : [];
            if (receipts.some((entry) => entry?.requestId === requestId))
                return { ok: true, character, recordPatch: { activeJutsuTraining: record.activeJutsuTraining ?? null }, value: { activeJutsuTraining: record.activeJutsuTraining ?? null, replayed: true, cost: 0, refund: 0 } };
            let changed;
            const jutsuIsKnown = (jutsuId) => {
                const learned = Array.isArray(character.jutsuMastery) && character.jutsuMastery.some((row) => row?.jutsuId === jutsuId);
                const customJutsus = [
                    ...(Array.isArray(record.creatorJutsus) ? record.creatorJutsus : []),
                    ...(Array.isArray(record.savedBloodlines) ? record.savedBloodlines.flatMap((bloodline) => Array.isArray(bloodline?.jutsus) ? bloodline.jutsus : []) : []),
                ];
                const customKnown = customJutsus.some((entry) => entry && typeof entry === 'object' && String(entry.id ?? '').toLowerCase() === jutsuId);
                return Boolean(_jutsu_catalog_js_1.JUTSU_CATALOG[jutsuId] || customKnown || learned);
            };
            if (action === 'start') {
                if (record.activeJutsuTraining)
                    return { ok: false, status: 409, error: 'jutsu-training-already-active' };
                const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase();
                if (!JUTSU_ID.test(jutsuId))
                    return { ok: false, status: 400, error: 'invalid-jutsu-id' };
                if (!jutsuIsKnown(jutsuId))
                    return { ok: false, status: 409, error: 'unknown-or-unowned-jutsu' };
                changed = (0, _jutsu_ryo_js_1.startJutsuRyoTraining)(character, jutsuId, String(body.label ?? jutsuId), (0, node_crypto_1.randomUUID)().replace(/-/g, ''), Date.now(), body.trainingBonusPct);
            }
            else {
                const active = record.activeJutsuTraining && typeof record.activeJutsuTraining === 'object' ? record.activeJutsuTraining : null;
                if (!active || active.serverToken !== String(body.serverToken ?? ''))
                    return { ok: false, status: 409, error: 'invalid-or-legacy-jutsu-training' };
                if (action === 'queue') {
                    const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase();
                    if (!JUTSU_ID.test(jutsuId) || !jutsuIsKnown(jutsuId))
                        return { ok: false, status: 409, error: 'unknown-or-unowned-jutsu' };
                    changed = (0, _jutsu_ryo_js_1.queueJutsuRyoTraining)(character, active, jutsuId, String(body.label ?? jutsuId), (0, node_crypto_1.randomUUID)().replace(/-/g, ''), body.trainingBonusPct);
                }
                else if (action === 'cancel-queue') {
                    changed = (0, _jutsu_ryo_js_1.cancelQueuedJutsuRyoTraining)(character, active);
                }
                else if (action === 'advance') {
                    changed = (0, _jutsu_ryo_js_1.advanceQueuedJutsuRyoTraining)(character, active, Date.now());
                }
                else {
                    changed = (0, _jutsu_ryo_js_1.settleJutsuRyoTraining)(character, active, action, Date.now());
                    if (changed.ok && (action === 'complete' || action === 'finish') && active.next) {
                        const startedAt = Date.now();
                        changed = {
                            ...changed,
                            active: {
                                serverToken: active.next.serverToken,
                                jutsuId: active.next.jutsuId,
                                label: active.next.label,
                                fromLevel: active.next.fromLevel,
                                toLevel: active.next.toLevel,
                                ryoCost: active.next.ryoCost,
                                startedAt,
                                endsAt: startedAt + active.next.durationMs,
                                next: null,
                                autoClaim: true,
                            },
                        };
                    }
                }
            }
            if (!changed.ok)
                return { ok: false, status: 409, error: changed.reason };
            const nextCharacter = { ...changed.character, redeemedJutsuTrainingActions: [...receipts, { requestId, action }].slice(-128) };
            return { ok: true, character: nextCharacter, recordPatch: { activeJutsuTraining: changed.active }, value: { activeJutsuTraining: changed.active, replayed: false, cost: changed.cost, refund: 'refund' in changed ? changed.refund : 0 } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[training/jutsu-ryo]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
