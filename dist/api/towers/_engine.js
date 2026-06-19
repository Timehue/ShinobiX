"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTERY_MIN_DAMAGE_FRAC = exports.JUTSU_MAX_LEVEL = exports.K_DR = exports.BASIC_ATTACK_AP = exports.MOVE_AP = exports.STUN_AP_PENALTY = exports.MAX_ROUNDS = exports.MAX_ACTIONS = exports.BASE_AP = void 0;
exports.towerNeighbors = towerNeighbors;
exports.computeDamage = computeDamage;
exports.startRound = startRound;
exports.checkTowerWinner = checkTowerWinner;
exports.applyAction = applyAction;
exports.endTurn = endTurn;
exports.pickAiAction = pickAiAction;
exports.applyPartyScaling = applyPartyScaling;
exports.runTowerFloor = runTowerFloor;
exports.runAiUntilHuman = runAiUntilHuman;
/*
 * Battle Towers — N-actor combat ENGINE (Phase 1, P1.A2).
 *
 * The generalization of api/pvp/move.ts from 2 fighters (p1/p2) to N actors across
 * sides. It owns: the turn scheduler, explicit-target action resolution, the faithful
 * (ported) deterministic damage formula, team/last-standing win-check, party scaling,
 * and a deterministic auto-run used for async resolution + the settle recompute.
 *
 * DETERMINISM (Decision 2): no Math.random / Date.now anywhere; the seeded RNG is
 * threaded explicitly and used ONLY for AI tie-breaking — damage is a pure function of
 * stats (matching PvP, which has no damage RNG). Same (session, seed) → identical run.
 *
 * V1 SCOPE (faithful core): move / basic-attack / single-target jutsu damage, the
 * scaledEp × EP_MULTIPLIER × statFactor formula + armor DR pool, side-based rounds,
 * team win-check + defeat/protect/reach objectives, party-scaled enemy HP.
 * DEFERRED to Phase 1b/3 (additive layers, documented in the plan): the full tag/status
 * system (Wound/Poison/Reflect/Absorb/Lifesteal/Pierce/Stun-on-cast), AOE, weather/terrain
 * mults, chakra/stamina resource costs, interleaved boss-interrupt turns, boss-phase
 * mechanics, and the kill-adds-first / break-objective / defeat-all-then-boss gating
 * (these currently resolve as "all enemies dead"; the v1 catalog ships none of them).
 */
const _sim_js_1 = require("./_sim.js");
const _aoe_js_1 = require("../pvp/_aoe.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _tower_session_js_1 = require("./_tower-session.js");
// ─── Constants (ported from api/pvp/move.ts, verified @ 586f0560) ────────────
exports.BASE_AP = 100;
exports.MAX_ACTIONS = 5;
exports.MAX_ROUNDS = 25;
exports.STUN_AP_PENALTY = 40;
exports.MOVE_AP = 30;
exports.BASIC_ATTACK_AP = 40;
exports.K_DR = 0.5;
exports.JUTSU_MAX_LEVEL = 50;
exports.MASTERY_MIN_DAMAGE_FRAC = 0.3;
// ─── Hex geometry (generalized to arbitrary width/height; mirrors move.ts) ───
function xy(pos, w) { return { x: pos % w, y: Math.floor(pos / w) }; }
function posFromXY(x, y, w, h) {
    if (x < 0 || x >= w || y < 0 || y >= h)
        return -1;
    return y * w + x;
}
function towerNeighbors(pos, w, h) {
    const { x, y } = xy(pos, w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx, y + dy, w, h)).filter(n => n >= 0);
}
function occupantAt(session, tile, ignoreId) {
    return session.actors.find(a => a.hp > 0 && a.pos === tile && a.id !== ignoreId);
}
function isTileBlocked(session, tile, ignoreId) {
    if (session.map.blockedTiles.includes(tile))
        return true;
    return !!occupantAt(session, tile, ignoreId);
}
// Greedy one-step move toward `to`, avoiding blocked/occupied tiles. Deterministic
// (ties broken by lowest tile index). Returns `from` if no step improves distance.
function nextStepToward(session, from, to, ignoreId) {
    const w = session.map.width;
    const here = (0, _aoe_js_1.hexDistance)(from, to, w);
    let best = from;
    let bestD = here;
    for (const n of towerNeighbors(from, w, session.map.height).sort((a, b) => a - b)) {
        if (isTileBlocked(session, n, ignoreId))
            continue;
        const d = (0, _aoe_js_1.hexDistance)(n, to, w);
        if (d < bestD) {
            bestD = d;
            best = n;
        }
    }
    return best;
}
// ─── Damage (faithful port of resolveBaseDamage core; deterministic) ─────────
function getOffense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function clampMastery(n) { return Math.max(0, Math.min(exports.JUTSU_MAX_LEVEL, Number(n) || 0)); }
function computeDamage(attacker, defender, jutsu, masteryLevel) {
    const ep = Number(jutsu.effectPower ?? 20);
    const epAtMax = ep + exports.JUTSU_MAX_LEVEL * 0.2;
    const masteryFrac = exports.MASTERY_MIN_DAMAGE_FRAC + (1 - exports.MASTERY_MIN_DAMAGE_FRAC) * (clampMastery(masteryLevel) / exports.JUTSU_MAX_LEVEL);
    const scaledEp = Math.max(0, epAtMax * masteryFrac);
    const type = String(jutsu.type ?? 'Taijutsu');
    const offStats = attacker.character.stats ?? {};
    const defStats = defender.character.stats ?? {};
    const sf = (0, _sim_js_1.statFactor)(getOffense(offStats, type), getDefense(defStats, type));
    const bloodlineMult = Math.max(1, Number(attacker.character.bloodlineMult ?? 1));
    const itemDamageMult = 1 + Math.max(0, Number(attacker.character.itemDamagePct ?? 0)) / 100;
    // Party-scale on enemy damage (set by applyPartyScaling for smaller parties; 1 otherwise).
    const partyDmgScale = Math.max(0, Number(attacker.character.towerDmgScale ?? 1));
    const baseDmg = Math.max(0, Math.floor(scaledEp * _sim_js_1.EP_MULTIPLIER * sf * bloodlineMult * itemDamageMult * partyDmgScale));
    // Armor DR pool (status DR is the deferred tag layer): effectiveDR = raw/(raw+K_DR).
    const armorRawDR = (defender.character.armorRawDR != null)
        ? Math.min(1.5, Math.max(0, Number(defender.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(defender.character.armorFactor ?? 1.0))));
    const effectiveDR = armorRawDR > 0 ? armorRawDR / (armorRawDR + exports.K_DR) : 0;
    return Math.max(0, Math.floor(baseDmg * (1 - effectiveDR)));
}
// ─── Targeting / sides ───────────────────────────────────────────────────────
function hostileSidesFor(side) {
    // Squad fights enemies; enemies fight squad + the protected npc.
    return side === 'squad' ? ['enemy'] : ['squad', 'npc'];
}
function opponentsOf(session, actor) {
    const sides = hostileSidesFor(actor.side);
    return session.actors.filter(a => a.hp > 0 && sides.includes(a.side));
}
function nearestOpponent(session, actor) {
    const w = session.map.width;
    let best;
    let bestD = Infinity;
    for (const o of opponentsOf(session, actor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const d = (0, _aoe_js_1.hexDistance)(actor.pos, o.pos, w);
        if (d < bestD) {
            bestD = d;
            best = o;
        }
    }
    return best;
}
// ─── Loadout helpers ─────────────────────────────────────────────────────────
function actorSpecialty(actor) {
    const s = String(actor.character.specialty ?? 'Taijutsu');
    return ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(s) ? s : 'Taijutsu';
}
function findJutsu(actor, jutsuId) {
    const list = actor.character.jutsu;
    if (!Array.isArray(list))
        return undefined;
    return list.find(j => j && j.id === jutsuId);
}
function masteryFor(actor, jutsuId) {
    const m = actor.character.jutsuMastery;
    if (!Array.isArray(m))
        return 0;
    const hit = m.find(x => x && x.jutsuId === jutsuId);
    return hit ? clampMastery(hit.level ?? 0) : 0;
}
// ─── Turn scheduler (side-based rounds; interleaved boss-interrupt is Phase 3) ─
function rebuildTurnQueue(session) {
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const squad = (0, _tower_session_js_1.livingOnSide)(session, 'squad').sort(byId).map(a => a.id);
    const enemy = (0, _tower_session_js_1.livingOnSide)(session, 'enemy').sort(byId).map(a => a.id);
    session.turnQueue = [...squad, ...enemy]; // npc actors are passive in v1 (protect targets)
}
function canAct(session, cost) {
    return session.activeAp >= cost && session.actionsThisTurn < exports.MAX_ACTIONS;
}
function isStunned(actor) {
    return actor.statuses.some(s => s.name === 'Stun' || s.name === 'Stunned');
}
function refreshAp(session) {
    const actor = (0, _tower_session_js_1.activeActor)(session);
    if (actor && isStunned(actor)) {
        // Stun costs AP once and is CONSUMED at the start of the penalized turn (mirrors
        // api/pvp/move.ts:893-902) — never re-penalizing a lingering Stun every round.
        session.activeAp = Math.max(0, exports.BASE_AP - exports.STUN_AP_PENALTY);
        actor.statuses = actor.statuses.filter(s => s.name !== 'Stun' && s.name !== 'Stunned');
    }
    else {
        session.activeAp = exports.BASE_AP;
    }
    session.actionsThisTurn = 0;
}
function startRound(session) {
    rebuildTurnQueue(session);
    session.activeIndex = 0;
    refreshAp(session);
}
// ─── Win-check + objectives ──────────────────────────────────────────────────
function bossDead(session) {
    const id = session.phaseState.bossId;
    if (!id)
        return false;
    const boss = (0, _tower_session_js_1.getActor)(session, id);
    return !!boss && boss.hp <= 0;
}
function squadWinsByObjective(session, floor) {
    switch (floor.objective) {
        case 'defeat-boss':
            // If a boss is resolved, the boss must die; if a floor was misconfigured with no
            // bossId, fall back to a full wipe so a genuine clear is never scored as a loss.
            return session.phaseState.bossId ? bossDead(session) : !(0, _tower_session_js_1.isSideAlive)(session, 'enemy');
        case 'reach-tile':
            // Robust to spawn-on-goal + (future) displacement: a LIVING squad actor on the
            // goal tile wins, not just one that *moved* there this turn.
            return typeof floor.goalTile === 'number'
                ? session.actors.some(a => a.side === 'squad' && a.hp > 0 && a.pos === floor.goalTile)
                : !!session.objectiveState.reachedGoal;
        case 'survive':
            return (session.objectiveState.roundsSurvived ?? 0) >= floor.roundBudget;
        case 'protect-npc':
        case 'kill-escort':
            return !(0, _tower_session_js_1.isSideAlive)(session, 'enemy') && (0, _tower_session_js_1.isSideAlive)(session, 'npc');
        // defeat-all / defeat-all-then-boss / kill-adds-first / break-objective
        default:
            return !(0, _tower_session_js_1.isSideAlive)(session, 'enemy');
    }
}
function objectiveFailed(session, floor) {
    if (floor.objective === 'protect-npc' || floor.objective === 'kill-escort') {
        // npc(s) existed and are all down
        return session.actors.some(a => a.side === 'npc') && !(0, _tower_session_js_1.isSideAlive)(session, 'npc');
    }
    return false;
}
function checkTowerWinner(session, floor) {
    if (session.status !== 'active')
        return;
    if (!(0, _tower_session_js_1.isSideAlive)(session, 'squad')) {
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Squad wiped — floor failed.');
        return;
    }
    if (objectiveFailed(session, floor)) {
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Objective failed.');
        return;
    }
    if (squadWinsByObjective(session, floor)) {
        session.status = 'done';
        session.winner = 'squad';
        session.objectiveState.completed = true;
        session.log.push(`Floor ${floor.id} cleared!`);
    }
}
// Move crossed boss HP-phase thresholds from pending → triggered (hook for Phase 3 mechanics).
function tickBossPhases(session) {
    const id = session.phaseState.bossId;
    if (!id)
        return;
    const boss = (0, _tower_session_js_1.getActor)(session, id);
    if (!boss || boss.maxHp <= 0)
        return;
    const pct = (boss.hp / boss.maxHp) * 100;
    while (session.phaseState.pendingPhases.length && pct <= session.phaseState.pendingPhases[0]) {
        const t = session.phaseState.pendingPhases.shift();
        session.phaseState.triggeredPhases.push(t);
        session.log.push(`${boss.name} enters a new phase (${t}% HP).`);
    }
}
// ─── Action application ──────────────────────────────────────────────────────
function applyAction(session, floor, action, rng) {
    void rng; // reserved: AI tie-breaking / future variance — damage stays deterministic
    if (session.status !== 'active')
        return { applied: false, reason: 'session-done' };
    const actor = (0, _tower_session_js_1.activeActor)(session);
    if (!actor || actor.id !== action.actorId)
        return { applied: false, reason: 'not-your-turn' };
    if (actor.hp <= 0)
        return { applied: false, reason: 'down' };
    if (action.type === 'wait')
        return { applied: true };
    if (action.type === 'move') {
        if (!canAct(session, exports.MOVE_AP))
            return { applied: false, reason: 'cannot-act' };
        const w = session.map.width;
        if ((0, _aoe_js_1.hexDistance)(actor.pos, action.tile, w) !== 1)
            return { applied: false, reason: 'not-adjacent' };
        if (isTileBlocked(session, action.tile, actor.id))
            return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        session.activeAp -= exports.MOVE_AP;
        session.actionsThisTurn += 1;
        if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
            session.objectiveState.reachedGoal = true;
        }
        checkTowerWinner(session, floor);
        return { applied: true };
    }
    // attack / jutsu — need a living, hostile, in-range target
    const target = (0, _tower_session_js_1.getActor)(session, action.targetId);
    if (!target || target.hp <= 0)
        return { applied: false, reason: 'no-target' };
    if (!hostileSidesFor(actor.side).includes(target.side))
        return { applied: false, reason: 'friendly-fire' };
    const dist = (0, _aoe_js_1.hexDistance)(actor.pos, target.pos, session.map.width);
    let jutsu;
    let cost;
    let mastery = 0;
    if (action.type === 'attack') {
        jutsu = { id: 'basic-attack', effectPower: 10, type: actorSpecialty(actor), ap: exports.BASIC_ATTACK_AP, range: 1 };
        cost = exports.BASIC_ATTACK_AP;
        if (dist > 1)
            return { applied: false, reason: 'out-of-range' };
    }
    else {
        const j = findJutsu(actor, action.jutsuId);
        if (!j)
            return { applied: false, reason: 'no-jutsu' };
        jutsu = j;
        cost = Number(j.ap ?? 40);
        mastery = masteryFor(actor, action.jutsuId);
        const range = Math.max(1, Number(j.range ?? 1));
        if (dist > range)
            return { applied: false, reason: 'out-of-range' };
    }
    if (!canAct(session, cost))
        return { applied: false, reason: 'cannot-act' };
    const dmg = computeDamage(actor, target, jutsu, mastery);
    target.hp = Math.max(0, target.hp - dmg);
    session.activeAp -= cost;
    session.actionsThisTurn += 1;
    session.log.push(`${actor.name} hits ${target.name} for ${dmg} (${target.hp}/${target.maxHp}).`);
    tickBossPhases(session);
    checkTowerWinner(session, floor);
    return { applied: true };
}
// ─── Turn advance ────────────────────────────────────────────────────────────
function endTurn(session, floor) {
    if (session.status !== 'active')
        return;
    let idx = session.activeIndex + 1;
    while (idx < session.turnQueue.length) {
        const a = (0, _tower_session_js_1.getActor)(session, session.turnQueue[idx]);
        if (a && a.hp > 0)
            break;
        idx++;
    }
    if (idx < session.turnQueue.length) {
        session.activeIndex = idx;
        refreshAp(session);
        return;
    }
    // round complete
    session.objectiveState.roundsSurvived = (session.objectiveState.roundsSurvived ?? 0) + 1;
    checkTowerWinner(session, floor);
    if (session.status !== 'active')
        return;
    if (session.round >= exports.MAX_ROUNDS) {
        // hard timeout: failed to clear in time (survive floors win above before reaching here)
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Round limit reached — floor failed.');
        return;
    }
    session.round += 1;
    startRound(session);
}
// ─── Deterministic AI policy (v1 — nearest-target; richer policy = P1.A3) ─────
function bestAffordableJutsu(session, actor, dist) {
    const list = actor.character.jutsu;
    if (!Array.isArray(list))
        return undefined;
    const opts = list
        .filter(j => j && typeof j.id === 'string')
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => canAct(session, Number(j.ap ?? 40)))
        // deterministic: highest effectPower, ties by id
        .sort((a, b) => (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0)) || (String(a.id) < String(b.id) ? -1 : 1));
    return opts[0];
}
function pickAiAction(session, actor, rng) {
    void rng;
    const target = nearestOpponent(session, actor);
    if (!target)
        return { actorId: actor.id, type: 'wait' };
    const dist = (0, _aoe_js_1.hexDistance)(actor.pos, target.pos, session.map.width);
    const j = bestAffordableJutsu(session, actor, dist);
    if (j && j.id)
        return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && canAct(session, exports.BASIC_ATTACK_AP))
        return { actorId: actor.id, type: 'attack', targetId: target.id };
    if (canAct(session, exports.MOVE_AP)) {
        const step = nextStepToward(session, actor.pos, target.pos, actor.id);
        if (step !== actor.pos)
            return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}
// ─── Party scaling ───────────────────────────────────────────────────────────
// Scale enemy HP for a party smaller than the floor's balance baseline. Called by the
// encounter builder (start.ts, P1.B1) after enemies are built. Squad/npc untouched.
function applyPartyScaling(session, floor) {
    const factor = (0, _floor_catalog_js_1.partyScaleFactor)(session.partySize, (0, _floor_catalog_js_1.getFloorBalanceFor)(floor));
    if (factor >= 1)
        return;
    for (const a of session.actors) {
        if (a.side !== 'enemy')
            continue;
        // Idempotency guard: never double-scale (a settle recompute or accidental second
        // call must not weaken enemies further). towerDmgScale is the "already scaled" mark.
        if (a.character.towerDmgScale != null)
            continue;
        a.maxHp = (0, _floor_catalog_js_1.scaleEnemyStat)(a.maxHp, factor);
        a.hp = Math.min(a.hp, a.maxHp);
        // Enemy outgoing damage scales by the same factor (read by computeDamage).
        a.character.towerDmgScale = factor;
    }
}
// ─── Deterministic auto-run (async resolution + settle recompute) ────────────
// Drives every actor via the AI policy to a terminal state. Used when the whole floor
// is AI-resolved (async squads) and by settle.ts to recompute the clear from the seed.
function runTowerFloor(session, floor, rng) {
    if (session.turnQueue.length === 0)
        startRound(session);
    const GUARD = (exports.MAX_ROUNDS + 2) * (session.actors.length + 2) * (exports.MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = (0, _tower_session_js_1.activeActor)(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') {
            endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= exports.MAX_ACTIONS) {
            const action = pickAiAction(session, actor, rng);
            if (action.type === 'wait')
                break;
            const res = applyAction(session, floor, action, rng);
            if (!res.applied)
                break;
        }
        if (session.status === 'active')
            endTurn(session, floor);
    }
    checkTowerWinner(session, floor);
    return session;
}
// Live-mode driver: advance AI actors' turns until it is a HUMAN's turn (ai === false) or
// the floor resolves. Used by api/towers/action.ts after a human submits a turn-ending
// action, so the human only ever sees their own turns. Deterministic (seeded rng).
function runAiUntilHuman(session, floor, rng) {
    if (session.turnQueue.length === 0)
        startRound(session);
    const GUARD = (exports.MAX_ROUNDS + 2) * (session.actors.length + 2) * (exports.MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = (0, _tower_session_js_1.activeActor)(session);
        if (actor && actor.ai === false && actor.hp > 0)
            break; // a live human's turn — stop
        if (!actor || actor.hp <= 0 || actor.side === 'npc') {
            endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= exports.MAX_ACTIONS) {
            const a = pickAiAction(session, actor, rng);
            if (a.type === 'wait')
                break;
            if (!applyAction(session, floor, a, rng).applied)
                break;
        }
        if (session.status === 'active')
            endTurn(session, floor);
    }
}
