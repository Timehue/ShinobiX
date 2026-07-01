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
const _war_structures_js_1 = require("../_war-structures.js");
const _sector_war_js_1 = require("../_sector-war.js");
const _sector_war_store_js_1 = require("../_sector-war-store.js");
const world_state_js_1 = require("../world-state.js");
const _war_telemetry_js_1 = require("../_war-telemetry.js");
/*
 * /api/village/sector-war — POST only. The sector-war battle-wiring (Phase 4c).
 *
 * Actions (body.action):
 *   - declare : the seated Kage opens a sector war on an enemy-held sector — debits
 *               250 WR (× comeback discount) from the attacking village's WR pool and
 *               opens the Control-HP siege. Mutually exclusive with a village war.
 *   - attack  : after the launcher fights the sector's defender through the existing
 *               sector-attack → PvP flow, this mints a SINGLE-USE token sealing the
 *               contest context for the resulting pvp:<battleId>.
 *   - resolve : reads the AUTHORITATIVE finished pvp:<battleId> (never a client claim),
 *               applies the win/loss to Control HP (War-Academy-boosted), and on
 *               capture flips world:territory:<sector>.ownerVillage to the attacker.
 *   - status  : read-only — the owner + active contest for a sector (or all contests).
 *   - seed    : admin — one-time idempotent seed of home-sector ownership (Phase 4d).
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch). Combat
 * battles run here (attack/resolve); Card battles run via /village/sector-card and
 * Pet duels via /village/sector-pet — all three settle the same contest Control HP
 * server-authoritatively. A client-claimed result never flips territory.
 */
// Win-conditions whose server-authoritative battle path is wired this build:
// Combat here, Card via /village/sector-card, Pet via /village/sector-pet (the
// deterministic pet engine ported to api/pet-sim, Phase 7).
const WIRED_WIN_CONDITIONS = ['combat', 'card', 'pet'];
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
function declineStatus(e) {
    switch (e) {
        case 'mutual-exclusion-attacker':
        case 'mutual-exclusion-defender':
        case 'already-contested':
            return 409;
        default:
            return 400;
    }
}
function declineMessage(e, cost) {
    switch (e) {
        case 'self': return 'You cannot sector-war your own village.';
        case 'not-war-village': return 'Both villages must be war villages.';
        case 'not-war-sector': return 'That sector is not a war sector.';
        case 'not-enemy-held': return 'That sector is not currently held by an enemy village.';
        case 'mutual-exclusion-attacker': return 'Your village is in a village war — finish it before running sector wars.';
        case 'mutual-exclusion-defender': return 'The defending village is in a village war and cannot be sector-warred.';
        case 'already-contested': return 'That sector already has an active sector war.';
        case 'win-condition-unavailable': return 'That sector’s win-condition is not available yet.';
        case 'insufficient-wr': return `Declaring this sector war costs ${cost ?? 0} War Resources.`;
        default: return 'Cannot declare a sector war on that sector.';
    }
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
            case 'declare': return await doDeclare(req, res, identity, playerName, body);
            case 'attack': return await doAttack(req, res, identity, playerName, body);
            case 'resolve': return await doResolve(req, res, identity, playerName, body);
            case 'status': return await doStatus(req, res, body);
            case 'seed': return await doSeed(res, identity);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    }
    catch (err) {
        console.error('[village/sector-war]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
// ── declare ──────────────────────────────────────────────────────────────────
async function doDeclare(req, res, identity, playerName, body) {
    const village = typeof body.village === 'string' ? body.village.trim() : ''; // attacker
    const sector = Math.floor(Number(body.sector) || 0);
    if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
        return res.status(400).json({ error: 'Not a war village.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'sector-war-declare', 20, 60_000, identity.name)))
        return;
    if (!identity.admin && !(await isSeatedKage(village, playerName))) {
        return res.status(403).json({ error: 'Only the seated Kage can declare a sector war.' });
    }
    const defender = await (0, _sector_war_store_js_1.getSectorOwnerVillage)(sector);
    if (!defender)
        return res.status(409).json({ error: 'That sector has no current owner — it must be seeded first.' });
    const atkKey = (0, _war_state_js_1.villageWarKey)(village);
    const [attackerInWar, defenderInWar, existing, atkRecord, defRaw] = await Promise.all([
        (0, world_state_js_1.villageHasActiveWar)(village),
        (0, _war_map_sectors_js_1.isWarVillage)(defender) ? (0, world_state_js_1.villageHasActiveWar)(defender) : Promise.resolve(false),
        (0, _sector_war_store_js_1.activeContestOnSector)(sector),
        _storage_js_1.kv.get(atkKey),
        (0, _war_map_sectors_js_1.isWarVillage)(defender) ? _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(defender)) : Promise.resolve(null),
    ]);
    const attackerRecord = (0, _war_state_js_1.normalizeVillageWarRecord)(village, atkRecord ?? undefined);
    const defenderRecord = (0, _war_map_sectors_js_1.isWarVillage)(defender) ? (0, _war_state_js_1.normalizeVillageWarRecord)(defender, defRaw ?? undefined) : null;
    const winCondition = (defenderRecord?.sectors[String(sector)]?.winCondition ?? 'combat');
    const controlHpMax = defenderRecord ? (0, _war_structures_js_1.sectorControlHpMax)(defenderRecord) : undefined;
    const check = (0, _sector_war_js_1.canDeclareSectorWar)({
        attackerVillage: village,
        defenderVillage: defender,
        sector,
        sectorOwnerVillage: defender,
        winCondition,
        attackerInActiveVillageWar: attackerInWar,
        defenderInActiveVillageWar: defenderInWar,
        contestAlreadyActive: !!existing,
        attackerWr: attackerRecord.warResources,
        attackerSectorsHeld: (0, _war_map_sectors_js_1.homeSectorsForVillage)(village).length,
        allowedWinConditions: WIRED_WIN_CONDITIONS,
    });
    if (!check.ok)
        return res.status(declineStatus(check.error)).json({ error: declineMessage(check.error, check.cost) });
    const id = (0, _sector_war_js_1.sectorWarId)(sector, village, defender);
    const cost = check.cost;
    const out = await (0, _lock_js_1.withKvLock)(atkKey, async () => {
        const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(atkKey)) ?? undefined);
        if (rec.warResources < cost)
            return { ok: false, cost };
        const contestRes = await (0, _lock_js_1.withKvLock)((0, _sector_war_js_1.sectorWarKey)(id), async () => {
            const exist = await (0, _sector_war_store_js_1.loadSectorWar)(id);
            if (exist && !exist.flipped)
                return { created: false, session: exist };
            const s = (0, _sector_war_js_1.newSectorWarSession)({ sector, attackerVillage: village, defenderVillage: defender, winCondition, now: Date.now(), controlHpMax });
            await (0, _sector_war_store_js_1.saveSectorWar)(s);
            return { created: true, session: s };
        }, { failClosed: true });
        if (!contestRes.created)
            return { ok: true, cost: 0, contest: contestRes.session, alreadyOpen: true };
        await _storage_js_1.kv.set(atkKey, { ...rec, warResources: rec.warResources - cost });
        return { ok: true, cost, contest: contestRes.session, alreadyOpen: false };
    }, { failClosed: true });
    if (!out.ok)
        return res.status(400).json({ error: `Declaring this sector war costs ${out.cost} War Resources.` });
    // Telemetry (best-effort): the WR actually spent declaring (0 when re-opening an
    // already-active contest, so no event). Never blocks the declare.
    if (out.cost > 0)
        void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `declare:${id}`, village, kind: 'wr.spend.declare', amount: out.cost, meta: `sector:${sector}` });
    return res.status(200).json({ ok: true, cost: out.cost, alreadyOpen: out.alreadyOpen, contest: out.contest });
}
// ── attack (register a battle → mint the single-use token) ────────────────────
// Either warring side may register a battle they fought over the sector (so the
// defender's wins count for regen, §17.6). The token records the CONTEST's
// villages, so resolve maps the authoritative winner by village regardless of
// who registered — an attacker can't suppress the defender's regen by only
// reporting their own wins.
async function doAttack(req, res, identity, playerName, body) {
    const sector = Math.floor(Number(body.sector) || 0);
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId)
        return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'sector-war-attack', 40, 60_000, identity.name)))
        return;
    const contest = await (0, _sector_war_store_js_1.activeContestOnSector)(sector);
    if (!contest)
        return res.status(409).json({ error: 'No active sector war on that sector.' });
    if (contest.winCondition !== 'combat')
        return res.status(409).json({ error: 'That sector is not a Combat contest.' });
    const { attackerVillage, defenderVillage } = contest;
    // The caller must be a member of one of the two warring villages.
    if (!identity.admin) {
        const callerVillage = await villageOf(playerName);
        if (callerVillage !== attackerVillage && callerVillage !== defenderVillage) {
            return res.status(403).json({ error: 'You are not a participant in this sector war.' });
        }
    }
    // The battle must be a real PvP session fought between a member of the
    // attacking village and a member of the defending village (the sanctioned
    // sector-attack). We seal the contest binding into the token; resolve trusts
    // only the authoritative session winner.
    const battle = await _storage_js_1.kv.get(`pvp:${battleId}`);
    if (!battle)
        return res.status(404).json({ error: 'Battle session not found or expired.' });
    const p1 = (0, _utils_js_1.safeName)(battle.p1?.name ?? '');
    const p2 = (0, _utils_js_1.safeName)(battle.p2?.name ?? '');
    if (!p1 || !p2)
        return res.status(409).json({ error: 'That battle is not a two-fighter PvP session.' });
    const [v1, v2] = await Promise.all([villageOf(p1), villageOf(p2)]);
    if (v1 === v2 || !(v1 === attackerVillage || v2 === attackerVillage) || !(v1 === defenderVillage || v2 === defenderVillage)) {
        return res.status(403).json({ error: 'That battle is not between the two villages at war over this sector.' });
    }
    // Seal the DEFENDER's chosen sector terrain into the fight as its biome, so the
    // home-terrain school bonus actually applies (+10% to the terrain's jutsu school
    // via api/pvp/move.ts terrainMultiplier — §17.3 "defender home advantage"; the
    // valid terrains forest/snow/volcano/shadow are exactly the buffed biomes, central
    // is neutral). This is server-authoritative and runs at battle registration —
    // BEFORE any move resolves and reads session.biome — so an attacker can't dodge
    // the defender's home terrain by opening the duel on a biome that suits their own
    // school. Best-effort: a hiccup here must never block the sanctioned attack.
    try {
        const defRec = (0, _war_state_js_1.normalizeVillageWarRecord)(defenderVillage, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(defenderVillage))) ?? undefined);
        const terrain = defRec.sectors[String(sector)]?.terrain;
        const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
        if (terrain && session && session.biome !== terrain) {
            await _storage_js_1.kv.set(`pvp:${battleId}`, { ...session, biome: terrain });
        }
    }
    catch (err) {
        console.error('[sector-war] terrain-seal (non-fatal)', err);
    }
    await (0, _sector_war_store_js_1.mintSectorWarToken)((0, _sector_war_js_1.newSectorWarBattleToken)({
        battleId,
        sectorWarId: contest.id,
        sector,
        attackerVillage,
        defenderVillage,
        registeredBy: playerName,
        winCondition: 'combat',
        now: Date.now(),
    }));
    return res.status(200).json({ ok: true, battleId, sectorWarId: contest.id });
}
// ── resolve (apply the authoritative outcome; flip on capture) ─────────────────
async function doResolve(req, res, identity, playerName, body) {
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId)
        return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'sector-war-resolve', 40, 60_000, identity.name)))
        return;
    const token = await (0, _sector_war_store_js_1.loadSectorWarToken)(battleId);
    if (!token)
        return res.status(409).json({ error: 'No pending sector-war battle for that id (already resolved or expired).' });
    const battle = await _storage_js_1.kv.get(`pvp:${battleId}`);
    if (!battle || battle.status !== 'done' || !battle.winner || battle.winner === 'draw') {
        return res.status(409).json({ error: 'Battle is not finished, or it ended in a draw.' });
    }
    const winnerName = (0, _utils_js_1.safeName)(battle.winner === 'p1' ? (battle.p1?.name ?? '') : (battle.p2?.name ?? ''));
    const winnerVillage = winnerName ? await villageOf(winnerName) : '';
    const attackerWon = !!winnerVillage && winnerVillage === token.attackerVillage;
    const id = token.sectorWarId;
    const result = await (0, _lock_js_1.withKvLock)((0, _sector_war_js_1.sectorWarKey)(id), async () => {
        // Re-check the token inside the lock so a battle is applied exactly once.
        if (!(await (0, _sector_war_store_js_1.loadSectorWarToken)(battleId)))
            return { ok: false, error: 'already-resolved' };
        const contest = await (0, _sector_war_store_js_1.loadSectorWar)(id);
        if (!contest || contest.flipped) {
            await (0, _sector_war_store_js_1.consumeSectorWarToken)(battleId);
            return { ok: false, error: 'contest-closed' };
        }
        const atkRecord = (0, _war_state_js_1.normalizeVillageWarRecord)(token.attackerVillage, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(token.attackerVillage))) ?? undefined);
        const damage = Math.round(_war_state_js_1.SECTOR_CONTROL_HP_PER_WIN * (0, _war_structures_js_1.sectorWarDamageMultiplier)(atkRecord));
        const outcome = (0, _sector_war_js_1.applySectorBattleResult)(contest, attackerWon, { now: Date.now(), damage });
        if (outcome.captured) {
            // Flip the sector's persistent owner (territory lock, nested) BEFORE
            // closing the contest, so the capture + flip commit under one lock
            // scope. Re-running is idempotent (ownerVillage already set).
            await (0, world_state_js_1.captureSectorForVillage)(token.sector, token.attackerVillage, Date.now());
            await (0, _sector_war_store_js_1.deleteSectorWar)(id);
            // Telemetry (best-effort): a sector flipped to the attacker.
            void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `capture:${id}`, village: token.attackerVillage, kind: 'sector.capture', amount: 1, meta: `sector:${token.sector}` });
        }
        else {
            await (0, _sector_war_store_js_1.saveSectorWar)(outcome.session);
        }
        await (0, _sector_war_store_js_1.consumeSectorWarToken)(battleId);
        return { ok: true, outcome };
    }, { failClosed: true });
    if (!result.ok) {
        return res.status(409).json({
            error: result.error === 'already-resolved' ? 'That battle was already resolved.' : 'The contest is no longer active.',
        });
    }
    return res.status(200).json({
        ok: true,
        attackerWon,
        captured: result.outcome.captured,
        controlHp: result.outcome.captured ? 0 : result.outcome.session.controlHp,
        controlHpMax: result.outcome.session.controlHpMax,
        hpDealt: result.outcome.hpDealt,
        hpRegen: result.outcome.hpRegen,
    });
}
// ── status (read-only) ─────────────────────────────────────────────────────────
async function doStatus(_req, res, body) {
    const sector = Math.floor(Number(body.sector) || 0);
    if (sector) {
        const [ownerVillage, contest] = await Promise.all([(0, _sector_war_store_js_1.getSectorOwnerVillage)(sector), (0, _sector_war_store_js_1.activeContestOnSector)(sector)]);
        return res.status(200).json({ ok: true, sector, ownerVillage, contest });
    }
    const contests = await (0, _sector_war_store_js_1.listActiveSectorWars)();
    return res.status(200).json({ ok: true, contests });
}
// ── seed (admin, Phase 4d) ─────────────────────────────────────────────────────
async function doSeed(res, identity) {
    if (!identity.admin)
        return res.status(403).json({ error: 'Admin only.' });
    const seeded = await (0, world_state_js_1.seedHomeSectorOwnership)(Date.now());
    return res.status(200).json({ ok: true, ...seeded });
}
