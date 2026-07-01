"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
const _war_state_js_1 = require("../_war-state.js");
const _war_economy_js_1 = require("../_war-economy.js");
const _sector_war_store_js_1 = require("../_sector-war-store.js");
const world_state_js_1 = require("../world-state.js");
const _merc_auto_js_1 = require("../_merc-auto.js");
const _merc_roam_js_1 = require("../_merc-roam.js");
/** Active, non-empty merc leases for a village (the bands it has fielded). */
async function activeBandsOf(village, now) {
    const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(village))) ?? undefined);
    return rec.mercLeases.filter((l) => l.expiresAt > now && l.count > 0);
}
/** The bands hostile to `viewerVillage` that roam `sector` right now: village-war
 *  enemies (whose mercs follow the viewer anywhere) + the Combat sector-war attacker
 *  besieging THIS sector. Mutual exclusion means a village is in one mode or the
 *  other, so the two branches never double-count the same attacker. */
async function hostileBandsFor(sector, viewerVillage, now) {
    const out = [];
    // 1. Village-war enemies — their mercs follow the viewer's players everywhere.
    const enemies = await (0, world_state_js_1.activeVillageWarEnemiesOf)(viewerVillage);
    for (const enemy of enemies) {
        for (const band of await activeBandsOf(enemy, now)) {
            const tier = (0, _war_economy_js_1.wrMercTierById)(band.tierId);
            if (!tier)
                continue;
            out.push({ village: enemy, tierId: band.tierId, level: tier.level, count: band.count, context: 'village', hirer: band.player });
        }
    }
    // 2. The Combat sector-war attacker besieging THIS sector (defender == viewer).
    const contest = await (0, _sector_war_store_js_1.activeContestOnSector)(sector);
    if (contest && contest.winCondition === 'combat' && contest.defenderVillage === viewerVillage && !enemies.includes(contest.attackerVillage)) {
        for (const band of await activeBandsOf(contest.attackerVillage, now)) {
            const tier = (0, _war_economy_js_1.wrMercTierById)(band.tierId);
            if (!tier)
                continue;
            out.push({ village: contest.attackerVillage, tierId: band.tierId, level: tier.level, count: band.count, context: 'sector', hirer: band.player, contestId: contest.id });
        }
    }
    return out;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return res.status(404).json({ error: 'Not found.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = String(body.action ?? '');
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
            return res.status(400).json({ error: 'Not a war village.' });
        switch (action) {
            case 'roster': {
                const bands = await hostileBandsFor(sector, village, Date.now());
                return res.status(200).json({ ok: true, mercs: (0, _merc_roam_js_1.synthRoamingMercs)(bands) });
            }
            case 'engage': return await doEngage(req, res, identity, playerName, village, sector, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    }
    catch (err) {
        console.error('[sector/merc-roam]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
// ── engage (a defender ran into a roaming merc → resolve server-side) ──────────
async function doEngage(req, res, identity, playerName, viewerVillage, sector, body) {
    const parsed = (0, _merc_roam_js_1.parseMercNpcId)(String(body.mercId ?? ''));
    if (!parsed)
        return res.status(400).json({ error: 'Bad mercenary id.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'merc-roam-engage', 30, 60_000, identity.name)))
        return;
    const now = Date.now();
    // A defender a merc just fought is off-limits for 15 min — clean message before
    // we try to spend one (deploy* also re-checks this atomically).
    if (await (0, _merc_roam_js_1.isMercTargetOnCooldown)(playerName, now)) {
        return res.status(429).json({ error: 'You just fought off a mercenary — they keep their distance for a few minutes.' });
    }
    // Re-derive the bands actually roaming this sector for the caller and match the
    // engaged merc to one — server truth; the client id is only a hint.
    const band = (await hostileBandsFor(sector, viewerVillage, now))
        .find((b) => (0, _merc_roam_js_1.mercVillageSlug)(b.village) === parsed.villageSlug && b.tierId === parsed.tierId);
    if (!band)
        return res.status(409).json({ error: 'That mercenary is no longer here.' });
    if (band.context === 'sector') {
        if (!band.contestId)
            return res.status(409).json({ error: 'No active siege on this sector.' });
        const r = await (0, _merc_auto_js_1.deployOneMerc)({ village: band.village, tierId: band.tierId, hirer: band.hirer, sector, targetPlayer: playerName, contestId: band.contestId, mercLevel: band.level, now });
        if (!r)
            return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
        return res.status(200).json({ ok: true, context: 'sector', winner: r.winner, captured: r.captured, controlHp: r.controlHp, mercsRemaining: r.mercsRemaining });
    }
    const r = await (0, _merc_auto_js_1.deployMercVillageWar)({ village: band.village, enemyVillage: viewerVillage, tierId: band.tierId, hirer: band.hirer, sector, targetPlayer: playerName, mercLevel: band.level, now });
    if (!r)
        return res.status(409).json({ error: 'That mercenary band is spent or just attacked you.' });
    return res.status(200).json({ ok: true, context: 'village', winner: r.winner, enemyWarHp: r.enemyWarHp, mercsRemaining: r.mercsRemaining });
}
