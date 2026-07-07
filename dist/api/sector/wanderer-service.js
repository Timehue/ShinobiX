"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _wanderer_encounter_js_1 = require("./_wanderer-encounter.js");
const _wanderer_service_js_1 = require("./_wanderer-service.js");
const _era_js_1 = require("../_era.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const FAVOR_TTL_SECONDS = 24 * 60 * 60;
const favorKeyFor = (playerName) => `wanderer-favor:${playerName}`;
function num(v) {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}
function int(v) {
    return Math.floor(num(v));
}
function cleanShortText(v, fallback) {
    const s = String(v ?? '').replace(/[^\w .'-]/g, '').trim().slice(0, 48);
    return s || fallback;
}
function sectorFrom(v) {
    return Math.max(1, Math.min(60, int(v) || 1));
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `wanderer-service-${action}`, 20, 60_000, identity.name)))
            return;
        if (action === 'merchant' || action === 'medic' || action === 'favor-start') {
            const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
            if (!(0, _wanderer_encounter_js_1.parseNaturalWandererId)(wandererId)) {
                return res.status(200).json({ ok: false, reason: 'invalid-wanderer' });
            }
            const sector = sectorFrom(body.sector);
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const now = Date.now();
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                const saveCooldownUntil = (0, _wanderer_encounter_js_1.currentWandererCooldownUntil)(char, wandererId, now);
                if (saveCooldownUntil) {
                    return { status: 200, body: { ok: false, reason: 'cooldown', cooldownUntil: saveCooldownUntil } };
                }
                if (action === 'merchant') {
                    const offer = (0, _wanderer_service_js_1.wandererMerchantOffer)(char.level, wandererId);
                    if (num(char.ryo) < offer.cost) {
                        return { status: 200, body: { ok: false, reason: 'no-ryo', offer } };
                    }
                    const hardCooldown = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(_storage_js_1.kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                    }
                    const spent = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        boneCharms: num(char.boneCharms) + offer.boneCharms,
                    };
                    const used = (0, _wanderer_encounter_js_1.withWandererUseState)(spent, wandererId, now, sector);
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: used.character }), rec));
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            offer,
                            totals: { ryo: used.character.ryo, boneCharms: used.character.boneCharms },
                            cooldownUntil: used.cooldownUntil,
                            moveToSector: used.moveToSector,
                        },
                    };
                }
                if (action === 'medic') {
                    const offer = (0, _wanderer_service_js_1.wandererMedicOffer)(char.level, char.hp, char.maxHp, char.chakra, char.maxChakra, char.stamina, char.maxStamina);
                    if (offer.missingHp + offer.missingChakra + offer.missingStamina <= 0) {
                        return { status: 200, body: { ok: false, reason: 'already-well', offer } };
                    }
                    if (num(char.ryo) < offer.cost) {
                        return { status: 200, body: { ok: false, reason: 'no-ryo', offer } };
                    }
                    const hardCooldown = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(_storage_js_1.kv, playerName, wandererId, now);
                    if (!hardCooldown.ok) {
                        return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                    }
                    const healed = {
                        ...char,
                        ryo: num(char.ryo) - offer.cost,
                        hp: Math.max(num(char.hp), num(char.maxHp)),
                        chakra: Math.max(num(char.chakra), num(char.maxChakra)),
                        stamina: Math.max(num(char.stamina), num(char.maxStamina)),
                    };
                    const used = (0, _wanderer_encounter_js_1.withWandererUseState)(healed, wandererId, now, sector);
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: used.character }), rec));
                    return {
                        status: 200,
                        body: {
                            ok: true,
                            offer,
                            totals: {
                                ryo: used.character.ryo,
                                hp: used.character.hp,
                                chakra: used.character.chakra,
                                stamina: used.character.stamina,
                            },
                            cooldownUntil: used.cooldownUntil,
                            moveToSector: used.moveToSector,
                        },
                    };
                }
                const favorKey = favorKeyFor(playerName);
                const existing = await _storage_js_1.kv.get(favorKey);
                if (existing && num(existing.expiresAt) > now) {
                    return { status: 200, body: { ok: false, reason: 'busy', favor: existing } };
                }
                if (existing)
                    await _storage_js_1.kv.del(favorKey).catch(() => undefined);
                const hardCooldown = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(_storage_js_1.kv, playerName, wandererId, now);
                if (!hardCooldown.ok) {
                    return { status: 200, body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil } };
                }
                const favor = {
                    id: `favor-${wandererId}-${now}`,
                    originSector: sector,
                    targetSector: (0, _wanderer_service_js_1.wandererFavorTargetSector)(wandererId, sector),
                    giver: cleanShortText(body.wandererName, 'road courier'),
                    expiresAt: now + FAVOR_TTL_SECONDS * 1000,
                };
                await _storage_js_1.kv.set(favorKey, favor, { ex: FAVOR_TTL_SECONDS });
                const used = (0, _wanderer_encounter_js_1.withWandererUseState)({ ...char, activeWandererFavor: favor }, wandererId, now, sector);
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: used.character }), rec));
                return {
                    status: 200,
                    body: {
                        ok: true,
                        favor,
                        cooldownUntil: used.cooldownUntil,
                        moveToSector: used.moveToSector,
                    },
                };
            }, { failClosed: true });
            if (out.status === 200 && out.body?.ok === true) {
                await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { sectorDiscoveries: 1 });
                await (0, _era_js_1.bumpEraContribution)('discoveries');
            }
            return res.status(out.status).json(out.body);
        }
        if (action === 'favor-claim') {
            const favorId = typeof body.favorId === 'string' ? body.favorId.trim() : '';
            const sector = sectorFrom(body.sector);
            if (!favorId)
                return res.status(400).json({ error: 'Missing favorId.' });
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const now = Date.now();
                const favorKey = favorKeyFor(playerName);
                const favor = await _storage_js_1.kv.get(favorKey);
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (!favor || favor.id !== favorId) {
                    const cleared = { ...char, activeWandererFavor: null };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: cleared }), rec));
                    return { status: 200, body: { ok: false, reason: 'none' } };
                }
                if (num(favor.expiresAt) <= now) {
                    await _storage_js_1.kv.del(favorKey).catch(() => undefined);
                    const cleared = { ...char, activeWandererFavor: null };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: cleared }), rec));
                    return { status: 200, body: { ok: false, reason: 'expired' } };
                }
                if (sector !== favor.targetSector) {
                    return { status: 200, body: { ok: false, reason: 'wrong-sector', favor } };
                }
                const reward = (0, _wanderer_service_js_1.wandererFavorReward)(char.level, favor.id);
                await _storage_js_1.kv.del(favorKey).catch(() => undefined);
                const updated = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                    activeWandererFavor: null,
                };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                return {
                    status: 200,
                    body: {
                        ok: true,
                        reward,
                        totals: { ryo: updated.ryo, boneCharms: updated.boneCharms },
                    },
                };
            }, { failClosed: true });
            if (out.status === 200 && out.body?.ok === true) {
                await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { sectorDiscoveries: 1 });
                await (0, _era_js_1.bumpEraContribution)('discoveries');
            }
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'The road is busy - please retry.' });
        }
        console.error('[sector/wanderer-service]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
