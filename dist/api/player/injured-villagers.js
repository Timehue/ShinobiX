"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _progress_js_1 = require("../missions/_progress.js");
const _elapsed_state_js_1 = require("../_elapsed-state.js");
// Rank 10 Healer perk: see all injured players in your village anywhere in
// the world (HP < maxHp), not just those in the hospital. Returns a small
// projection so it's cheap to render in the Hospital UI.
const HEALER_WORLDWIDE_RANK = 10;
const HP_INJURED_THRESHOLD = 0.99; // <99% HP counts as injured
// Persistent player index — every saved player is upserted here atomically with
// their save (see api/save/[name].ts + api/player/roster.ts). Deriving save keys
// from it avoids a full save:* keyspace scan (recursive disk-overlay walk) on
// every Healer poll.
const REGISTRY_KEY = 'player:registry';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const healerName = (0, _utils_js_1.safeName)(String(req.query.healerName ?? ''));
        if (!healerName)
            return res.status(400).json({ error: 'Invalid healer name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, healerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== healerName) {
            return res.status(403).json({ error: 'Can only query for your own profession.' });
        }
        const healerRecord = await _storage_js_1.kv.get(`save:${healerName}`);
        const healerChar = healerRecord?.character;
        if (!healerChar)
            return res.status(404).json({ error: 'Healer character not found.' });
        if (!identity.admin && healerChar.profession !== 'healer') {
            return res.status(403).json({ error: 'Healers only.' });
        }
        // Derive rank from professionXp server-side instead of trusting
        // the saved professionRank field. A corrupted save / admin edit
        // setting professionRank=10 directly would otherwise leak
        // world-wide injured-villager data without the player earning it.
        const trustedRank = (0, _progress_js_1.professionRankForXp)('healer', Number(healerChar.professionXp ?? 0));
        if (!identity.admin && trustedRank < HEALER_WORLDWIDE_RANK) {
            return res.status(403).json({ error: `World-wide visibility unlocks at Rank ${HEALER_WORLDWIDE_RANK}.` });
        }
        const healerVillage = String(healerChar.village ?? '');
        if (!healerVillage)
            return res.status(400).json({ error: 'Healer has no village set.' });
        // Derive player save keys from the registry (every saved player is in it)
        // instead of scanning the whole save:* keyspace, then filter to same-village
        // injured players. Same-village filter applied server-side so we never leak
        // other villages' player data through this endpoint.
        const registry = await _storage_js_1.kv.hgetall(REGISTRY_KEY);
        const playerSlugs = Object.keys(registry ?? {})
            .filter(slug => !slug.startsWith('clan-') && !slug.toLowerCase().startsWith('admin'));
        const playerKeys = playerSlugs.map(slug => `save:${slug}`);
        if (playerKeys.length === 0) {
            res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
            return res.status(200).json({ injured: [] });
        }
        const [records, battleLocks] = await Promise.all([
            _storage_js_1.kv.mget(...playerKeys),
            (0, _elapsed_state_js_1.battleLockFlagsForPlayers)(playerSlugs),
        ]);
        const injured = [];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const rec = r;
            if (!rec)
                continue;
            const settled = (0, _elapsed_state_js_1.settleSaveRecord)(rec, { battleLocked: battleLocks.get(playerSlugs[i]) === true }).record;
            const c = settled.character;
            if (!c)
                continue;
            const name = String(c.name ?? '');
            // healerName is a safeName slug; c.name is a display name — canonicalize
            // to skip the healer's own record even when their name has a space.
            if (!name || (0, _utils_js_1.safeName)(name) === healerName)
                continue;
            if (c.village !== healerVillage)
                continue;
            const hp = Number(c.hp ?? 0);
            const maxHp = Number(c.maxHp ?? 0);
            if (maxHp <= 0)
                continue;
            if (hp / maxHp > HP_INJURED_THRESHOLD)
                continue;
            injured.push({
                name,
                level: Number(c.level ?? 1),
                village: healerVillage,
                hp,
                maxHp,
                hospitalized: !!c.hospitalized,
            });
        }
        injured.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
        // Short shared CDN cache to collapse repeated Healer polls of this
        // full-save scan. Set only on the 200 path so a 500 is never cached.
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
        return res.status(200).json({ injured });
    }
    catch (err) {
        console.error('[player/injured-villagers]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
