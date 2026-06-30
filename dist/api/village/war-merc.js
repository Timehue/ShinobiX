"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
const _war_state_js_1 = require("../_war-state.js");
const _war_economy_js_1 = require("../_war-economy.js");
const _war_merc_js_1 = require("../_war-merc.js");
const _war_telemetry_js_1 = require("../_war-telemetry.js");
const _sector_war_store_js_1 = require("../_sector-war-store.js");
const _merc_auto_js_1 = require("../_merc-auto.js");
// Kage seat key — spaces→dashes, matching api/village/kage.ts + sector-war.ts.
function kageKey(village) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function isSeatedKage(village, playerName) {
    const st = await _storage_js_1.kv.get(kageKey(village));
    return (0, _utils_js_1.safeName)(st?.seatedKage ?? '') === playerName;
}
async function villageOf(playerName) {
    const save = await _storage_js_1.kv.get(`save:${playerName}`);
    return String(save?.character?.village ?? '').trim();
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
        switch (action) {
            case 'hire': return await doHire(req, res, identity, playerName, body);
            case 'attack': return await doMercAttack(req, res, identity, playerName, body);
            case 'list': return await doList(res, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    }
    catch (err) {
        console.error('[village/war-merc]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
// ── hire (debit WR from the village pool, add a 2-day lease) ───────────────────
async function doHire(req, res, identity, playerName, body) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const tierId = String(body.tierId ?? '');
    if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
        return res.status(400).json({ error: 'Not a war village.' });
    if (!(0, _war_economy_js_1.wrMercTierById)(tierId))
        return res.status(400).json({ error: 'Unknown mercenary tier.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'war-merc-hire', 20, 60_000, identity.name)))
        return;
    if (!identity.admin && !(await isSeatedKage(village, playerName))) {
        return res.status(403).json({ error: 'Only the seated Kage can hire mercenaries.' });
    }
    const now = Date.now();
    // Phase-1 approximation (mirrors sector-war declare): the comeback discount is
    // keyed on home-sector count until live held-count tracking lands.
    const sectorsHeld = (0, _war_map_sectors_js_1.homeSectorsForVillage)(village).length;
    const key = (0, _war_state_js_1.villageWarKey)(village);
    const out = await (0, _lock_js_1.withKvLock)(key, async () => {
        const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(key)) ?? undefined);
        const cost = (0, _war_merc_js_1.mercHireCost)(tierId, sectorsHeld, record);
        if (record.warResources < cost)
            return { ok: false, cost };
        const mercLeases = (0, _war_merc_js_1.addOrRefreshLease)(record.mercLeases, tierId, playerName, now);
        await _storage_js_1.kv.set(key, { ...record, warResources: record.warResources - cost, mercLeases });
        return { ok: true, cost };
    }, { failClosed: true });
    if (!out.ok)
        return res.status(402).json({ error: `Hiring this mercenary costs ${out.cost} War Resources.` });
    // Telemetry (best-effort): WR spent on the hire (0 = a free comeback hire → no event).
    if (out.cost > 0) {
        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `merc:${(0, _war_state_js_1.villageWarSlug)(village)}:${tierId}:${playerName}:${now}`, village, kind: 'wr.spend.merc', amount: out.cost, meta: tierId });
    }
    return res.status(200).json({ ok: true, tierId, cost: out.cost, expiresAt: now + _war_merc_js_1.MERC_LEASE_MS, band: (0, _war_economy_js_1.mercBandSize)(tierId) });
}
// ── list (read-only menu + active leases) ─────────────────────────────────────
async function doList(res, body) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
        return res.status(400).json({ error: 'Not a war village.' });
    const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(village))) ?? undefined);
    const now = Date.now();
    return res.status(200).json({
        ok: true,
        warResources: record.warResources,
        tiers: _war_economy_js_1.WR_MERC_TIERS,
        leases: record.mercLeases.filter((l) => l.expiresAt > now),
    });
}
// ── attack (deploy one merc from the band at an enemy player; server-resolved) ──
// SERVER-AUTHORITATIVE: the merc-vs-player fight is run headless by the towers
// engine (resolveMercBattle), so the outcome can't be faked by the defender's
// client. A merc win chips the contest Control HP (flip on capture); a player win
// gives the defender only 25% regen (the mercBattle asymmetry); a stall is inert.
// Each deployment spends one merc from the band (win/lose/stall).
async function doMercAttack(req, res, identity, playerName, body) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const tierId = String(body.tierId ?? '');
    const sector = Math.floor(Number(body.sector) || 0);
    const targetPlayer = (0, _utils_js_1.safeName)(String(body.targetPlayer ?? ''));
    if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
        return res.status(400).json({ error: 'Not a war village.' });
    const tier = (0, _war_economy_js_1.wrMercTierById)(tierId);
    if (!tier)
        return res.status(400).json({ error: 'Unknown mercenary tier.' });
    if (!targetPlayer)
        return res.status(400).json({ error: 'Missing target player.' });
    if (targetPlayer === playerName)
        return res.status(400).json({ error: 'You cannot send mercenaries at yourself.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'war-merc-attack', 40, 60_000, identity.name)))
        return;
    const now = Date.now();
    // The caller's village must be running an active Combat sector war on the sector.
    const contest = await (0, _sector_war_store_js_1.activeContestOnSector)(sector);
    if (!contest || contest.attackerVillage !== village)
        return res.status(409).json({ error: 'Your village is not attacking that sector.' });
    if (contest.winCondition !== 'combat')
        return res.status(409).json({ error: 'That sector is not a Combat contest.' });
    // The target must be a member of the defending village.
    if ((await villageOf(targetPlayer)) !== contest.defenderVillage) {
        return res.status(403).json({ error: 'That player is not defending this sector.' });
    }
    // Deploy via the shared core (server-auth resolve + contest application), the
    // same path the autonomous tick uses. Null = the caller's band is spent.
    const r = await (0, _merc_auto_js_1.deployOneMerc)({ village, tierId, hirer: playerName, sector, targetPlayer, contestId: contest.id, mercLevel: tier.level, now });
    if (!r)
        return res.status(409).json({ error: 'You have no active mercenary band of that tier to deploy.' });
    return res.status(200).json({ ok: true, winner: r.winner, captured: r.captured, controlHp: r.controlHp, mercsRemaining: r.mercsRemaining });
}
