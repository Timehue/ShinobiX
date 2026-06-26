"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _map_control_reward_js_1 = require("../_map-control-reward.js");
const _save_version_js_1 = require("../save/_save-version.js");
/*
 * /api/village/claim-map-control  — POST only
 *
 * Server-authoritative PERSONAL "Map Control" daily reward (audit #7 / Stage 3
 * Phase 2, map-control half). The old flow let the CLIENT compute the reward —
 * which scales with the number of world sectors the player's VILLAGE controls
 * (villageOwnedTerritories(village).length) — apply it to its own save, and
 * persist via the save blob, so a crafted client could claim any sector count
 * (inflate the amount) and repeat across rolled dates. The save sanitizer could
 * only cap ryo/seals/charms/shards, never verify the sector count.
 *
 * This endpoint OWNS both halves:
 *   1. Sector count — scanned from the canonical world:territory:* records
 *      (ownerVillage === village), mirroring the client's villageOwnedTerritories.
 *      The client can no longer fake it.
 *   2. Payout — computed server-side by the verbatim-ported computeMapControlReward
 *      (api/_map-control-reward.ts, tested server==client) and credited to the
 *      player's OWN save under lock:save:<name> (the autosave's lock — option A)
 *      with an NX day-marker placed atomically inside the lock: exactly-once,
 *      failClosed → 503/retry. The client adds the returned `granted` delta to
 *      its OWN balance (preserving concurrent gains) and re-asserts via autosave;
 *      the two converge.
 *
 * Like the agenda personal half, the sanitizer stays PERMISSIVE for these
 * currencies (ryo/honorSeals/boneCharms/fateShards all have other legit client
 * sources — missions/raids/hunts — until later Stage-3 phases move those too).
 * This closes the map-control claim-repeatedly / inflate-the-sector-count vector.
 *
 * The village-state contributionPoints credit stays client-side (village state,
 * not personal currency — the village-state validator governs it), but the
 * client now increments it by the SERVER-returned sector count, so it can't be
 * inflated past the true owned-sector count.
 *
 * Body: { playerName, village }. Caller MUST be the player (or admin) and a
 * member of `village`. Rate-limited 30/min per actor.
 */
const TERRITORY_KEY_PREFIX = 'world:territory:';
const CLAIM_MARKER_TTL_SEC = 2 * 24 * 60 * 60; // 2 days — comfortably past one UTC day
const AUDIT_LOG_PREFIX = 'audit:village-map-control:';
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function utcDate() {
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
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village)
            return res.status(400).json({ error: 'Missing playerName or village.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-map-control', 30, 60_000, identity.name)))
            return;
        // Membership: the caller's character must belong to this village (admin exempt).
        if (!identity.admin) {
            const donorRec = await _storage_js_1.kv.get(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null);
            if (!donorChar)
                return res.status(404).json({ error: 'Your save was not found.' });
            if (String(donorChar.village ?? '').trim() !== village) {
                return res.status(403).json({ error: 'You are not a member of this village.' });
            }
        }
        // ── Server-authoritative sector count. Scan the canonical world-state
        // territory records and count the ones this village owns (mirrors the
        // client's villageOwnedTerritories: ownerVillage === village). Read
        // outside the save lock — territories are not part of the player save;
        // a snapshot count is exactly what the client used too.
        const territoryKeys = await _storage_js_1.kv.keys(`${TERRITORY_KEY_PREFIX}*`);
        const territories = territoryKeys.length
            ? (await _storage_js_1.kv.mget(...territoryKeys)).filter(Boolean)
            : [];
        const sectors = territories.filter((t) => String(t.ownerVillage ?? '').trim() === village).length;
        if (sectors <= 0) {
            // Mirrors the client guard ("Your village does not control any sectors
            // yet."). No marker placed, so the player can claim once they own one.
            return res.status(400).json({ error: 'Your village does not control any sectors yet.' });
        }
        const date = utcDate();
        const marker = `map-control-personal:${playerName.toLowerCase()}:${date}`;
        // ── Credit the player's OWN map-control reward under lock:save:<name> (the
        // autosave's lock) with the NX day-marker placed atomically inside the
        // lock: exactly-once, and a contention abort (failClosed → 503) leaves
        // nothing placed for a clean retry (the claim-rewards pattern). isVanguard
        // is read from the locked save so honorSeals are credited correctly.
        let result;
        try {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { error: 'no-save' };
                const isVanguard = char.profession === 'vanguard';
                const granted = (0, _map_control_reward_js_1.computeMapControlReward)(sectors, isVanguard);
                const placed = await _storage_js_1.kv.set(marker, { ts: Date.now() }, { nx: true, ex: CLAIM_MARKER_TTL_SEC });
                if (placed !== 'OK') {
                    return { alreadyClaimed: true, granted: { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 } };
                }
                const nextChar = {
                    ...char,
                    ryo: num(char.ryo) + granted.ryo,
                    honorSeals: num(char.honorSeals) + granted.honorSeals,
                    boneCharms: num(char.boneCharms) + granted.boneCharms,
                    fateShards: num(char.fateShards) + granted.fateShards,
                };
                const next = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: nextChar });
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(next, rec));
                return { alreadyClaimed: false, granted };
            }, { failClosed: true });
            if ('error' in out)
                return res.status(404).json({ error: 'Your save was not found.' });
            result = out;
        }
        catch (e) {
            console.error('[village/claim-map-control] credit failed', e);
            return res.status(503).json({ error: 'Could not credit your map control reward — please retry.' });
        }
        if (!result.alreadyClaimed) {
            await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${villageSlugForAudit(village)}:${Date.now()}`, {
                ts: Date.now(),
                actor: identity.admin ? 'admin' : identity.name,
                village,
                player: playerName,
                sectors,
                granted: result.granted,
            }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(200).json({ ok: true, sectors, alreadyClaimed: result.alreadyClaimed, granted: result.granted });
    }
    catch (err) {
        console.error('[village/claim-map-control]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
function villageSlugForAudit(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
