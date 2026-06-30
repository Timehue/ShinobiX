"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _war_state_js_1 = require("../_war-state.js");
const _war_structures_js_1 = require("../_war-structures.js");
const _sector_war_js_1 = require("../_sector-war.js");
const _sector_war_store_js_1 = require("../_sector-war-store.js");
const world_state_js_1 = require("../world-state.js");
const pet_duel_sim_js_1 = require("../_pet-sim/pet-duel-sim.js");
const _pet_stat_ceil_js_1 = require("../_pet-stat-ceil.js");
/*
 * /api/village/sector-pet — POST only. The sector-war "Pet" win-condition (Phase 7).
 *
 * A Pet sector-war is a deterministic 1v1 PET DUEL resolved SERVER-SIDE by the exact
 * engine the client renders — api/pet-sim/pet-duel-sim is a GENERATED copy of
 * lib/pet-duel-sim (scripts/gen-pet-sim.mjs; the parity test guards it byte-for-byte).
 * Two real players each bring a pet: the attacker opens, the defender joins, and the
 * duel auto-resolves the instant both pets are in — no turns, the sim is deterministic
 * from (both pets, seed). The winner maps onto the contest exactly like Combat/Card:
 * attacker win → chip Control HP (flip on capture), defender win → regen, draw → no
 * change. The client REPLAYS the same (pets, seed) to show the fight — identical to
 * the server, so it can never disagree on who won.
 *
 * Pet stats are clamped server-side (petStatCeil) so a tampered save can't seal an OP
 * pet. Server-gated: 404 unless ENABLE_VILLAGE_WAR=1.
 *
 * Body: { action, sectorWarId, petId? }
 *   join  { petId }  attacker opens with a pet / defender joins with a pet → resolve
 *   state {}         read the session (drives the defender join + the client replay)
 */
const SESSION_TTL_SEC = 30 * 60; // 30m hygiene — abandoned duels self-clean
const CEIL_STATS = ['hp', 'attack', 'defense', 'speed'];
function sessionKey(sectorWarId) { return `sector-pet:${sectorWarId}`; }
async function villageOf(playerName) {
    const save = await _storage_js_1.kv.get(`save:${playerName.toLowerCase()}`);
    return String(save?.character?.village ?? '').trim();
}
// Seal a player's chosen pet from their save (by id, else active, else first), then
// CLAMP the four battle stats to the per-rarity anti-tamper ceiling so a tampered
// save can't field an absurd pet into a territory-flipping duel.
async function sealPlayerPet(playerName, petId) {
    const save = await _storage_js_1.kv.get(`save:${playerName.toLowerCase()}`);
    const pets = Array.isArray(save?.character?.pets) ? save.character.pets : [];
    if (!pets.length)
        return null;
    const activeId = String(save?.character?.activePetId ?? '');
    const raw = pets.find((p) => String(p.id) === petId)
        ?? pets.find((p) => String(p.id) === activeId)
        ?? pets[0];
    if (!raw)
        return null;
    const pet = { ...raw };
    for (const stat of CEIL_STATS) {
        const v = Number(raw[stat]) || 0;
        pet[stat] = Math.min(v, (0, _pet_stat_ceil_js_1.petStatCeil)(raw.rarity, stat));
    }
    return pet;
}
// Apply the duel winner to the sector-war contest — p1 = attacker, p2 = defender, so
// the winner maps straight on (attacker chip / defender regen / draw no-op). Idempotent
// via appliedToContest; nested under the session lock the caller holds.
async function applyPetOutcomeToContest(session) {
    await (0, _lock_js_1.withKvLock)((0, _sector_war_js_1.sectorWarKey)(session.sectorWarId), async () => {
        const contest = await (0, _sector_war_store_js_1.loadSectorWar)(session.sectorWarId);
        if (!contest || contest.flipped)
            return;
        const atkRecord = (0, _war_state_js_1.normalizeVillageWarRecord)(session.attackerVillage, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(session.attackerVillage))) ?? undefined);
        const damage = Math.round(_war_state_js_1.SECTOR_CONTROL_HP_PER_WIN * (0, _war_structures_js_1.sectorWarDamageMultiplier)(atkRecord));
        const outcome = (0, _sector_war_js_1.applyContestBattleByWinner)(contest, session.winner ?? 'draw', { now: Date.now(), damage });
        if (!outcome)
            return; // draw — Control HP untouched
        if (outcome.captured) {
            await (0, world_state_js_1.captureSectorForVillage)(session.sector, session.attackerVillage, Date.now());
            await (0, _sector_war_store_js_1.deleteSectorWar)(session.sectorWarId);
        }
        else {
            await (0, _sector_war_store_js_1.saveSectorWar)(outcome.session);
        }
    }, { failClosed: true });
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return res.status(404).json({ error: 'Not found.' });
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'sector-pet', 60, 60_000, identity.name)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body?.action ?? '').toLowerCase();
        const sectorWarId = String(body?.sectorWarId ?? '').trim();
        if (!sectorWarId)
            return res.status(400).json({ error: 'Missing sectorWarId.' });
        const me = identity.admin ? (0, _utils_js_1.safeName)(String(body?.playerName ?? '')) : identity.name;
        if (action === 'state') {
            const session = await _storage_js_1.kv.get(sessionKey(sectorWarId));
            if (!session)
                return res.status(404).json({ error: 'No pet duel session yet.' });
            return res.status(200).json({ session });
        }
        if (action !== 'join')
            return res.status(400).json({ error: `Unknown action: ${action}` });
        const result = await (0, _lock_js_1.withKvLock)(sessionKey(sectorWarId), async () => {
            const contest = await (0, _sector_war_store_js_1.loadSectorWar)(sectorWarId);
            if (!contest || contest.flipped)
                return { status: 409, body: { error: 'No active sector war for that id.' } };
            if (contest.winCondition !== 'pet')
                return { status: 409, body: { error: 'That sector is not a Pet contest.' } };
            const { attackerVillage, defenderVillage } = contest;
            const myVillage = identity.admin
                ? (String(body?.side ?? 'p1') === 'p2' ? defenderVillage : attackerVillage)
                : await villageOf(me);
            const isAttacker = myVillage === attackerVillage;
            const isDefender = myVillage === defenderVillage;
            if (!isAttacker && !isDefender)
                return { status: 403, body: { error: 'You are not a participant in this sector war.' } };
            const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
            if (!pet)
                return { status: 400, body: { error: 'You have no pet to send into battle.' } };
            const existing = await _storage_js_1.kv.get(sessionKey(sectorWarId));
            const now = Date.now();
            // Attacker opens a fresh duel (or re-opens after the last one finished).
            if (!existing || existing.status === 'done') {
                if (!isAttacker)
                    return { status: 409, body: { error: 'Waiting for an attacker to send a pet.' } };
                const session = {
                    sectorWarId, sector: contest.sector, attackerVillage, defenderVillage,
                    p1: { name: me, pet }, status: 'awaiting-defender', createdAt: now, updatedAt: now,
                };
                await _storage_js_1.kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
                return { status: 200, body: { session } };
            }
            // Idempotent re-open by the same attacker (e.g. a retry before a defender answered).
            if (existing.p1.name.toLowerCase() === me.toLowerCase()) {
                return { status: 200, body: { session: existing } };
            }
            if (existing.status !== 'awaiting-defender')
                return { status: 409, body: { error: 'This pet duel is no longer accepting a defender.' } };
            if (!isDefender)
                return { status: 409, body: { error: 'A defender of this sector must answer the pet duel.' } };
            // Defender joins → resolve the deterministic duel SERVER-SIDE + apply it.
            const seed = (now ^ (contest.sector * 2654435761)) >>> 0;
            const duel = (0, pet_duel_sim_js_1.runPetDuel)(existing.p1.pet, pet, seed, 1, 1, false, false, false);
            const winner = duel.winner === 'player' ? 'p1' : duel.winner === 'enemy' ? 'p2' : 'draw';
            const session = { ...existing, p2: { name: me, pet }, status: 'done', seed, winner, updatedAt: now };
            await applyPetOutcomeToContest(session);
            session.appliedToContest = true;
            await _storage_js_1.kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
            return { status: 200, body: { session } };
        });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[village/sector-pet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
