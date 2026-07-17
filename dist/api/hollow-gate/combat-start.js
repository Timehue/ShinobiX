"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _authoritative_pve_js_1 = require("../_authoritative-pve.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _run_token_js_1 = require("./_run-token.js");
const _combat_session_js_1 = require("./_combat-session.js");
/** Start or resume one run-bound Hollow Gate shinobi encounter. */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const floor = Math.floor(Number(body.floor));
        const kind = body.kind;
        const nodeId = (0, _combat_session_js_1.normalizeHollowGateNodeId)(body.nodeId);
        if (!playerName || !token || !nodeId || !Number.isFinite(floor) || !(0, _combat_session_js_1.isHollowGateCombatKind)(kind)) {
            return res.status(400).json({ error: 'Invalid Hollow Gate encounter.' });
        }
        if (!nodeId.startsWith(`floor:${floor}:`))
            return res.status(400).json({ error: 'Encounter node/floor mismatch.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'hollow-gate-combat-start', 20, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        const runKey = (0, _run_token_js_1.hollowGateRunKey)(playerName, token);
        const outcome = await (0, _lock_js_1.withKvLock)(runKey, async () => {
            const run = await _storage_js_1.kv.get(runKey);
            if (!run)
                return { status: 409, body: { error: _run_token_js_1.HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatStart } };
            if (run.playerName !== playerName)
                return { status: 403, body: { error: 'Not your run.' } };
            if (floor < 1 || floor > run.floorDepth)
                return { status: 409, body: { error: 'The encounter floor does not match the sealed run.' } };
            if (kind === 'boss' && floor !== run.floorDepth) {
                return { status: 409, body: { error: 'The floor boss is not available before the sealed final floor.' } };
            }
            if (run.activeEncounter) {
                const active = run.activeEncounter;
                if (active.floor !== floor || active.nodeId !== nodeId || active.kind !== kind) {
                    return { status: 409, body: { error: 'Finish the active Hollow Gate encounter before moving.' } };
                }
                const session = await (0, _tower_store_js_1.readSession)(active.runId);
                if (session)
                    return { status: 200, body: { ok: true, resumed: true, runId: active.runId, session } };
                // A combat board has a shorter storage lifetime than the sealed
                // run. If it vanished before settlement, discard only that
                // unresolved binding and recreate the exact same node below.
                await _storage_js_1.kv.del((0, _tower_store_js_1.sessionKey)(active.runId), (0, _combat_session_js_1.hollowGateCombatBindingKey)(active.runId)).catch(() => undefined);
                run.activeEncounter = null;
            }
            const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
            const encounterKey = (0, _combat_session_js_1.hollowGateEncounterKey)(floor, kind, nodeId);
            if (resolved.includes(encounterKey))
                return { status: 409, body: { error: 'That encounter was already resolved.' } };
            if (kind === 'boss' && resolved.some((entry) => entry.startsWith(`${floor}:boss:`))) {
                return { status: 409, body: { error: 'The floor boss was already resolved.' } };
            }
            if (resolved.filter((entry) => entry.startsWith(`${floor}:`)).length >= _combat_session_js_1.HOLLOW_GATE_MAX_COMBATS_PER_FLOOR) {
                return { status: 429, body: { error: 'The sealed floor encounter limit was reached.' } };
            }
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = save?.character;
            if (!save || !char)
                return { status: 404, body: { error: 'Player save not found.' } };
            if (char.hospitalized === true || Number(char.hp ?? 0) <= 0) {
                return { status: 409, body: { error: 'You cannot enter combat while hospitalized.' } };
            }
            const savedRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
                ? char.hollowGateRun
                : null;
            const activePet = Array.isArray(char.pets)
                ? char.pets.find((pet) => String(pet.id ?? '') === String(char.activePetId ?? ''))
                : undefined;
            const expedition = activePet?.expedition && typeof activePet.expedition === 'object'
                ? activePet.expedition
                : null;
            const petAssisted = Boolean(activePet?.unlockedForPve)
                && (!expedition || Number(expedition.endsAt ?? 0) <= Date.now());
            const binding = (0, _combat_session_js_1.createHollowGateCombatBinding)({
                playerName,
                token,
                floor,
                nodeId,
                kind,
                secondWindArmed: run.secondWindArmed === true && savedRun?.runToken === token,
                petAssisted,
            });
            const seed = identity.admin ? 12345 : (0, node_crypto_1.randomInt)(1, 0x7fffffff);
            const floorDef = (0, _authoritative_pve_js_1.dynamicBossFloor)({
                id: 9_200 + floor,
                name: `Hollow Gate Floor ${floor}`,
                bossAiId: binding.enemyProfileId,
                objective: 'defeat-boss',
                roundBudget: kind === 'boss' ? 30 : 24,
                biome: 'shadow',
            });
            const augment = run.chosenAugmentId ? _run_token_js_1.AUGMENT_CATALOG[run.chosenAugmentId] : undefined;
            const session = (0, _authoritative_pve_js_1.buildAuthoritativeSoloEncounter)({
                playerName,
                save,
                floor: floorDef,
                bossTemplate: (0, _authoritative_pve_js_1.hollowGateEnemyTemplate)({
                    playerLevel: Math.max(1, Math.floor(Number(char.level) || 1)),
                    floor,
                    maxFloor: run.floorDepth,
                    kind,
                    profileId: kind === 'boss' ? (run.bossProfileId ?? binding.enemyProfileId) : binding.enemyProfileId,
                    displayName: kind === 'boss' ? run.bossName : undefined,
                    combatEffect: augment?.combat,
                    petLevel: petAssisted ? Math.max(1, Math.floor(Number(activePet?.level) || 1)) : undefined,
                    gentleNonBoss: Boolean(run.variantId?.startsWith('rift-')),
                }),
                runId: binding.runId,
                seed,
                now: binding.createdAt,
                towerId: 'hollow-gate',
                hostLoadout: body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout : undefined,
            });
            if (petAssisted) {
                const squadActor = session.actors.find((actor) => actor.side === 'squad' && actor.ownerSlug === playerName);
                if (squadActor) {
                    squadActor.hp = squadActor.maxHp;
                    squadActor.chakra = squadActor.maxChakra;
                    squadActor.stamina = squadActor.maxStamina;
                }
            }
            try {
                await (0, _tower_store_js_1.writeSession)(session);
                await _storage_js_1.kv.set((0, _combat_session_js_1.hollowGateCombatBindingKey)(binding.runId), binding, { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
                await _storage_js_1.kv.set(runKey, { ...run, activeEncounter: {
                        runId: binding.runId,
                        nodeId: binding.nodeId,
                        floor: binding.floor,
                        kind: binding.kind,
                        enemyProfileId: binding.enemyProfileId,
                        createdAt: binding.createdAt,
                    } }, { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
            }
            catch (error) {
                await _storage_js_1.kv.del((0, _tower_store_js_1.sessionKey)(binding.runId), (0, _combat_session_js_1.hollowGateCombatBindingKey)(binding.runId)).catch(() => undefined);
                throw error;
            }
            return { status: 200, body: { ok: true, runId: binding.runId, session, petAssisted } };
        }, { failClosed: true, ttlSec: 10 });
        if (!outcome)
            return res.status(503).json({ error: 'The Hollow Gate is busy. Retry shortly.' });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[hollow-gate/combat-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
