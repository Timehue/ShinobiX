"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_score_js_1 = require("../_legacy-score.js");
const _legacy_defs_js_1 = require("../_legacy-defs.js");
const _legacy_core_js_1 = require("../_legacy-core.js");
const _audit_js_1 = require("../_audit.js");
const _announce_js_1 = require("../_announce.js");
/*
 * /api/legacy/sage — the Wandering Sage.
 *
 *   GET  ?playerName=            → { offer, legacy, pity }
 *   POST { action:'roll' }       → server-decided spawn (pity-backed; client
 *                                  calls this after qualifying moments — extra
 *                                  calls are free no-ops behind the daily cap)
 *   POST { action:'decline' }    → offer declined, NO lock, re-offer cooldown
 *   POST { action:'accept', legacyId } → THE PERMANENT CHOICE. NX marker
 *                                  `legacy:accepted:<player>` is the one-legacy-
 *                                  forever constraint; the save's character.legacy
 *                                  is a server-owned display copy.
 *
 * Spawn odds: base 5% per qualifying roll, +5% per full day since the player
 * first became offer-eligible without a spawn, hard guarantee at day 7
 * (soft+hard pity). Tunable via the shared:legacy-defs overlay.
 */
const OFFER_TTL_SECONDS = 7 * 24 * 60 * 60;
const offerKey = (p) => `legacy:sage-offer:${p}`;
const pityKey = (p) => `legacy:sage-pity:${p}`;
const rollCountKey = (p) => `legacy:sage-roll:${p}:${new Date().toISOString().slice(0, 10)}`;
const VILLAGE_OUTSKIRTS = {
    stormveil: 31, 'ashen leaf': 38, frostfang: 47, moonshadow: 11,
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const DAY_MS = 24 * 60 * 60 * 1000;
function homeSector(village, requested) {
    const want = Math.floor(num(requested));
    if (want >= 1 && want <= 99)
        return want;
    const v = String(village ?? '').toLowerCase();
    for (const [name, sector] of Object.entries(VILLAGE_OUTSKIRTS)) {
        if (v.includes(name))
            return sector;
    }
    return 56; // central
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'The Sage has not begun to wander.' });
    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        // ── GET: current offer + legacy state ───────────────────────────────
        if (isGet) {
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-sage-get', 20, 60_000, identity.name)))
                return;
            const [offer, accepted, rec] = await Promise.all([
                _storage_js_1.kv.get(offerKey(playerName)),
                _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(playerName)),
                _storage_js_1.kv.get(`save:${playerName}`),
            ]);
            const legacy = (rec?.character?.legacy ?? null);
            return res.status(200).json({
                offer: offer && offer.status === 'spawned' ? offer : null,
                legacy,
                sealed: Boolean(accepted),
            });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        const action = typeof body.action === 'string' ? body.action : '';
        // ── ROLL: server-decided spawn attempt ───────────────────────────────
        if (action === 'roll') {
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-sage-roll', 10, 60_000, identity.name)))
                return;
            const overlay = await (0, _legacy_score_js_1.getLegacyOverlay)();
            const cfg = overlay.sage ?? {};
            const baseChance = cfg.baseChance ?? 0.05;
            const pityPerDay = cfg.pityPerDay ?? 0.05;
            const guaranteeDays = cfg.guaranteeDays ?? 7;
            const dailyRollCap = cfg.dailyRollCap ?? 6;
            const declineCooldownDays = cfg.declineCooldownDays ?? 3;
            const forced = Boolean(body.force) && identity.admin === true;
            // Cheap gates before any heavy work.
            const accepted = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(playerName));
            if (accepted)
                return res.status(200).json({ spawn: false, reason: 'sealed' });
            const existing = await _storage_js_1.kv.get(offerKey(playerName));
            if (existing && existing.status === 'spawned') {
                return res.status(200).json({ spawn: true, offer: existing, reason: 'already-waiting' });
            }
            const rec = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (rec?.character ?? null);
            if (!char)
                return res.status(404).json({ error: 'Save not found.' });
            const level = num(char.level);
            if (level < _legacy_defs_js_1.LEGACY_MIN_LEVEL)
                return res.status(200).json({ spawn: false, reason: 'under-level' });
            const pity = (await _storage_js_1.kv.get(pityKey(playerName))) ?? {};
            const now = Date.now();
            if (!forced && pity.declinedUntil && now < pity.declinedUntil) {
                return res.status(200).json({ spawn: false, reason: 'resting' });
            }
            if (!forced) {
                const rolls = await _storage_js_1.kv.incr(rollCountKey(playerName), { ex: 25 * 60 * 60 });
                if (rolls > dailyRollCap)
                    return res.status(200).json({ spawn: false, reason: 'daily-cap' });
            }
            const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName, char);
            const village = typeof char.village === 'string' ? char.village : null;
            const evals = (0, _legacy_score_js_1.evaluateAllLegacies)(stats, { level, village, overlay });
            const offers = (0, _legacy_score_js_1.pickSageOffers)(evals);
            if (offers.length === 0) {
                return res.status(200).json({ spawn: false, reason: 'not-eligible' });
            }
            const eligibleSince = pity.eligibleSince ?? now;
            const daysWaiting = Math.floor((now - eligibleSince) / DAY_MS);
            const chance = Math.min(1, baseChance + pityPerDay * daysWaiting);
            const guaranteed = daysWaiting >= guaranteeDays;
            if (!forced && !guaranteed && Math.random() >= chance) {
                await _storage_js_1.kv.set(pityKey(playerName), { ...pity, eligibleSince });
                return res.status(200).json({ spawn: false, reason: 'no-show', daysWaiting });
            }
            const offer = {
                status: 'spawned',
                offers: offers.map((o) => {
                    const def = _legacy_defs_js_1.LEGACY_BY_ID.get(o.legacyId);
                    return {
                        legacyId: def.id, name: def.name, rarity: def.rarity, category: def.category,
                        flavor: def.flavor, title: def.title, villageAffinity: def.villageAffinity ?? null,
                    };
                }),
                sector: homeSector(char.village, body.sector),
                spawnedAt: now,
                expiresAt: now + OFFER_TTL_SECONDS * 1000,
            };
            await _storage_js_1.kv.set(offerKey(playerName), offer, { ex: OFFER_TTL_SECONDS });
            await _storage_js_1.kv.set(pityKey(playerName), { eligibleSince, lastSpawnAt: now });
            await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'sage-spawned', meta: { offers: offer.offers.map((o) => o.legacyId), forced } });
            return res.status(200).json({ spawn: true, offer });
        }
        // ── DECLINE: free walk-away, cooldown before re-offers ──────────────
        if (action === 'decline') {
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-sage-act', 5, 60_000, identity.name)))
                return;
            const overlay = await (0, _legacy_score_js_1.getLegacyOverlay)();
            const declineCooldownDays = overlay.sage?.declineCooldownDays ?? 3;
            const offer = await _storage_js_1.kv.get(offerKey(playerName));
            if (!offer || offer.status !== 'spawned')
                return res.status(200).json({ ok: false, reason: 'no-offer' });
            const now = Date.now();
            await _storage_js_1.kv.set(offerKey(playerName), { ...offer, status: 'declined', declinedAt: now }, { ex: OFFER_TTL_SECONDS });
            const pity = (await _storage_js_1.kv.get(pityKey(playerName))) ?? {};
            await _storage_js_1.kv.set(pityKey(playerName), { declinedUntil: now + declineCooldownDays * DAY_MS });
            await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'offer-declined', meta: { offers: offer.offers.map((o) => o.legacyId) } });
            return res.status(200).json({ ok: true });
        }
        // ── ACCEPT: the permanent choice ─────────────────────────────────────
        if (action === 'accept') {
            if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-sage-act', 5, 60_000, identity.name)))
                return;
            const legacyId = typeof body.legacyId === 'string' ? body.legacyId : '';
            const def = _legacy_defs_js_1.LEGACY_BY_ID.get(legacyId);
            if (!def)
                return res.status(400).json({ error: 'Unknown legacy.' });
            const out = await (0, _lock_js_1.withKvLock)(`legacy:accept:${playerName}`, async () => {
                const offer = await _storage_js_1.kv.get(offerKey(playerName));
                if (!offer || offer.status !== 'spawned' || Date.now() > offer.expiresAt) {
                    return { status: 200, body: { ok: false, reason: 'no-offer' } };
                }
                if (!offer.offers.some((o) => o.legacyId === legacyId)) {
                    return { status: 200, body: { ok: false, reason: 'not-offered' } };
                }
                // The one-legacy-forever constraint: an atomic NX marker.
                const now = Date.now();
                const claimed = await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyAcceptedKey)(playerName), { legacyId, ts: now }, { nx: true });
                if (claimed !== 'OK') {
                    const sealed = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyAcceptedKey)(playerName));
                    if (sealed?.legacyId !== legacyId) {
                        return { status: 409, body: { ok: false, reason: 'sealed', legacyId: sealed?.legacyId ?? null } };
                    }
                    // Same legacy: a crashed earlier accept — fall through and repair.
                }
                const trialKind = (0, _legacy_core_js_1.nextTrialKind)(1);
                const legacy = { legacyId, stage: 1, acceptedAt: now, titles: [] };
                const saveOut = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                    const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                    const char = (rec?.character ?? null);
                    if (!rec || !char)
                        return false;
                    const updated = { ...char, legacy };
                    await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)((0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated }), rec));
                    return true;
                }, { failClosed: true });
                if (!saveOut)
                    return { status: 404, body: { error: 'Save not found.' } };
                const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName);
                const objectives = (0, _legacy_core_js_1.trialObjectivesFor)(def, trialKind);
                const trial = {
                    legacyId, kind: trialKind, startedAt: now, attempt: 1,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await _storage_js_1.kv.set((0, _legacy_core_js_1.legacyTrialKey)(playerName), trial);
                await _storage_js_1.kv.set(offerKey(playerName), { ...offer, status: 'accepted', acceptedAt: now, acceptedLegacyId: legacyId }, { ex: OFFER_TTL_SECONDS });
                await (0, _legacy_track_js_1.appendLegacyEvent)(playerName, { type: 'offer-accepted', key: legacyId });
                await (0, _audit_js_1.recordAudit)({
                    actor: identity.admin ? 'admin' : playerName, domain: 'legacy', action: 'legacy.accept',
                    entityType: 'legacy', entityId: legacyId, meta: { rarity: def.rarity },
                });
                if (def.rarity === 'mythic') {
                    await (0, _announce_js_1.announce)({
                        type: 'mythic_legacy', importance: 'mythic',
                        title: 'MYTHIC LEGACY CLAIMED',
                        message: `${playerName} accepted the ${def.name}. From this moment, their path is sealed forever.`,
                        player: playerName, legacyId,
                    });
                }
                return { status: 200, body: { ok: true, legacy, trial } };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'The Sage is occupied — please retry.' });
        }
        console.error('[legacy/sage]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
