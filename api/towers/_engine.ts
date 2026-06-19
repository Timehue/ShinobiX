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
import { EP_MULTIPLIER, statFactor } from './_sim.js';
import { hexDistance } from '../pvp/_aoe.js';
import { partyScaleFactor, scaleEnemyStat, getFloorBalanceFor, type TowerFloor } from './_floor-catalog.js';
import {
    type TowerSession,
    type TowerActor,
    type TowerSide,
    getActor,
    livingOnSide,
    isSideAlive,
    activeActor,
} from './_tower-session.js';

// ─── Constants (ported from api/pvp/move.ts, verified @ 586f0560) ────────────
export const BASE_AP = 100;
export const MAX_ACTIONS = 5;
export const MAX_ROUNDS = 25;
export const STUN_AP_PENALTY = 40;
export const MOVE_AP = 30;
export const BASIC_ATTACK_AP = 40;
export const K_DR = 0.5;
export const JUTSU_MAX_LEVEL = 50;
export const MASTERY_MIN_DAMAGE_FRAC = 0.3;

export type TowerAction =
    | { actorId: string; type: 'move'; tile: number; token?: string }
    | { actorId: string; type: 'attack'; targetId: string; token?: string }
    | { actorId: string; type: 'jutsu'; jutsuId: string; targetId: string; token?: string }
    | { actorId: string; type: 'wait'; token?: string };

export type ActionResult = { applied: boolean; reason?: string };

type JutsuLike = { id?: string; effectPower?: number; type?: string; ap?: number; range?: number; element?: string };

// ─── Hex geometry (generalized to arbitrary width/height; mirrors move.ts) ───
function xy(pos: number, w: number) { return { x: pos % w, y: Math.floor(pos / w) }; }
function posFromXY(x: number, y: number, w: number, h: number): number {
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    return y * w + x;
}
export function towerNeighbors(pos: number, w: number, h: number): number[] {
    const { x, y } = xy(pos, w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx!, y + dy!, w, h)).filter(n => n >= 0);
}

function occupantAt(session: TowerSession, tile: number, ignoreId?: string): TowerActor | undefined {
    return session.actors.find(a => a.hp > 0 && a.pos === tile && a.id !== ignoreId);
}
function isTileBlocked(session: TowerSession, tile: number, ignoreId?: string): boolean {
    if (session.map.blockedTiles.includes(tile)) return true;
    return !!occupantAt(session, tile, ignoreId);
}

// Greedy one-step move toward `to`, avoiding blocked/occupied tiles. Deterministic
// (ties broken by lowest tile index). Returns `from` if no step improves distance.
function nextStepToward(session: TowerSession, from: number, to: number, ignoreId?: string): number {
    const w = session.map.width;
    const here = hexDistance(from, to, w);
    let best = from;
    let bestD = here;
    for (const n of towerNeighbors(from, w, session.map.height).sort((a, b) => a - b)) {
        if (isTileBlocked(session, n, ignoreId)) continue;
        const d = hexDistance(n, to, w);
        if (d < bestD) { bestD = d; best = n; }
    }
    return best;
}

// ─── Damage (faithful port of resolveBaseDamage core; deterministic) ─────────
function getOffense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats: Record<string, number>, type: string): number {
    if (type === 'Taijutsu') return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu') return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu') return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function clampMastery(n: number): number { return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Number(n) || 0)); }

export function computeDamage(attacker: TowerActor, defender: TowerActor, jutsu: JutsuLike, masteryLevel: number): number {
    const ep = Number(jutsu.effectPower ?? 20);
    const epAtMax = ep + JUTSU_MAX_LEVEL * 0.2;
    const masteryFrac = MASTERY_MIN_DAMAGE_FRAC + (1 - MASTERY_MIN_DAMAGE_FRAC) * (clampMastery(masteryLevel) / JUTSU_MAX_LEVEL);
    const scaledEp = Math.max(0, epAtMax * masteryFrac);
    const type = String(jutsu.type ?? 'Taijutsu');
    const offStats = (attacker.character.stats as Record<string, number>) ?? {};
    const defStats = (defender.character.stats as Record<string, number>) ?? {};
    const sf = statFactor(getOffense(offStats, type), getDefense(defStats, type));
    const bloodlineMult = Math.max(1, Number(attacker.character.bloodlineMult ?? 1));
    const itemDamageMult = 1 + Math.max(0, Number(attacker.character.itemDamagePct ?? 0)) / 100;
    // Party-scale on enemy damage (set by applyPartyScaling for smaller parties; 1 otherwise).
    const partyDmgScale = Math.max(0, Number(attacker.character.towerDmgScale ?? 1));
    const baseDmg = Math.max(0, Math.floor(scaledEp * EP_MULTIPLIER * sf * bloodlineMult * itemDamageMult * partyDmgScale));
    // Armor DR pool (status DR is the deferred tag layer): effectiveDR = raw/(raw+K_DR).
    const armorRawDR = (defender.character.armorRawDR != null)
        ? Math.min(1.5, Math.max(0, Number(defender.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(defender.character.armorFactor ?? 1.0))));
    const effectiveDR = armorRawDR > 0 ? armorRawDR / (armorRawDR + K_DR) : 0;
    return Math.max(0, Math.floor(baseDmg * (1 - effectiveDR)));
}

// ─── Positional battlefield features (deterministic; position-based) ─────────
// A light tactical layer (a couple tiles per floor): pylons boost/weaken an
// element for a unit attacking FROM the tile, wards reduce damage TAKEN on the
// tile, hazards chip a unit standing on the tile at round end. All are pure
// functions of position + the floor's feature list — no RNG, no wall-clock — so
// the settle recompute reproduces them byte-for-byte. Floors without features
// (map.features undefined/empty) pay nothing here.
function mapFeatures(session: TowerSession) {
    return session.map.features ?? [];
}
/** Element boost/weaken for an attacker standing on a pylon tile. 1 when none apply. */
function pylonAttackMult(session: TowerSession, attacker: TowerActor, jutsu: JutsuLike): number {
    const el = String(jutsu.element ?? 'None');
    if (el === 'None' || !el) return 1; // basic attacks + non-elemental jutsu ignore pylons
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'pylon' || !f.tiles.includes(attacker.pos)) continue;
        if (el === f.element) mult *= 1 + f.percent / 100;
        else if (el === f.weakenElement) mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Damage-taken reduction for a defender standing on a ward tile. 1 when none apply. */
function wardDefendMult(session: TowerSession, target: TowerActor): number {
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind === 'ward' && f.tiles.includes(target.pos)) mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Round-end chip to every living unit standing on a hazard tile. */
function applyRoundHazards(session: TowerSession): void {
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'hazard') continue;
        for (const a of session.actors) {
            if (a.hp <= 0 || !f.tiles.includes(a.pos)) continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * f.percent) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} takes ${dmg} from ${f.label ?? 'the hazard'} (${a.hp}/${a.maxHp}).`);
        }
    }
}

// ─── Targeting / sides ───────────────────────────────────────────────────────
function hostileSidesFor(side: TowerSide): TowerSide[] {
    // Squad fights enemies; enemies fight squad + the protected npc.
    return side === 'squad' ? ['enemy'] : ['squad', 'npc'];
}
function opponentsOf(session: TowerSession, actor: TowerActor): TowerActor[] {
    const sides = hostileSidesFor(actor.side);
    return session.actors.filter(a => a.hp > 0 && sides.includes(a.side));
}
function nearestOpponent(session: TowerSession, actor: TowerActor): TowerActor | undefined {
    const w = session.map.width;
    let best: TowerActor | undefined;
    let bestD = Infinity;
    for (const o of opponentsOf(session, actor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const d = hexDistance(actor.pos, o.pos, w);
        if (d < bestD) { bestD = d; best = o; }
    }
    return best;
}

// ─── Loadout helpers ─────────────────────────────────────────────────────────
function actorSpecialty(actor: TowerActor): string {
    const s = String(actor.character.specialty ?? 'Taijutsu');
    return ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(s) ? s : 'Taijutsu';
}
function findJutsu(actor: TowerActor, jutsuId: string): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    return (list as JutsuLike[]).find(j => j && j.id === jutsuId);
}
function masteryFor(actor: TowerActor, jutsuId: string): number {
    const m = actor.character.jutsuMastery;
    if (!Array.isArray(m)) return 0;
    const hit = (m as Array<{ jutsuId?: string; level?: number }>).find(x => x && x.jutsuId === jutsuId);
    return hit ? clampMastery(hit.level ?? 0) : 0;
}

// ─── Turn scheduler (side-based rounds; interleaved boss-interrupt is Phase 3) ─
function rebuildTurnQueue(session: TowerSession): void {
    const byId = (a: TowerActor, b: TowerActor) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const squad = livingOnSide(session, 'squad').sort(byId).map(a => a.id);
    const enemy = livingOnSide(session, 'enemy').sort(byId).map(a => a.id);
    session.turnQueue = [...squad, ...enemy]; // npc actors are passive in v1 (protect targets)
}
function canAct(session: TowerSession, cost: number): boolean {
    return session.activeAp >= cost && session.actionsThisTurn < MAX_ACTIONS;
}
function isStunned(actor: TowerActor): boolean {
    return actor.statuses.some(s => s.name === 'Stun' || s.name === 'Stunned');
}
function refreshAp(session: TowerSession): void {
    const actor = activeActor(session);
    if (actor && isStunned(actor)) {
        // Stun costs AP once and is CONSUMED at the start of the penalized turn (mirrors
        // api/pvp/move.ts:893-902) — never re-penalizing a lingering Stun every round.
        session.activeAp = Math.max(0, BASE_AP - STUN_AP_PENALTY);
        actor.statuses = actor.statuses.filter(s => s.name !== 'Stun' && s.name !== 'Stunned');
    } else {
        session.activeAp = BASE_AP;
    }
    session.actionsThisTurn = 0;
}
export function startRound(session: TowerSession): void {
    rebuildTurnQueue(session);
    session.activeIndex = 0;
    refreshAp(session);
}

// ─── Win-check + objectives ──────────────────────────────────────────────────
function bossDead(session: TowerSession): boolean {
    const id = session.phaseState.bossId;
    if (!id) return false;
    const boss = getActor(session, id);
    return !!boss && boss.hp <= 0;
}
function squadWinsByObjective(session: TowerSession, floor: TowerFloor): boolean {
    switch (floor.objective) {
        case 'defeat-boss':
            // If a boss is resolved, the boss must die; if a floor was misconfigured with no
            // bossId, fall back to a full wipe so a genuine clear is never scored as a loss.
            return session.phaseState.bossId ? bossDead(session) : !isSideAlive(session, 'enemy');
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
            return !isSideAlive(session, 'enemy') && isSideAlive(session, 'npc');
        // defeat-all / defeat-all-then-boss / kill-adds-first / break-objective
        default:
            return !isSideAlive(session, 'enemy');
    }
}
function objectiveFailed(session: TowerSession, floor: TowerFloor): boolean {
    if (floor.objective === 'protect-npc' || floor.objective === 'kill-escort') {
        // npc(s) existed and are all down
        return session.actors.some(a => a.side === 'npc') && !isSideAlive(session, 'npc');
    }
    return false;
}
export function checkTowerWinner(session: TowerSession, floor: TowerFloor): void {
    if (session.status !== 'active') return;
    if (!isSideAlive(session, 'squad')) {
        session.status = 'done'; session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Squad wiped — floor failed.');
        return;
    }
    if (objectiveFailed(session, floor)) {
        session.status = 'done'; session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Objective failed.');
        return;
    }
    if (squadWinsByObjective(session, floor)) {
        session.status = 'done'; session.winner = 'squad';
        session.objectiveState.completed = true;
        session.log.push(`Floor ${floor.id} cleared!`);
    }
}

// Move crossed boss HP-phase thresholds from pending → triggered (hook for Phase 3 mechanics).
function tickBossPhases(session: TowerSession): void {
    const id = session.phaseState.bossId;
    if (!id) return;
    const boss = getActor(session, id);
    if (!boss || boss.maxHp <= 0) return;
    const pct = (boss.hp / boss.maxHp) * 100;
    while (session.phaseState.pendingPhases.length && pct <= session.phaseState.pendingPhases[0]!) {
        const t = session.phaseState.pendingPhases.shift()!;
        session.phaseState.triggeredPhases.push(t);
        session.log.push(`${boss.name} enters a new phase (${t}% HP).`);
    }
}

// ─── Action application ──────────────────────────────────────────────────────
export function applyAction(session: TowerSession, floor: TowerFloor, action: TowerAction, rng: () => number): ActionResult {
    void rng; // reserved: AI tie-breaking / future variance — damage stays deterministic
    if (session.status !== 'active') return { applied: false, reason: 'session-done' };
    const actor = activeActor(session);
    if (!actor || actor.id !== action.actorId) return { applied: false, reason: 'not-your-turn' };
    if (actor.hp <= 0) return { applied: false, reason: 'down' };

    if (action.type === 'wait') return { applied: true };

    if (action.type === 'move') {
        if (!canAct(session, MOVE_AP)) return { applied: false, reason: 'cannot-act' };
        const w = session.map.width;
        if (hexDistance(actor.pos, action.tile, w) !== 1) return { applied: false, reason: 'not-adjacent' };
        if (isTileBlocked(session, action.tile, actor.id)) return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        session.activeAp -= MOVE_AP;
        session.actionsThisTurn += 1;
        if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
            session.objectiveState.reachedGoal = true;
        }
        checkTowerWinner(session, floor);
        return { applied: true };
    }

    // attack / jutsu — need a living, hostile, in-range target
    const target = getActor(session, action.targetId);
    if (!target || target.hp <= 0) return { applied: false, reason: 'no-target' };
    if (!hostileSidesFor(actor.side).includes(target.side)) return { applied: false, reason: 'friendly-fire' };
    const dist = hexDistance(actor.pos, target.pos, session.map.width);

    let jutsu: JutsuLike;
    let cost: number;
    let mastery = 0;
    if (action.type === 'attack') {
        jutsu = { id: 'basic-attack', effectPower: 10, type: actorSpecialty(actor), ap: BASIC_ATTACK_AP, range: 1 };
        cost = BASIC_ATTACK_AP;
        if (dist > 1) return { applied: false, reason: 'out-of-range' };
    } else {
        const j = findJutsu(actor, action.jutsuId);
        if (!j) return { applied: false, reason: 'no-jutsu' };
        jutsu = j;
        cost = Number(j.ap ?? 40);
        mastery = masteryFor(actor, action.jutsuId);
        const range = Math.max(1, Number(j.range ?? 1));
        if (dist > range) return { applied: false, reason: 'out-of-range' };
    }
    if (!canAct(session, cost)) return { applied: false, reason: 'cannot-act' };

    // Positional features: pylon element boost/weaken from the attacker's tile, ward
    // damage-reduction on the target's tile. Both default to 1 on featureless floors.
    const envMult = pylonAttackMult(session, actor, jutsu) * wardDefendMult(session, target);
    const dmg = Math.max(0, Math.floor(computeDamage(actor, target, jutsu, mastery) * envMult));
    target.hp = Math.max(0, target.hp - dmg);
    session.activeAp -= cost;
    session.actionsThisTurn += 1;
    session.log.push(`${actor.name} hits ${target.name} for ${dmg} (${target.hp}/${target.maxHp}).`);

    tickBossPhases(session);
    checkTowerWinner(session, floor);
    return { applied: true };
}

// ─── Turn advance ────────────────────────────────────────────────────────────
export function endTurn(session: TowerSession, floor: TowerFloor): void {
    if (session.status !== 'active') return;
    let idx = session.activeIndex + 1;
    while (idx < session.turnQueue.length) {
        const a = getActor(session, session.turnQueue[idx]!);
        if (a && a.hp > 0) break;
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
    checkTowerWinner(session, floor);
    if (session.status !== 'active') return;
    if (session.round >= MAX_ROUNDS) {
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
function bestAffordableJutsu(session: TowerSession, actor: TowerActor, dist: number): JutsuLike | undefined {
    const list = actor.character.jutsu;
    if (!Array.isArray(list)) return undefined;
    const opts = (list as JutsuLike[])
        .filter(j => j && typeof j.id === 'string')
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => canAct(session, Number(j.ap ?? 40)))
        // deterministic: highest effectPower, ties by id
        .sort((a, b) => (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0)) || (String(a.id) < String(b.id) ? -1 : 1));
    return opts[0];
}
export function pickAiAction(session: TowerSession, actor: TowerActor, rng: () => number): TowerAction {
    void rng;
    const target = nearestOpponent(session, actor);
    if (!target) return { actorId: actor.id, type: 'wait' };
    const dist = hexDistance(actor.pos, target.pos, session.map.width);
    const j = bestAffordableJutsu(session, actor, dist);
    if (j && j.id) return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && canAct(session, BASIC_ATTACK_AP)) return { actorId: actor.id, type: 'attack', targetId: target.id };
    if (canAct(session, MOVE_AP)) {
        const step = nextStepToward(session, actor.pos, target.pos, actor.id);
        if (step !== actor.pos) return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}

// ─── Party scaling ───────────────────────────────────────────────────────────
// Scale enemy HP for a party smaller than the floor's balance baseline. Called by the
// encounter builder (start.ts, P1.B1) after enemies are built. Squad/npc untouched.
export function applyPartyScaling(session: TowerSession, floor: TowerFloor): void {
    const factor = partyScaleFactor(session.partySize, getFloorBalanceFor(floor));
    if (factor >= 1) return;
    for (const a of session.actors) {
        if (a.side !== 'enemy') continue;
        // Idempotency guard: never double-scale (a settle recompute or accidental second
        // call must not weaken enemies further). towerDmgScale is the "already scaled" mark.
        if (a.character.towerDmgScale != null) continue;
        a.maxHp = scaleEnemyStat(a.maxHp, factor);
        a.hp = Math.min(a.hp, a.maxHp);
        // Enemy outgoing damage scales by the same factor (read by computeDamage).
        a.character.towerDmgScale = factor;
    }
}

// ─── Deterministic auto-run (async resolution + settle recompute) ────────────
// Drives every actor via the AI policy to a terminal state. Used when the whole floor
// is AI-resolved (async squads) and by settle.ts to recompute the clear from the seed.
export function runTowerFloor(session: TowerSession, floor: TowerFloor, rng: () => number): TowerSession {
    if (session.turnQueue.length === 0) startRound(session);
    const GUARD = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); continue; }
        let safety = 0;
        while (session.status === 'active' && safety++ <= MAX_ACTIONS) {
            const action = pickAiAction(session, actor, rng);
            if (action.type === 'wait') break;
            const res = applyAction(session, floor, action, rng);
            if (!res.applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
    }
    checkTowerWinner(session, floor);
    return session;
}

// Live-mode driver: advance AI actors' turns until it is a HUMAN's turn (ai === false) or
// the floor resolves. Used by api/towers/action.ts after a human submits a turn-ending
// action, so the human only ever sees their own turns. Deterministic (seeded rng).
export function runAiUntilHuman(session: TowerSession, floor: TowerFloor, rng: () => number): void {
    if (session.turnQueue.length === 0) startRound(session);
    const GUARD = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = activeActor(session);
        if (actor && actor.ai === false && actor.hp > 0) break; // a live human's turn — stop
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); continue; }
        let safety = 0;
        while (session.status === 'active' && safety++ <= MAX_ACTIONS) {
            const a = pickAiAction(session, actor, rng);
            if (a.type === 'wait') break;
            if (!applyAction(session, floor, a, rng).applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
    }
}
