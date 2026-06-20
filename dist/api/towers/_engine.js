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
// Utility jutsu = zero DIRECT damage (status/buff/debuff only — its value is its tags).
// Ported verbatim from api/pvp/move.ts isZeroDamageFortyApJutsu: prefer the explicit
// `isUtility` flag, else the legacy 40-AP convention (synthesized weapon/item ids exempt).
// NOTE: the tag layer is deferred (Phase 3) — so a utility jutsu currently lands no effect
// in towers; this guard at least stops it dealing phantom damage.
function isZeroDamageUtility(jutsu) {
    if (jutsu.isUtility === true)
        return true;
    if (jutsu.isUtility === false)
        return false;
    const id = String(jutsu.id ?? '');
    return jutsu.ap === 40 && id !== 'basic-attack' && !id.startsWith('item-');
}
function computeDamage(attacker, defender, jutsu, masteryLevel) {
    if (isZeroDamageUtility(jutsu))
        return 0;
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
// ─── Positional battlefield features (deterministic; position-based) ─────────
// A light tactical layer (a couple tiles per floor): pylons boost/weaken an
// element for a unit attacking FROM the tile, wards reduce damage TAKEN on the
// tile, hazards chip a unit standing on the tile at round end. All are pure
// functions of position + the floor's feature list — no RNG, no wall-clock — so
// the settle recompute reproduces them byte-for-byte. Floors without features
// (map.features undefined/empty) pay nothing here.
function mapFeatures(session) {
    return session.map.features ?? [];
}
/** Element boost/weaken for an attacker standing on a pylon tile. 1 when none apply. */
function pylonAttackMult(session, attacker, jutsu) {
    const el = String(jutsu.element ?? 'None');
    if (el === 'None' || !el)
        return 1; // basic attacks + non-elemental jutsu ignore pylons
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'pylon' || !f.tiles.includes(attacker.pos))
            continue;
        if (el === f.element)
            mult *= 1 + f.percent / 100;
        else if (el === f.weakenElement)
            mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Damage-taken reduction for a defender standing on a ward tile. 1 when none apply. */
function wardDefendMult(session, target) {
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind === 'ward' && f.tiles.includes(target.pos))
            mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Biome terrain affinity (+10% for the matching discipline) — faithful port of
 *  api/pvp/move.ts terrainMultiplier, keyed on the floor's biome. A "world boost". */
function terrainMult(session, jutsu) {
    const type = String(jutsu.type ?? '');
    switch (String(session.map.biome ?? '')) {
        case 'forest': return type === 'Taijutsu' ? 1.1 : 1;
        case 'snow': return type === 'Bukijutsu' ? 1.1 : 1;
        case 'volcano': return type === 'Ninjutsu' ? 1.1 : 1;
        case 'shadow': return type === 'Genjutsu' ? 1.1 : 1;
        default: return 1;
    }
}
/** Round-end chip to every living unit standing on a hazard tile. */
function applyRoundHazards(session) {
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'hazard')
            continue;
        for (const a of session.actors) {
            if (a.hp <= 0 || !f.tiles.includes(a.pos))
                continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * f.percent) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} takes ${dmg} from ${f.label ?? 'the hazard'} (${a.hp}/${a.maxHp}).`);
        }
    }
}
// ─── Boss mechanics (deterministic; tower-only) ──────────────────────────────
// Each boss has a signature mechanic that makes the fight distinct + tough. These are
// pure functions of the session state (no RNG / wall-clock), so settle reproduces them.
/** Enrage stacks ramp the boss's OUTGOING damage (+35% per stack). */
function attackerEnrageMult(attacker) {
    const e = Number(attacker.character.enrage ?? 0);
    return e > 0 ? 1 + 0.35 * e : 1;
}
/** A 'bulwark' boss takes HALF the damage while any of its guards (other enemies) live. */
function bulwarkMult(session, target) {
    if (String(target.character.mechanic ?? '') !== 'bulwark')
        return 1;
    const guardsAlive = session.actors.some(a => a.side === 'enemy' && a.id !== target.id && a.hp > 0);
    return guardsAlive ? 0.5 : 1;
}
/** Spawn the boss's reinforcements on free tiles around it (summon mechanic). */
function summonAdds(session) {
    const id = session.phaseState.bossId;
    const boss = id ? (0, _tower_session_js_1.getActor)(session, id) : undefined;
    if (!boss)
        return;
    const tpl = boss.character.summonTemplate;
    if (!tpl)
        return;
    const count = Math.max(1, Number(boss.character.summonCount ?? 2));
    const w = session.map.width, h = session.map.height;
    const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
    const blocked = new Set(session.map.blockedTiles);
    const scale = Math.max(0, Number(boss.character.towerDmgScale ?? 1)); // adds inherit the boss's party scaling
    let n = session.actors.filter(a => a.id.startsWith('add-')).length;
    let added = 0;
    for (const tile of towerNeighbors(boss.pos, w, h)) {
        if (added >= count)
            break;
        if (occupied.has(tile) || blocked.has(tile))
            continue;
        const hp = Math.max(1, Math.round(Number(tpl.hp ?? 300) * (scale < 1 ? scale : 1)));
        session.actors.push({
            id: `add-${n++}`, side: 'enemy', name: tpl.name ?? 'Add', ownerSlug: null, ai: true,
            hp, maxHp: hp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            shield: 0, statuses: [], cooldowns: {}, pos: tile,
            character: { specialty: tpl.specialty ?? 'Taijutsu', stats: { ...(tpl.stats ?? {}) }, visual: tpl.visual ?? 'bandit', ...(scale < 1 ? { towerDmgScale: scale } : {}) },
        });
        occupied.add(tile);
        added++;
    }
    if (added > 0)
        session.log.push(`${boss.name} summons ${added} reinforcement${added !== 1 ? 's' : ''}!`);
}
/** Fired when the boss crosses an HP-phase gate. */
function applyBossPhaseMechanic(session, boss) {
    const m = String(boss.character.mechanic ?? '');
    if (m === 'enrage') {
        boss.character.enrage = Number(boss.character.enrage ?? 0) + 1;
        session.log.push(`${boss.name} enrages — its blows hit harder!`);
    }
    else if (m === 'summon') {
        summonAdds(session);
    }
    // 'bulwark' is passive (damage reduction while guards live); 'regen' fires per round.
}
/** Per-round heal for a 'regen' boss (7% of max HP). */
function applyBossRegen(session) {
    const id = session.phaseState.bossId;
    const boss = id ? (0, _tower_session_js_1.getActor)(session, id) : undefined;
    if (!boss || boss.hp <= 0 || String(boss.character.mechanic ?? '') !== 'regen')
        return;
    const heal = Math.max(1, Math.floor(boss.maxHp * 0.07));
    const before = boss.hp;
    boss.hp = Math.min(boss.maxHp, boss.hp + heal);
    if (boss.hp > before)
        session.log.push(`${boss.name} regenerates ${boss.hp - before} HP.`);
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
function normalizeSlot(slot) {
    if (slot === 'weapon')
        return 'hand';
    if (slot === 'armor')
        return 'body';
    if (slot === 'accessory')
        return 'aura';
    return slot ?? '';
}
/** The actor's equipped item matching `itemId` (or the first equipped, if unspecified).
 *  Mirrors api/pvp/move.ts equippedPvpItem: only items in an `equipment` slot count. */
function equippedItem(actor, itemId) {
    const items = actor.character.pvpItems ?? [];
    const equipment = actor.character.equipment ?? {};
    const equippedIds = new Set(Object.values(equipment).filter((id) => Boolean(id)));
    return items.find(it => Boolean(it.id) && equippedIds.has(it.id) && (!itemId || it.id === itemId)) ?? null;
}
// Shared offensive resolution for attack / jutsu / weapon: applies positional + biome
// multipliers, computes deterministic damage, deducts HP/AP/actions, logs, and advances
// boss phases + the win-check. Resource (chakra/stamina) + cooldown bookkeeping is the
// caller's job (it differs per action type).
function resolveHit(session, floor, actor, target, jutsu, cost, mastery, label) {
    const envMult = pylonAttackMult(session, actor, jutsu) * wardDefendMult(session, target)
        * attackerEnrageMult(actor) * bulwarkMult(session, target) * terrainMult(session, jutsu);
    const dmg = Math.max(0, Math.floor(computeDamage(actor, target, jutsu, mastery) * envMult));
    target.hp = Math.max(0, target.hp - dmg);
    session.activeAp -= cost;
    session.actionsThisTurn += 1;
    session.log.push(`${actor.name} ${label} ${target.name} for ${dmg} (${target.hp}/${target.maxHp}).`);
    tickBossPhases(session);
    checkTowerWinner(session, floor);
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
/** Tick down an actor's jutsu cooldowns at the START of their turn (mirrors PvP's
 *  per-caster tickCooldowns). Removes lapsed entries so the map stays small. */
function tickCooldowns(actor) {
    for (const k of Object.keys(actor.cooldowns)) {
        const n = (actor.cooldowns[k] ?? 0) - 1;
        if (n > 0)
            actor.cooldowns[k] = n;
        else
            delete actor.cooldowns[k];
    }
}
function refreshAp(session) {
    const actor = (0, _tower_session_js_1.activeActor)(session);
    if (actor)
        tickCooldowns(actor);
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
        applyBossPhaseMechanic(session, boss); // enrage / summon fire at each gate
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
    // ── weapon: a hit from the equipped hand/thrown weapon (real weaponEp/range/AP) ──
    if (action.type === 'weapon') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || !['hand', 'thrown'].includes(slot))
            return { applied: false, reason: 'no-weapon' };
        const wCost = Math.max(0, Number(item.apCost ?? exports.BASIC_ATTACK_AP));
        if (!canAct(session, wCost))
            return { applied: false, reason: 'cannot-act' };
        const wTarget = (0, _tower_session_js_1.getActor)(session, action.targetId);
        if (!wTarget || wTarget.hp <= 0)
            return { applied: false, reason: 'no-target' };
        if (!hostileSidesFor(actor.side).includes(wTarget.side))
            return { applied: false, reason: 'friendly-fire' };
        const wRange = Math.max(1, Number(item.weaponRange ?? (slot === 'thrown' ? 4 : 1)));
        if ((0, _aoe_js_1.hexDistance)(actor.pos, wTarget.pos, session.map.width) > wRange)
            return { applied: false, reason: 'out-of-range' };
        // Thrown weapons spend from the sealed charge budget; hand weapons are reusable.
        if (slot === 'thrown') {
            const have = actor.itemCharges?.[item.id] ?? 0;
            if (have <= 0)
                return { applied: false, reason: 'out-of-ammo' };
            (actor.itemCharges ??= {})[item.id] = have - 1;
        }
        const weaponJutsu = {
            id: 'weapon', name: item.name ?? 'Weapon', type: 'Bukijutsu',
            isUtility: false, effectPower: Number(item.weaponEp ?? 15), ap: wCost, range: wRange,
        };
        resolveHit(session, floor, actor, wTarget, weaponJutsu, wCost, 0, 'strikes');
        return { applied: true };
    }
    // ── item: a self-targeted consumable. v1 supports restore-potions (chakra/stamina);
    // tag-effect consumables (smoke / Heal-tag potions) land with the deferred tag layer. ──
    if (action.type === 'item') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || ['hand', 'thrown'].includes(slot))
            return { applied: false, reason: 'no-item' };
        const restoreCk = Math.max(0, Number(item.restoreChakra ?? 0));
        const restoreSt = Math.max(0, Number(item.restoreStamina ?? 0));
        if (restoreCk <= 0 && restoreSt <= 0)
            return { applied: false, reason: 'unsupported-item' };
        const iCost = Math.max(0, Number(item.apCost ?? 35));
        if (!canAct(session, iCost))
            return { applied: false, reason: 'cannot-act' };
        const have = actor.itemCharges?.[item.id] ?? 0;
        if (have <= 0)
            return { applied: false, reason: 'out-of-item' };
        (actor.itemCharges ??= {})[item.id] = have - 1;
        actor.chakra = Math.min(actor.maxChakra, actor.chakra + restoreCk);
        actor.stamina = Math.min(actor.maxStamina, actor.stamina + restoreSt);
        session.activeAp -= iCost;
        session.actionsThisTurn += 1;
        session.log.push(`${actor.name} uses ${item.name ?? 'a potion'} — restores ${restoreCk} chakra, ${restoreSt} stamina.`);
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
    let chakraCost = 0;
    let staminaCost = 0;
    if (action.type === 'attack') {
        // Basic attack stays resource-free (the always-available fallback; matches the AI's reliance on it).
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
        chakraCost = Math.max(0, Number(j.chakraCost ?? 0));
        staminaCost = Math.max(0, Number(j.staminaCost ?? 0));
        const range = Math.max(1, Number(j.range ?? 1));
        if (dist > range)
            return { applied: false, reason: 'out-of-range' };
        // Resource + cooldown gating (real costs from the catalog jutsu — matches PvP).
        if ((actor.cooldowns[action.jutsuId] ?? 0) > 0)
            return { applied: false, reason: 'on-cooldown' };
        if (chakraCost > 0 && actor.chakra < chakraCost)
            return { applied: false, reason: 'no-chakra' };
        if (staminaCost > 0 && actor.stamina < staminaCost)
            return { applied: false, reason: 'no-stamina' };
    }
    if (!canAct(session, cost))
        return { applied: false, reason: 'cannot-act' };
    const label = action.type === 'attack' ? 'hits' : `casts ${jutsu.name ?? 'a jutsu'} on`;
    resolveHit(session, floor, actor, target, jutsu, cost, mastery, label);
    // Deduct chakra/stamina + arm the cooldown after a jutsu lands (basic attack is free).
    if (action.type === 'jutsu') {
        actor.chakra = Math.max(0, actor.chakra - chakraCost);
        actor.stamina = Math.max(0, actor.stamina - staminaCost);
        if (Number(jutsu.cooldown ?? 0) > 0)
            actor.cooldowns[action.jutsuId] = Number(jutsu.cooldown);
    }
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
    applyRoundHazards(session); // chip anyone standing on a hazard tile at round end
    applyBossRegen(session); // a 'regen' boss heals each round
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
        // affordable: not on cooldown, enough chakra + stamina (mirrors the human gates)
        .filter(j => (actor.cooldowns[String(j.id)] ?? 0) <= 0)
        .filter(j => actor.chakra >= Math.max(0, Number(j.chakraCost ?? 0)) && actor.stamina >= Math.max(0, Number(j.staminaCost ?? 0)))
        // skip zero-damage utility jutsu — the tag layer that gives them value isn't ported yet
        .filter(j => Number(j.effectPower ?? 0) > 0)
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
