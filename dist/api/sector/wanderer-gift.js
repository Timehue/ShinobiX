"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _wanderer_gift_js_1 = require("./_wanderer-gift.js");
const _wanderer_encounter_js_1 = require("./_wanderer-encounter.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _era_js_1 = require("../_era.js");
/*
 * /api/sector/wanderer-gift — POST only
 *
 * A friendly sector Wanderer hands the player a small gift. Server-authoritative:
 * the reward is RECOMPUTED here (never read from the client) and bounded by a
 * per-day cap, so it can't be farmed into a ryo faucet. Mirrors the
 * recompute-server-side pattern in docs/auth-and-anti-cheat-patterns.md.
 *
 * Body: { playerName, sector?, wandererId }
 * → { ok:true, ryo, totalRyo, claimsLeft } | { ok:false, reason }
 */
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
        if (!(0, _wanderer_encounter_js_1.parseNaturalWandererId)(wandererId)) {
            return res.status(200).json({ ok: false, reason: 'invalid-wanderer' });
        }
        const sector = Math.max(1, Math.min(60, Math.floor(Number(body.sector ?? 0)) || 0));
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'wanderer-gift', 12, 60_000, identity.name)))
            return;
        const dayKey = `wanderer-gift:${playerName}:${utcDateKey()}`;
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
            const claimsSoFar = Math.max(0, Number((await _storage_js_1.kv.get(dayKey)) ?? 0));
            const decision = (0, _wanderer_gift_js_1.decideWandererGift)(claimsSoFar);
            if (!decision.ok) {
                return { status: 200, body: { ok: false, reason: decision.reason, claimsLeft: 0 } };
            }
            const hardCooldown = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(_storage_js_1.kv, playerName, wandererId, now);
            if (!hardCooldown.ok) {
                return {
                    status: 200,
                    body: { ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil },
                };
            }
            // Burn the daily slot after save/cooldown eligibility is verified.
            // The save lock serializes this player's gift requests, so a full
            // daily cap rejects above without spending this wanderer cooldown.
            const countAfter = await _storage_js_1.kv.incr(dayKey, { ex: 25 * 60 * 60 });
            // Roll the bundle SERVER-SIDE (never trust the client) and grant it.
            const gift = (0, _wanderer_gift_js_1.rollWandererGift)(Number(char.level ?? 1), Math.random);
            const rewarded = {
                ...char,
                ryo: Number(char.ryo ?? 0) + gift.ryo,
                fateShards: Number(char.fateShards ?? 0) + gift.fateShards,
                boneCharms: Number(char.boneCharms ?? 0) + gift.boneCharms,
            };
            const used = (0, _wanderer_encounter_js_1.withWandererUseState)(rewarded, wandererId, now, sector);
            const updated = used.character;
            const record = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated });
            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(record, rec));
            return {
                status: 200,
                body: {
                    ok: true,
                    gift,
                    totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    claimsLeft: Math.max(0, _wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY - countAfter),
                    cooldownUntil: used.cooldownUntil,
                    moveToSector: used.moveToSector,
                },
            };
        }, { failClosed: true });
        // Legacy tracking (ENABLE_LEGACY): a wanderer encounter is a sector
        // discovery. Rides the same daily cap as the gift itself.
        if (out.status === 200 && out.body?.ok === true) {
            await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { sectorDiscoveries: 1 });
            await (0, _era_js_1.bumpEraContribution)('discoveries');
        }
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not grant the gift — please retry.' });
        }
        console.error('[sector/wanderer-gift]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
