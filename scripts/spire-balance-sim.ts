/*
 * Endless Spire balance sim — drives a GEARED, competently-played 3-4 squad through every
 * spire floor against the REAL engine + real enemy AI, to estimate the difficulty curve and
 * flag walls / facerolls for tuning floors 8-20.
 *
 * Faithful to live combat: uses the actual buildTowerEncounter + applyAction + endTurn + the
 * real enemy pickAiAction, with the real gear passives the tower's applyJutsu reads
 * (bloodlineMult / itemDamagePct / armorRawDR / item{Absorb,Reflect,LifeSteal}Pct). Only the
 * SQUAD's action policy is smarter than the built-in nearest-target AI: it concentrates fire on
 * the lowest-HP enemy, clears a bulwark boss's GUARD POD before the boss, and heals when low —
 * i.e. how a coordinated team actually plays. Enemies use the shipped AI unchanged.
 *
 * NOT authoritative — the absolute numbers depend on the assumed gear/jutsu power (the KNOBS
 * block below). Its value is RELATIVE: the curve shape + which floors are outliers. Re-run with
 * different KNOBS to match your real player power, then confirm with playtest.
 *
 *   node --import tsx scripts/spire-balance-sim.ts [minFloor] [maxFloor] [seeds] [partySize]
 */
import { buildTowerEncounter, type SquadMemberInput } from '../api/towers/_encounter.js';
import {
    applyAction, endTurn, startRound, pickAiAction, towerNeighbors,
    nextStepToward, towerBarrierTiles, towerAdjustedApCost, isElementallySealed,
    BASIC_ATTACK_AP, MOVE_AP, HEAL_AP, HEAL_CHAKRA, MAX_ACTIONS, MAX_ROUNDS,
    CLEAR_AP, CLEANSE_AP,
    type TowerAction,
} from '../api/towers/_engine.js';
import { resolveAscensionModifiers, weeklySpireBlessing } from '../api/towers/_modifiers.js';
import { getSpireFloor, spireBossForFloor } from '../api/towers/_spire-catalog.js';
import { activeActor, type TowerActor, type TowerSession } from '../api/towers/_tower-session.js';
import { makeRng } from '../api/towers/_sim.js';
import { hexDistance } from '../api/pvp/_aoe.js';
import type { TowerFloor } from '../api/towers/_floor-catalog.js';
import { pathToFileURL } from 'node:url';
import { BASIC_CLEAR_RANGE } from '../shared/combat-basic-actions.js';
import { activeCombatStatuses } from '../api/combat-core/statuses.js';

// POWER env multiplier scales squad damage (EP + bloodline + item%) for A/B diagnostics —
// e.g. POWER=1.4 models a stronger team. Distinguishes HP-walls (yield to more power) from
// RATE-walls like regen (don't yield to more power).
const POWER = Math.max(0.5, Number(process.env.POWER) || 1);
// ── KNOBS: the assumed power of a maxed, geared endgame player ────────────────
export const KNOBS = {
    maxHp: 12000,          // maxed L100 HP with HP gear
    maxChakra: 2200, maxStamina: 2200,
    stat: 2500,            // every offense/defense composite at the statFactor-cap plateau
    bloodlineMult: Math.min(3, 1 + 0.4 * POWER), // a strong maxed bloodline (seal clamps 1..3)
    armorRawDR: 1.0,       // full armour DR pool (~7 pieces; seal clamps 0..1.5)
    itemDamagePct: Math.min(200, 30 * POWER),    // item damage bonus (seal clamps 0..200)
    itemAbsorbPct: 12, itemReflectPct: 8, itemLifeStealPct: 10,
    itemShield: 2000,      // starting armour shield pool (applied to actor.shield below)
    healAtPct: 0.34,       // self-heal when HP drops below this fraction
    jutsu: [
        { id: 'j-nuke', name: 'Spirit Bomb', effectPower: Math.round(52 * POWER), ap: 60, range: 4, type: 'Ninjutsu', chakraCost: 22 },
        { id: 'j-strike', name: 'Fang Barrage', effectPower: Math.round(42 * POWER), ap: 40, range: 2, type: 'Bukijutsu', staminaCost: 12 },
        { id: 'j-jab', name: 'Palm Strike', effectPower: Math.round(30 * POWER), ap: 30, range: 1, type: 'Taijutsu', staminaCost: 6 },
    ] as Record<string, unknown>[],
};

export function gearedSquad(n: number): SquadMemberInput[] {
    const S = KNOBS.stat;
    const stats: Record<string, number> = {
        taijutsuOffense: S, taijutsuDefense: S, bukijutsuOffense: S, bukijutsuDefense: S,
        genjutsuOffense: S, genjutsuDefense: S, ninjutsuOffense: S, ninjutsuDefense: S,
        strength: S, speed: S, intelligence: S, willpower: S,
    };
    return Array.from({ length: n }, (_, i) => ({
        id: `sq-${i}`, name: `Hero${i}`, ownerSlug: `hero${i}`, ai: true,
        character: {
            maxHp: KNOBS.maxHp, maxChakra: KNOBS.maxChakra, maxStamina: KNOBS.maxStamina, level: 100,
            stats, jutsu: KNOBS.jutsu,
            bloodlineMult: KNOBS.bloodlineMult, armorRawDR: KNOBS.armorRawDR, itemDamagePct: KNOBS.itemDamagePct,
            itemAbsorbPct: KNOBS.itemAbsorbPct, itemReflectPct: KNOBS.itemReflectPct, itemLifeStealPct: KNOBS.itemLifeStealPct,
        },
    }));
}

// ── Competent squad policy: focus-fire, clear the bulwark guard pod first, heal when low ──
type J = { id?: string; range?: number; ap?: number; chakraCost?: number; staminaCost?: number; effectPower?: number; target?: string };
function bestJutsu(session: TowerSession, actor: TowerActor, dist: number, utility = false): J | undefined {
    const list = Array.isArray(actor.character.jutsu) ? (actor.character.jutsu as J[]) : [];
    return list
        .filter(j => typeof j.id === 'string')
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => (actor.cooldowns[String(j.id)] ?? 0) <= 0)
        .filter(j => !isElementallySealed(session, actor, j))
        .filter(j => session.activeAp >= towerAdjustedApCost(session, actor, Number(j.ap ?? 40)) && session.actionsThisTurn < MAX_ACTIONS)
        .filter(j => actor.chakra >= Math.max(0, Number(j.chakraCost ?? 0)) && actor.stamina >= Math.max(0, Number(j.staminaCost ?? 0)))
        .filter(j => (utility ? Number(j.ap) === 40 && Number(j.effectPower ?? 0) === 0 : Number(j.effectPower ?? 0) > 0)
            && j.target !== 'EMPTY_GROUND' && j.target !== 'SELF')
        .sort((a, b) => Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0) || (String(a.id) < String(b.id) ? -1 : 1))[0];
}
function priorityTarget(session: TowerSession, actor: TowerActor): TowerActor | undefined {
    void actor;
    const enemies = session.actors.filter(a => a.side === 'enemy' && a.hp > 0);
    if (!enemies.length) return undefined;
    const boss = session.actors.find(a => a.id === session.phaseState.bossId && a.hp > 0);
    const bulwark = !!boss && String(boss.character.mechanic ?? '') === 'bulwark';
    const addsGate = !!boss && ['defeat-all-then-boss', 'kill-adds-first'].includes(session.objectiveState.kind);
    const guards = enemies.filter(e => e.id !== boss?.id);
    const pool = (bulwark || addsGate) && guards.length ? guards : enemies;
    return pool.slice().sort((a, b) => (a.hp - b.hp) || (a.id < b.id ? -1 : 1))[0]; // concentrate fire on the softest
}
export function smartSquadAction(session: TowerSession, actor: TowerActor, catalogUtility = false): TowerAction {
    const w = session.map.width, h = session.map.height;
    // A competent squad responds to the same visible hazards/counters as players.
    // Standing in a sealed signature while spamming damage no longer models play.
    const danger = new Set([...(session.map.hazardTiles ?? []), ...(session.map.nextRoundHazardTiles ?? []), ...(session.bossStrike?.tiles ?? [])]);
    if (danger.has(actor.pos)) {
        const escape = pickAiAction(session, actor, () => 0.5);
        if (escape.type === 'move') return escape;
    }
    const pylon = session.towerTactics && session.map.features?.find(feature => feature.kind === 'pylon'
        && !session.towerTactics!.disruptedPylons.includes(feature.tiles[0]!)
        && hexDistance(actor.pos, feature.tiles[0]!, w) <= 1);
    if (pylon && session.activeAp >= towerAdjustedApCost(session, actor, 40) && session.actionsThisTurn < MAX_ACTIONS) {
        return { actorId: actor.id, type: 'disrupt', tile: pylon.tiles[0]! };
    }
    if (catalogUtility && session.actionsThisTurn < MAX_ACTIONS
        && session.activeAp >= towerAdjustedApCost(session, actor, CLEANSE_AP) && (actor.cooldowns.cleanse ?? 0) <= 0) {
        const debuffs = activeCombatStatuses(actor.statuses, session.round).filter(status => status.kind === 'negative');
        const damagingKit = (actor.character.jutsu as J[] | undefined)?.filter(jutsu => Number(jutsu.effectPower) > 0) ?? [];
        const sealedKit = damagingKit.length > 0 && damagingKit.every(jutsu => isElementallySealed(session, actor, jutsu));
        if (!debuffs.some(status => status.name === 'Cleanse Prevent') && (sealedKit || debuffs.length >= 2)) {
            return { actorId: actor.id, type: 'cleanse' };
        }
    }
    if (actor.hp < KNOBS.healAtPct * actor.maxHp && (actor.cooldowns['basicHeal'] ?? 0) <= 0
        && actor.chakra >= HEAL_CHAKRA && session.activeAp >= towerAdjustedApCost(session, actor, HEAL_AP) && session.actionsThisTurn < MAX_ACTIONS) {
        return { actorId: actor.id, type: 'heal' };
    }
    const target = priorityTarget(session, actor);
    if (!target) return { actorId: actor.id, type: 'wait' };
    const dist = hexDistance(actor.pos, target.pos, w);
    if (catalogUtility && session.activeAp >= towerAdjustedApCost(session, actor, CLEAR_AP) && session.actionsThisTurn < MAX_ACTIONS
        && (actor.cooldowns.clear ?? 0) <= 0 && dist <= BASIC_CLEAR_RANGE
        && activeCombatStatuses(target.statuses, session.round).some(status => status.kind === 'positive'
            && ['Absorb', 'Reflect', 'Decrease Damage Taken'].includes(status.name) && Number(status.percent ?? 0) >= 10)) {
        return { actorId: actor.id, type: 'clear', targetId: target.id };
    }
    // A real equipped weapon can pair its 40-AP swing with a 60-AP technique.
    // Read the sealed item, including cooldown/range, rather than inventing damage.
    if (catalogUtility && session.actionsThisTurn < MAX_ACTIONS) {
        const hand = (actor.character.equipment as Record<string, string> | undefined)?.hand;
        const weapon = (actor.character.pvpItems as Array<{ id: string; weaponEp?: number; weaponRange?: number; apCost?: number }> | undefined)
            ?.find(item => item.id === hand && Number(item.weaponEp) > 0);
        if (weapon && session.activeAp >= towerAdjustedApCost(session, actor, Number(weapon.apCost ?? BASIC_ATTACK_AP))
            && dist <= Number(weapon.weaponRange ?? 1) && (actor.cooldowns[`weapon:${weapon.id}`] ?? 0) <= 0) {
            return { actorId: actor.id, type: 'weapon', itemId: weapon.id, targetId: target.id };
        }
    }
    // Catalog Story kits pair a zero-damage 40-AP utility with a 60-AP hit.
    // Model that legal two-action rotation; never turn utility into damage.
    const utility = catalogUtility && session.activeAp >= towerAdjustedApCost(session, actor, 40) + towerAdjustedApCost(session, actor, 60)
        ? bestJutsu(session, actor, dist, true) : undefined;
    if (utility?.id) return { actorId: actor.id, type: 'jutsu', jutsuId: utility.id, targetId: target.id };
    const j = bestJutsu(session, actor, dist);
    if (j?.id) return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && session.activeAp >= towerAdjustedApCost(session, actor, BASIC_ATTACK_AP) && session.actionsThisTurn < MAX_ACTIONS) {
        return { actorId: actor.id, type: 'attack', targetId: target.id };
    }
    if (session.activeAp >= towerAdjustedApCost(session, actor, MOVE_AP) && session.actionsThisTurn < MAX_ACTIONS) {
        // Preserve the calibrated direct approach while it makes progress, then use the
        // production Tower pathfinder as the terrain dead-end fallback. The former policy
        // waited forever at a local minimum; replacing every tie-break with BFS, however,
        // changed open-board engagement lanes and invalidated the established balance model.
        const barriers = towerBarrierTiles(session);
        const greedy = towerNeighbors(actor.pos, w, h)
            .filter(t => !session.map.blockedTiles.includes(t)
                && !barriers.has(t)
                && !session.actors.some(a => a.hp > 0 && a.pos === t && a.id !== actor.id))
            .sort((a, b) => hexDistance(a, target.pos, w) - hexDistance(b, target.pos, w))[0];
        const step = greedy !== undefined && hexDistance(greedy, target.pos, w) < dist
            ? greedy
            : nextStepToward(session, actor.pos, target.pos, actor.id);
        if (step !== actor.pos) return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}
export function runFloorSmart(session: TowerSession, floor: TowerFloor, rng: () => number, options: { catalogUtility?: boolean } = {}): void {
    if (session.turnQueue.length === 0) startRound(session);
    const GUARD = (MAX_ROUNDS + 2) * (session.actors.length + 2) * (MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') { endTurn(session, floor); continue; }
        let safety = 0;
        while (session.status === 'active' && safety++ <= MAX_ACTIONS) {
            const action = actor.side === 'squad' ? smartSquadAction(session, actor, options.catalogUtility) : pickAiAction(session, actor, rng);
            if (action.type === 'wait') break;
            if (!applyAction(session, floor, action, rng).applied) break;
        }
        if (session.status === 'active') endTurn(session, floor);
    }
}

// ── Run one floor N times; aggregate ─────────────────────────────────────────
export type SpireFloorSimResult = {
    win: number;
    avgRounds: number;
    avgSurv: number;
    timeout: number;
    bossLeft: number;
    failCause: string;
};

export function simFloor(
    tier: number,
    n: number,
    seeds: number,
    options: { bossHp?: number; blessingWeek?: number } = {},
): SpireFloorSimResult {
    const floor = getSpireFloor(tier)!;
    if (options.bossHp !== undefined) floor.boss!.hp = Math.max(1, Math.floor(options.bossHp));
    const bossKey = spireBossForFloor(tier)!;
    const blessing = weeklySpireBlessing(options.blessingWeek ?? 0); // fixed week keeps CI deterministic
    let wins = 0, roundsSum = 0, survSum = 0, timeouts = 0, wipes = 0, bossLeftSum = 0, failN = 0;
    for (let s = 0; s < seeds; s++) {
        const seed = 1000 + s * 7 + tier;
        const seal = resolveAscensionModifiers(tier, floor.roundBudget, blessing.modifier);
        const session = buildTowerEncounter({ floor, squad: gearedSquad(n), runId: `sim-${tier}-${s}`, seed, partySize: n, now: 0, ascension: seal, spireBossId: bossKey });
        for (const a of session.actors) if (a.side === 'squad') a.shield = KNOBS.itemShield; // model armour shield pool
        runFloorSmart(session, floor, makeRng(seed));
        const alive = session.actors.filter(a => a.side === 'squad' && a.hp > 0).length;
        if (session.winner === 'squad') { wins++; roundsSum += session.round; survSum += alive; }
        else {
            failN++;
            const boss = session.actors.find(a => a.id === session.phaseState.bossId);
            bossLeftSum += boss ? Math.round((boss.hp / boss.maxHp) * 100) : 0;
            if (alive === 0) wipes++; else timeouts++; // wiped out vs ran out the clock
        }
    }
    const failCause = failN === 0 ? '' : wipes > timeouts ? 'wiped' : 'timeout';
    return {
        win: Math.round((wins / seeds) * 100),
        avgRounds: wins ? Math.round((roundsSum / wins) * 10) / 10 : 0,
        avgSurv: wins ? Math.round((survSum / wins) * 10) / 10 : 0,
        timeout: Math.round((timeouts / seeds) * 100),
        bossLeft: failN ? Math.round(bossLeftSum / failN) : 0, // avg boss HP% left on a LOSS (knife-edge vs true wall)
        failCause,
    };
}

const MECH: Record<string, string> = {
    warden: 'bulwark', revenant: 'regen', ravager: 'summon', sovereign: 'enrage',
    stormcaller: 'stormcall', 'mirror-shogun': 'mirror', 'void-emperor': 'eclipse',
};

export function runSpireBalanceReport(argv = process.argv.slice(2)): void {
    const [minF, maxF, seedsArg, partyArg] = argv;
    const min = Math.max(1, Number(minF) || 1), max = Math.min(20, Number(maxF) || 20);
    const seeds = Number(seedsArg) || 12, party = Number(partyArg) || 4;

    console.log(`\nEndless Spire balance sim — ${party}-player GEARED squad, ${seeds} seeds/floor (blessing: ${weeklySpireBlessing(0).name})`);
    console.log(`KNOBS: hp ${KNOBS.maxHp}, bloodline ×${KNOBS.bloodlineMult}, armorDR ${KNOBS.armorRawDR}, item+${KNOBS.itemDamagePct}%, best jutsu EP ${Math.max(...KNOBS.jutsu.map(j => Number(j.effectPower)))}\n`);
    console.log('Floor  Boss            Mech      HP      Rnd | Win%  ~TTK Surv  Loss    Boss%left  Verdict');
    console.log('─'.repeat(94));
    for (let t = min; t <= max; t++) {
        const floor = getSpireFloor(t)!;
        const bossKey = spireBossForFloor(t)!;
        const r = simFloor(t, party, seeds);
        const verdict = r.win >= 92 && r.avgRounds <= (floor.roundBudget * 0.45) ? 'FACEROLL'
            : r.win >= 82 ? 'ok'
            : r.win >= 55 ? 'HARD'
            : r.win >= 20 ? 'WALL'
            : 'BRICK WALL';
        const star = [5, 10, 15, 20].includes(t) ? '★' : ' ';
        console.log(
            `${star}F${String(t).padStart(2)}  ${floor.name.replace(/^Spire — Floor \d+ · /, '').padEnd(15)} ${MECH[bossKey].padEnd(9)} ${String(floor.boss!.hp).padStart(6)}  ${String(floor.roundBudget).padStart(2)}  | ${String(r.win).padStart(3)}% ${String(r.avgRounds).padStart(5)} ${String(r.avgSurv).padStart(4)}  ${r.failCause.padEnd(7)} ${String(r.bossLeft).padStart(6)}%    ${verdict}`,
        );
    }
    console.log('─'.repeat(94));
    console.log('Boss%left = avg boss HP remaining on a LOSS: <15% = knife-edge (tiny nudge) · >40% = true wall (big cut).');
    console.log('Targets: F8-12 "ok" (win 82-95, TTK ~40-60% of cap) · F13-17 "HARD" (win 55-80) · F18-20 "WALL" (win 20-55, ★ spikes hardest).');
    console.log('FACEROLL = too easy (raise HP/keystones) · BRICK WALL = unwinnable even geared (lower HP or dmgMult).\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSpireBalanceReport();
