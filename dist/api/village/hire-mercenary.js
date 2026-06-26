"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERCENARY_TIERS = void 0;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _mercenaries_js_1 = require("./_mercenaries.js");
Object.defineProperty(exports, "MERCENARY_TIERS", { enumerable: true, get: function () { return _mercenaries_js_1.MERCENARY_TIERS; } });
// These mirror api/world-state.ts (keep in sync). The war record is the source of
// truth; we only touch hp[enemy], contributions[player], and updatedAt.
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
const VILLAGE_WAR_HP_MAX = 5000;
const MERC_MARKER_TTL_SEC = 14 * 24 * 60 * 60; // a war's max lifetime
async function activeWarForVillage(village) {
    const keys = await _storage_js_1.kv.keys(`${VILLAGE_WAR_KEY_PREFIX}*`);
    if (!keys.length)
        return null;
    const wars = await _storage_js_1.kv.mget(...keys);
    const now = Date.now();
    for (const w of wars) {
        if (!w || w.endedAt)
            continue;
        if (!Array.isArray(w.villages) || !w.villages.includes(village))
            continue;
        if (w.pendingUntil && w.pendingUntil > now)
            continue; // war not hot yet
        return w;
    }
    return null;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed.' });
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin)
        return res.status(400).json({ error: 'Admins have no village to hire for.' });
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hire-mercenary', 20, 60_000, identity.name)))
        return;
    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    }
    catch {
        return res.status(400).json({ error: 'Bad request body.' });
    }
    if (body.action !== 'hire')
        return res.status(400).json({ error: 'Unknown action.' });
    const tier = (0, _mercenaries_js_1.mercenaryById)(String(body.tierId ?? ''));
    if (!tier)
        return res.status(400).json({ error: 'Unknown mercenary tier.' });
    // Resolve the player's village + active war.
    const saveKey = `save:${identity.name}`;
    const save = await _storage_js_1.kv.get(saveKey);
    const char = save?.character ?? null;
    const village = String(char?.village ?? '').trim();
    if (!char || !village)
        return res.status(400).json({ error: 'You are not in a village.' });
    const war = await activeWarForVillage(village);
    if (!war)
        return res.status(409).json({ error: 'Your village is not in an active war.' });
    const enemy = war.villages.find(v => v !== village);
    if (!enemy)
        return res.status(409).json({ error: 'No enemy village to strike.' });
    // Once-per-war-per-tier contract. NX marker claims the slot up front.
    const marker = `war:merc:${war.id}:${identity.name}:${tier.id}`;
    const placed = await _storage_js_1.kv.set(marker, { at: Date.now() }, { nx: true, ex: MERC_MARKER_TTL_SEC });
    if (!placed)
        return res.status(409).json({ error: `You already hired the ${tier.name} for this war.` });
    // Deduct seals (recomputed from the sealed table — never the client) and record
    // the hire on the save (display-only; the NX marker is the real guard).
    const deduct = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
        const fresh = await _storage_js_1.kv.get(saveKey);
        const fc = fresh?.character;
        if (!fresh || !fc)
            return { error: 'Save not found.' };
        const balance = Math.max(0, Math.floor(Number(fc.honorSeals ?? 0)));
        if (balance < tier.costSeals)
            return { error: `Not enough Honor Seals — the ${tier.name} costs ${tier.costSeals}.` };
        fc.honorSeals = balance - tier.costSeals;
        const prevWm = fc.warMercs;
        const warMercs = prevWm && prevWm.warId === war.id
            ? { warId: war.id, tiers: Array.isArray(prevWm.tiers) ? [...prevWm.tiers] : [] }
            : { warId: war.id, tiers: [] };
        if (!warMercs.tiers.includes(tier.id))
            warMercs.tiers.push(tier.id);
        fc.warMercs = warMercs;
        await _storage_js_1.kv.set(saveKey, (0, _save_version_js_1.bumpSaveVersion)(fresh));
        return { ok: true, balance: fc.honorSeals, warMercs };
    }, { failClosed: true });
    if (!deduct || 'error' in deduct) {
        await _storage_js_1.kv.del(marker).catch(() => 0);
        return res.status(deduct && 'error' in deduct ? 400 : 503).json({ error: (deduct && 'error' in deduct ? deduct.error : 'Treasury busy — try again.') });
    }
    // Apply the war damage to the enemy village (floored, attributed). Same lock key
    // the world-state handler uses, so writes never interleave.
    const warKey = `${VILLAGE_WAR_KEY_PREFIX}${war.id}`;
    const struck = await (0, _lock_js_1.withKvLock)(warKey, async () => {
        const w = await _storage_js_1.kv.get(warKey);
        if (!w || w.endedAt)
            return null;
        const en = w.villages.find(v => v !== village);
        if (!en)
            return null;
        const prevHp = Number(w.hp?.[en] ?? VILLAGE_WAR_HP_MAX);
        const { nextHp, dealt } = (0, _mercenaries_js_1.applyMercenaryDamage)(prevHp, tier.warDamage);
        w.hp = { ...w.hp, [en]: nextHp };
        const contribs = { ...(w.contributions ?? {}) };
        const prev = contribs[identity.name] ?? { damage: 0, raids: 0, pvpKills: 0, side: village, name: String(char?.name ?? identity.name) };
        contribs[identity.name] = { ...prev, damage: prev.damage + dealt, side: village, name: prev.name };
        w.contributions = contribs;
        w.updatedAt = Date.now();
        await _storage_js_1.kv.set(warKey, w);
        return { enemyHp: nextHp, dealt };
    }, { failClosed: true });
    if (!struck) {
        // Refund the seals + release the contract — the merc never struck.
        await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const fresh = await _storage_js_1.kv.get(saveKey);
            const fc = fresh?.character;
            if (!fresh || !fc)
                return;
            fc.honorSeals = Math.max(0, Math.floor(Number(fc.honorSeals ?? 0))) + tier.costSeals;
            const wm = fc.warMercs;
            if (wm && wm.warId === war.id && Array.isArray(wm.tiers)) {
                wm.tiers = wm.tiers.filter(t => t !== tier.id);
            }
            await _storage_js_1.kv.set(saveKey, (0, _save_version_js_1.bumpSaveVersion)(fresh));
        }, { failClosed: true }).catch(() => 0);
        await _storage_js_1.kv.del(marker).catch(() => 0);
        return res.status(503).json({ error: 'The war front is busy — your seals were not spent. Try again.' });
    }
    return res.status(200).json({
        ok: true,
        tier: tier.id,
        name: tier.name,
        balance: deduct.balance,
        warMercs: deduct.warMercs,
        enemy,
        enemyHp: struck.enemyHp,
        dealt: struck.dealt,
    });
}
