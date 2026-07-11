"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _era_js_1 = require("../_era.js");
const _progress_js_1 = require("../missions/_progress.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
const _war_state_js_1 = require("../_war-state.js");
const _sector_war_store_js_1 = require("../_sector-war-store.js");
const _seal_js_1 = require("../towers/_seal.js");
const _tower_session_js_1 = require("../towers/_tower-session.js");
const _engine_js_1 = require("../towers/_engine.js");
const _sim_js_1 = require("../towers/_sim.js");
const _anbu_infiltration_encounter_js_1 = require("../_anbu-infiltration-encounter.js");
const _anbu_infiltration_store_js_1 = require("../_anbu-infiltration-store.js");
const _anbu_infiltration_js_1 = require("../_anbu-infiltration.js");
/*
 * /api/village/anbu-infiltration — POST only. The Anbu Vault Infiltration raid
 * (docs/anbu-infiltration-plan.md): a level-100 sector-attrition activity, fully
 * server-authoritative, one route with an action switch (the sector-war.ts shape).
 *
 * Actions (body.action):
 *   - start   : gate-check, pick + daily-seal the defending Anbu, build the vault
 *               fight (shared Battle Towers engine; the Anbu is a sealed REAL
 *               loadout run as the AI boss), persist the run (infil:<runId>).
 *   - act     : submit ONE combat action for the raider's turn — engine-validated,
 *               'wait' advances the AI Anbu until the raider is up / the fight ends.
 *   - state   : read-only run fetch (refresh-restore).
 *   - report  : settle a FINISHED run. Win → server-rolled skim of the enemy war
 *               economy (both 50%/day ledgers enforced inside pool locks), caches +
 *               ryo minted under the save lock. Loss → nothing. Idempotent.
 *   - turn-in : convert held caches into standing points, type-locked (War Supply →
 *               clan 2:1, War Resource → village merit 1:1).
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 AND ENABLE_ANBU_INFILTRATION=1
 * (inert until the balance pass flips it — docs plan §12). NEVER flips sector
 * ownership; conquest stays with /village/sector-war.
 */
const LEVEL_REQUIREMENT = 100;
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
    if (process.env.ENABLE_VILLAGE_WAR !== '1' || process.env.ENABLE_ANBU_INFILTRATION !== '1') {
        return res.status(404).json({ error: 'Not found.' });
    }
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
            case 'start': return await doStart(req, res, identity, playerName, body);
            case 'act': return await doAct(req, res, identity, playerName, body);
            case 'state': return await doState(res, identity, playerName, body);
            case 'report': return await doReport(req, res, identity, playerName, body);
            case 'turn-in': return await doTurnIn(req, res, identity, playerName, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    }
    catch (err) {
        console.error('[village/anbu-infiltration]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
// ── start ─────────────────────────────────────────────────────────────────────
async function doStart(req, res, identity, playerName, body) {
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'anbu-infil-start', 10, 60_000, identity.name)))
        return;
    const sector = Math.floor(Number(body.sector) || 0);
    if (!sector)
        return res.status(400).json({ error: 'Missing sector.' });
    // The raider: save exists, level 100+, belongs to a village.
    const rec = await _storage_js_1.kv.get(`save:${playerName}`);
    const char = rec?.character;
    if (!char)
        return res.status(404).json({ error: 'Your save was not found.' });
    const level = Math.floor(Number(char.level) || 0);
    if (!identity.admin && level < LEVEL_REQUIREMENT) {
        return res.status(403).json({ error: `Anbu infiltration requires level ${LEVEL_REQUIREMENT}.` });
    }
    const raiderVillage = String(char.village ?? '').trim();
    if (!raiderVillage)
        return res.status(403).json({ error: 'You must belong to a village.' });
    // The target: an ENEMY-held war sector whose village has appointed Anbu (the
    // "Kage systems active" gate — a village with no functioning leadership has no
    // Anbu roster and cannot be infiltrated).
    const targetVillage = await (0, _sector_war_store_js_1.getSectorOwnerVillage)(sector);
    if (!targetVillage)
        return res.status(409).json({ error: 'That sector has no current owner.' });
    if (!(0, _war_map_sectors_js_1.isWarVillage)(targetVillage))
        return res.status(400).json({ error: 'That sector is not held by a war village.' });
    if (targetVillage === raiderVillage)
        return res.status(400).json({ error: 'You cannot infiltrate your own village’s sector.' });
    const appointees = await (0, _anbu_infiltration_store_js_1.loadAnbuAppointees)(targetVillage);
    if (appointees.length === 0) {
        return res.status(409).json({ error: 'That village has no appointed Anbu to defend its vaults yet.' });
    }
    // Daily attempt cap (counts ATTEMPTS — abandoning a run does not refund it).
    const started = await (0, _anbu_infiltration_store_js_1.bumpInfilStartCount)(playerName);
    if (!identity.admin && started > _anbu_infiltration_js_1.MAX_RAID_ATTEMPTS_PER_DAY) {
        return res.status(429).json({ error: 'Daily infiltration limit reached.' });
    }
    // Defender: least-recently-defended Anbu, sealed daily from their save.
    const anbuSlug = await (0, _anbu_infiltration_store_js_1.pickAnbuDefender)(targetVillage, appointees);
    const snapshot = anbuSlug ? await (0, _anbu_infiltration_store_js_1.getOrSealAnbuSnapshot)(targetVillage, anbuSlug) : null;
    if (!anbuSlug || !snapshot) {
        return res.status(409).json({ error: 'No defending Anbu could be prepared — try again shortly.' });
    }
    // Defender home-terrain edge: the sector's Kage-set terrain seals in as the
    // fight biome (identical mechanic to sector-war's terrain seal).
    const defRec = (0, _war_state_js_1.normalizeVillageWarRecord)(targetVillage, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(targetVillage))) ?? undefined);
    const terrain = String(defRec.sectors[String(sector)]?.terrain ?? 'central');
    // Seal the raider exactly like a tower host: authoritative save + the
    // client-computed combat extras the save doesn't persist (clamped in-seal).
    const raiderLoadout = (body.raiderLoadout && typeof body.raiderLoadout === 'object') ? body.raiderLoadout : {};
    const raiderCharacter = (0, _seal_js_1.sealTowerFighter)(char, rec ?? null, raiderLoadout);
    const runId = `infil-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
    const seed = identity.admin ? 12345 : (0, node_crypto_1.randomInt)(1, 0x7fffffff);
    const now = Date.now();
    const { session, floor } = (0, _anbu_infiltration_encounter_js_1.buildInfiltrationEncounter)({
        runId, seed, now,
        raider: { slug: playerName, name: String(char.name ?? playerName), character: raiderCharacter, itemCharges: (0, _seal_js_1.sealTowerItemCharges)(char) },
        anbu: { slug: snapshot.slug, name: snapshot.name, character: snapshot.character },
        terrain,
    });
    (0, _engine_js_1.startRound)(session);
    (0, _engine_js_1.runAiUntilHuman)(session, floor, (0, _sim_js_1.makeRng)(seed));
    const run = {
        runId, raiderSlug: playerName, sector, targetVillage,
        anbuSlug: snapshot.slug, anbuName: snapshot.name, terrain,
        session, createdAt: now,
    };
    await (0, _anbu_infiltration_store_js_1.writeInfilRun)(run);
    return res.status(200).json({
        ok: true, runId, sector, targetVillage,
        anbu: { name: snapshot.name }, session,
    });
}
// ── act (one combat action; mirrors /api/towers/action) ──────────────────────
async function doAct(req, res, identity, playerName, body) {
    const runId = String(body.runId ?? '');
    if (!runId)
        return res.status(400).json({ error: 'Missing runId.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'anbu-infil-act', 120, 60_000, playerName))
        return;
    const outcome = await (0, _lock_js_1.withKvLock)((0, _anbu_infiltration_store_js_1.infilRunKey)(runId), async () => {
        const run = await (0, _anbu_infiltration_store_js_1.readInfilRun)(runId);
        if (!run)
            return { status: 404, body: { error: 'Run not found or expired.' } };
        if (!identity.admin && run.raiderSlug !== playerName)
            return { status: 403, body: { error: 'Not your run.' } };
        const session = run.session;
        if (session.status !== 'active')
            return { status: 200, body: { applied: false, reason: 'session-done', session } };
        const actor = (0, _tower_session_js_1.activeActor)(session);
        const callerSlug = identity.admin ? null : identity.name;
        const owns = !!actor && (identity.admin || (actor.ai === false && actor.hp > 0 && actor.ownerSlug === callerSlug));
        if (!owns)
            return { status: 409, body: { error: 'Not your turn.', session } };
        const floor = (0, _anbu_infiltration_encounter_js_1.makeInfiltrationFloor)((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)(run.terrain));
        const rng = (0, _sim_js_1.makeRng)(session.seed);
        const type = String(body.type);
        // Build the action server-side with actorId = the verified active actor (no client spoof).
        const action = type === 'move' ? { actorId: actor.id, type: 'move', tile: Math.floor(Number(body.tile)) }
            : type === 'dash' ? { actorId: actor.id, type: 'dash', tile: Math.floor(Number(body.tile)) }
                : type === 'attack' ? { actorId: actor.id, type: 'attack', targetId: String(body.targetId ?? '') }
                    : type === 'jutsu' ? { actorId: actor.id, type: 'jutsu', jutsuId: String(body.jutsuId ?? ''), targetId: body.targetId !== undefined ? String(body.targetId) : undefined, tile: body.tile !== undefined ? Math.floor(Number(body.tile)) : undefined }
                        : type === 'weapon' ? { actorId: actor.id, type: 'weapon', targetId: String(body.targetId ?? ''), itemId: body.itemId ? String(body.itemId) : undefined }
                            : type === 'item' ? { actorId: actor.id, type: 'item', itemId: body.itemId ? String(body.itemId) : undefined }
                                : type === 'heal' ? { actorId: actor.id, type: 'heal' }
                                    : type === 'cleanse' ? { actorId: actor.id, type: 'cleanse' }
                                        : type === 'clear' ? { actorId: actor.id, type: 'clear', targetId: String(body.targetId ?? '') }
                                            : { actorId: actor.id, type: 'wait' };
        const result = (0, _engine_js_1.applyAction)(session, floor, action, rng);
        if (!result.applied) {
            return { status: 200, body: { applied: false, reason: result.reason, session } };
        }
        if (action.type === 'wait') {
            (0, _engine_js_1.endTurn)(session, floor);
            (0, _engine_js_1.runAiUntilHuman)(session, floor, rng); // the Anbu strikes back until the raider is up / it's over
        }
        await (0, _anbu_infiltration_store_js_1.writeInfilRun)(run); // refreshes the run TTL
        return { status: 200, body: { applied: true, session } };
    });
    return res.status(outcome.status).json(outcome.body);
}
// ── state (read-only refresh-restore) ─────────────────────────────────────────
async function doState(res, identity, playerName, body) {
    const runId = String(body.runId ?? '');
    if (!runId)
        return res.status(400).json({ error: 'Missing runId.' });
    const run = await (0, _anbu_infiltration_store_js_1.readInfilRun)(runId);
    if (!run)
        return res.status(404).json({ error: 'Run not found or expired.' });
    if (!identity.admin && run.raiderSlug !== playerName)
        return res.status(403).json({ error: 'Not your run.' });
    return res.status(200).json({ ok: true, runId, sector: run.sector, targetVillage: run.targetVillage, anbu: { name: run.anbuName }, session: run.session });
}
// ── report (settle a finished run — the ONLY reward path) ─────────────────────
async function doReport(req, res, identity, playerName, body) {
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'anbu-infil-report', 10, 60_000, identity.name)))
        return;
    const runId = String(body.runId ?? '');
    if (!runId)
        return res.status(400).json({ error: 'Missing runId.' });
    const run = await (0, _anbu_infiltration_store_js_1.readInfilRun)(runId);
    if (!run)
        return res.status(404).json({ error: 'Run not found, expired, or already settled.' });
    if (!identity.admin && run.raiderSlug !== playerName)
        return res.status(403).json({ error: 'Not your run.' });
    if (run.session.status !== 'done')
        return res.status(409).json({ error: 'The fight is not finished.' });
    if (run.session.winner !== 'squad') {
        // The Anbu held. No reward, no drain — the vault stands.
        await (0, _anbu_infiltration_store_js_1.deleteInfilRun)(runId);
        return res.status(200).json({ ok: true, won: false });
    }
    // Server-side roll — the client never picks the pool, the outcome, or amounts.
    const roll = (0, node_crypto_1.randomInt)(0, 1_000_000_000) / 1_000_000_000;
    const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(run, roll);
    if (!out.ok) {
        if (out.error === 'no-save')
            return res.status(404).json({ error: 'Your save was not found.' });
        return res.status(503).json({
            ok: false,
            error: 'The raid succeeded but the reward could not be saved. An admin can reconcile it — please do not retry.',
        });
    }
    await (0, _anbu_infiltration_store_js_1.deleteInfilRun)(runId);
    if (out.alreadySettled)
        return res.status(200).json({ ok: true, won: true, alreadySettled: true });
    // ── Mission / legacy / clan hooks (docs plan §9) ──────────────────────────
    // Best-effort AFTER the authoritative settle — a hook failure must never
    // unwind the paid reward. An infiltration win is a server-proofed raid:
    //   • Vanguards progress their 'vanguard-raids' daily missions.
    //   • Legacy (the L100 system) credits raidsCompleted + warContribution and
    //     the era's warBattles — identical to sector-war's resolve credit.
    //   • The raider's clan gets +1 eventContrib, which feeds the EXISTING clan
    //     'raid' mission (progress = eventContrib/3) and 'training'.
    let missionsCompleted = [];
    let missionXp = 0;
    try {
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = save?.character;
        if (char?.profession === 'vanguard') {
            const missionRes = await (0, _progress_js_1.reportMissionEvent)({ playerName, profession: 'vanguard', kind: 'vanguard-raids' });
            missionsCompleted = missionRes.missionsCompleted;
            missionXp = missionRes.xpAwarded;
        }
        if ((0, _legacy_track_js_1.legacyEnabled)()) {
            await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { raidsCompleted: 1, warContribution: 500 });
            await (0, _era_js_1.bumpEraContribution)('warBattles');
        }
        const clan = String(char?.clan ?? '').trim();
        if (clan) {
            await (0, _lock_js_1.withKvLock)((0, _utils_js_1.clanRecordKey)(clan), async () => {
                const key = (0, _utils_js_1.clanRecordKey)(clan);
                const rec = await _storage_js_1.kv.get(key);
                if (!rec)
                    return;
                const members = Array.isArray(rec.members) ? [...rec.members] : [];
                const i = members.findIndex(m => (0, _utils_js_1.safeName)(String(m?.name ?? '')) === playerName);
                if (i < 0)
                    return;
                members[i] = { ...members[i], eventContrib: (Number(members[i].eventContrib) || 0) + 1 };
                await _storage_js_1.kv.set(key, { ...rec, members });
            }); // default lock semantics — contrib is a counter, not currency
        }
    }
    catch (hookErr) {
        console.error('[village/anbu-infiltration] post-win hooks (non-fatal)', hookErr);
    }
    return res.status(200).json({
        ok: true, won: true, alreadySettled: false,
        rolled: out.rolled,
        supplySkim: out.supplySkim, wrSkim: out.wrSkim,
        supplyCaches: out.supplyCaches, wrCaches: out.wrCaches,
        ryo: out.ryo, overflowLost: out.overflowLost,
        missionsCompleted, missionXp,
        _saveVersion: out.saveVersion,
    });
}
// ── turn-in (caches → standing points, type-locked) ───────────────────────────
async function doTurnIn(req, res, identity, playerName, body) {
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'anbu-infil-turnin', 20, 60_000, identity.name)))
        return;
    const cacheRaw = String(body.cache ?? '');
    if (cacheRaw !== 'warSupply' && cacheRaw !== 'warResources') {
        return res.status(400).json({ error: 'Invalid cache type.' });
    }
    const cache = cacheRaw;
    const countRaw = Number(body.count);
    const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : undefined;
    const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName, cache, count });
    if (!out.ok) {
        if (out.error === 'no-save')
            return res.status(404).json({ error: 'Your save was not found.' });
        if (out.error === 'not-in-clan')
            return res.status(403).json({ error: 'You are not in a clan.' });
        // nothing-to-turn-in / cap-reached are normal game states, not errors.
        return res.status(200).json({ ok: false, reason: out.error });
    }
    return res.status(200).json({
        ok: true, dest: out.dest, points: out.points, consumed: out.consumed,
        remaining: out.remaining, _saveVersion: out.saveVersion,
    });
}
