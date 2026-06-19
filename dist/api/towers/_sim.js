"use strict";
/*
 * Battle Towers — deterministic combat sim (Phase 0.3 SPIKE).
 *
 * Purpose: de-risk Decision 2 of docs/battle-towers-plan.md — a server-authoritative,
 * seeded, byte-identical-replayable shinobi combat sim that the tower's `start`/`settle`
 * endpoints can recompute from `(seed, sealed rosters, floor)` to validate clears and
 * score them without trusting the client.
 *
 * This is a MINIMAL vertical slice, not the full engine. It proves the load-bearing
 * properties the real `_engine.ts`/`_sim.ts` must keep:
 *   1. N-actor container + a deterministic turn queue (not the PvP 2-actor p1/p2 shape).
 *   2. A seeded LCG RNG threaded explicitly (no Math.random, no Date.now) — ported from
 *      shinobij.client/src/lib/pet-arena-sim.ts:256 (the proven determinism template).
 *   3. Ported PvP damage math constants/formula (api/pvp/move.ts): EP_MULTIPLIER=32,
 *      MAX_STAT=2500, the inlined statFactor clamp — so the tower feels like the live game.
 *   4. IEEE-safe integer math (floor/min/max/* only) → byte-identical replays from a seed.
 *
 * NO client imports — runs in Node under `node --import tsx --test`. The real engine will
 * port the full 5-phase resolver + tags/AOE; this slice intentionally keeps one hit path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIM_MAX_ROUNDS = exports.MAX_STAT = exports.EP_MULTIPLIER = void 0;
exports.makeRng = makeRng;
exports.statFactor = statFactor;
exports.runTowerFloorSpike = runTowerFloorSpike;
// ─── Seeded RNG (ported verbatim from pet-arena-sim.ts:256-259) ──────────────
// Linear congruential generator. Same seed → same stream. Threaded explicitly as a
// parameter (never a module global) so replays are position-independent and reproducible.
function makeRng(seed) {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
// ─── Ported combat-math constants (api/pvp/move.ts, verified @ 586f0560) ──────
exports.EP_MULTIPLIER = 32; // move.ts:58
exports.MAX_STAT = 2500; // move.ts:53
exports.SIM_MAX_ROUNDS = 25; // mirrors move.ts MAX_ROUNDS
// statFactor — inlined formula from move.ts:503, identity at off==def, clamp [0.35, 1.85].
function statFactor(offense, defense) {
    return Math.max(0.35, Math.min(1.85, 1 + ((offense - defense) / (exports.MAX_STAT * 2)) * 0.85));
}
// One deterministic hit. `rng()` supplies a seeded ±10% variance so the RNG measurably
// affects the outcome (a different seed → different damage numbers). Integer damage via
// Math.floor keeps state byte-identical across engines.
function resolveHit(attacker, defender, rng) {
    const base = attacker.ep * exports.EP_MULTIPLIER * statFactor(attacker.offense, defender.defense);
    const variance = 0.9 + rng() * 0.2; // seeded, in [0.9, 1.1)
    return Math.max(1, Math.floor(base * variance));
}
function firstAliveOpponent(actors, side) {
    // Deterministic target selection: first alive actor on the opposing side, in queue order.
    for (const a of actors) {
        if (a.side !== side && a.hp > 0)
            return a;
    }
    return null;
}
function sideAlive(actors, side) {
    return actors.some(a => a.side === side && a.hp > 0);
}
/**
 * Run a floor to completion from a sealed roster + seed. Pure + deterministic: same
 * (actors, seed) → byte-identical TowerFloorResult, every time, in any Node.
 *
 * Turn queue = the input order (callers seal a deterministic order; the real engine will
 * use an AP/Speed-seeded initiative). Each alive actor strikes the first alive opponent.
 */
function runTowerFloorSpike(roster, seed) {
    const rng = makeRng(seed);
    // Clone so the caller's roster isn't mutated; preserves queue order.
    const actors = roster.map(f => ({ ...f }));
    const log = [];
    let rounds = 0;
    let winner = 'draw';
    for (let round = 1; round <= exports.SIM_MAX_ROUNDS; round++) {
        rounds = round;
        for (const actor of actors) {
            if (actor.hp <= 0)
                continue;
            const target = firstAliveOpponent(actors, actor.side);
            if (!target)
                break;
            const dmg = resolveHit(actor, target, rng);
            target.hp = Math.max(0, target.hp - dmg);
            log.push(`r${round}: ${actor.id} hits ${target.id} for ${dmg} (${target.hp}/${target.maxHp})`);
        }
        const squadUp = sideAlive(actors, 'squad');
        const enemyUp = sideAlive(actors, 'enemy');
        if (!squadUp || !enemyUp) {
            winner = squadUp ? 'squad' : enemyUp ? 'enemy' : 'draw';
            break;
        }
    }
    // Round-limit reached with both sides alive → higher total HP fraction wins (mirrors
    // the PvP checkWinner "win-by-HP at MAX_ROUNDS" intent; draw on a tie).
    if (sideAlive(actors, 'squad') && sideAlive(actors, 'enemy')) {
        const frac = (side) => actors.filter(a => a.side === side).reduce((s, a) => s + a.hp / Math.max(1, a.maxHp), 0);
        const sq = frac('squad');
        const en = frac('enemy');
        winner = sq > en ? 'squad' : en > sq ? 'enemy' : 'draw';
    }
    const finalHp = {};
    for (const a of actors)
        finalHp[a.id] = a.hp;
    return { winner, rounds, log, finalHp };
}
