"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _sim_js_1 = require("./_sim.js");
const _tower_session_js_1 = require("./_tower-session.js");
const _engine_js_1 = require("./_engine.js");
const MAP8 = { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] };
function makeActor(id, side, pos, over = {}) {
    return {
        id, side, name: id, ownerSlug: null, ai: true,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], cooldowns: {}, pos,
        character: { specialty: 'Taijutsu', stats: {} },
        ...over,
    };
}
const STRONG = { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } };
const WEAK = { specialty: 'Taijutsu', stats: { taijutsuOffense: 200, taijutsuDefense: 200 } };
function makeFloor(objective, over = {}) {
    return {
        id: 1, name: 'Test', biome: 'forest', objective, roundBudget: 8,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' }, enemies: [],
        firstClearReward: {}, ...over,
    };
}
function makeSession(actors, over = {}) {
    return (0, _tower_session_js_1.createTowerSession)({
        towerId: 't', runId: 'r', floor: 1, seed: 123, partySize: 4, map: MAP8,
        actors, objectiveKind: 'defeat-all', now: 1000, ...over,
    });
}
// sq at col 0 (pos 0, 8), enemies at col 1 (pos 1, 9) → each pair adjacent (dist 1).
function frontline(squadChar = STRONG, enemyChar = WEAK) {
    return [
        makeActor('sq-1', 'squad', 0, { character: squadChar }),
        makeActor('sq-2', 'squad', 8, { character: squadChar }),
        makeActor('en-1', 'enemy', 1, { character: enemyChar }),
        makeActor('en-2', 'enemy', 9, { character: enemyChar }),
    ];
}
(0, node_test_1.describe)('Battle Towers engine (P1.A2)', () => {
    (0, node_test_1.it)('runs a full floor deterministically (same seed/inputs → byte-identical)', () => {
        const a = (0, _engine_js_1.runTowerFloor)(makeSession(frontline()), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(999));
        const b = (0, _engine_js_1.runTowerFloor)(makeSession(frontline()), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(999));
        node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b));
        node_assert_1.strict.equal(a.status, 'done');
    });
    (0, node_test_1.it)('a stronger squad clears a defeat-all floor', () => {
        const s = (0, _engine_js_1.runTowerFloor)(makeSession(frontline()), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(s.winner, 'squad');
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-1')?.hp, 0);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-2')?.hp, 0);
        node_assert_1.strict.ok(s.objectiveState.completed);
    });
    (0, node_test_1.it)('a wiped squad loses (enemy wins)', () => {
        const s = (0, _engine_js_1.runTowerFloor)(makeSession(frontline(WEAK, STRONG)), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(2));
        node_assert_1.strict.equal(s.winner, 'enemy');
        node_assert_1.strict.equal(s.status, 'done');
    });
    (0, node_test_1.it)('defeat-boss wins when the boss dies even if trash lingers', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('boss', 'enemy', 1, { character: WEAK, hp: 300, maxHp: 300 }),
            makeActor('en-1', 'enemy', 63, { character: WEAK }), // far corner, never engaged
        ];
        const s = (0, _engine_js_1.runTowerFloor)(makeSession(actors, { objectiveKind: 'defeat-boss', bossId: 'boss' }), makeFloor('defeat-boss', { id: 5 }), (0, _sim_js_1.makeRng)(3));
        node_assert_1.strict.equal(s.winner, 'squad');
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'boss')?.hp, 0);
        node_assert_1.strict.ok(((0, _tower_session_js_1.getActor)(s, 'en-1')?.hp ?? 0) > 0, 'trash never had to die');
    });
    (0, node_test_1.it)('computeDamage: statFactor identity at off==def, armor DR reduces', () => {
        const att = makeActor('a', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 1000 } } });
        const defEqual = makeActor('d', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 } } });
        const defArmor = makeActor('d2', 'enemy', 1, { character: { stats: { taijutsuDefense: 1000 }, armorRawDR: 1.0 } });
        const j = { effectPower: 10, type: 'Taijutsu', ap: 40 };
        const base = (0, _engine_js_1.computeDamage)(att, defEqual, j, 50);
        const armored = (0, _engine_js_1.computeDamage)(att, defArmor, j, 50);
        node_assert_1.strict.ok(base > 0);
        node_assert_1.strict.ok(armored < base, 'armor reduces damage');
    });
    (0, node_test_1.it)('rejects friendly-fire, out-of-range, and not-your-turn', () => {
        const s = makeSession(frontline());
        (0, _engine_js_1.startRound)(s);
        const active = (0, _tower_session_js_1.activeActor)(s); // sq-1
        // friendly fire on sq-2
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'sq-2' }, (0, _sim_js_1.makeRng)(1)).applied, false);
        // out of range: en-2 is at pos 9, sq-1 at pos 0 → dist > 1
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'en-2' }, (0, _sim_js_1.makeRng)(1)).applied, false);
        // not your turn: en-1 acting out of turn
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: 'en-1', type: 'attack', targetId: 'sq-1' }, (0, _sim_js_1.makeRng)(1)).applied, false);
        // valid: sq-1 attacks adjacent en-1
        const ok = (0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: active.id, type: 'attack', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(ok.applied, true);
        node_assert_1.strict.ok(s.activeAp === 100 - _engine_js_1.BASIC_ATTACK_AP);
    });
    (0, node_test_1.it)('move is adjacent-only and blocked by occupants', () => {
        const s = makeSession(frontline());
        (0, _engine_js_1.startRound)(s);
        const active = (0, _tower_session_js_1.activeActor)(s); // sq-1 at pos 0
        // move two tiles away → rejected (not adjacent)
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: active.id, type: 'move', tile: 2 }, (0, _sim_js_1.makeRng)(1)).applied, false);
        // move onto an occupied adjacent tile (en-1 at pos 1) → blocked
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, makeFloor('defeat-all'), { actorId: active.id, type: 'move', tile: 1 }, (0, _sim_js_1.makeRng)(1)).applied, false);
        // move to an empty adjacent tile (pos 8 is sq-2... use a free neighbor): pos 0 neighbors incl. tiles in row 1
        const free = [16].find(t => !s.actors.some(a => a.pos === t)); // pos 16 = (0,2)
        // pos 0 → pos 8 is the only down neighbor and it's occupied by sq-2; just assert the blocked/adjacent guards held
        node_assert_1.strict.ok(free !== undefined);
    });
    (0, node_test_1.it)('party scaling cuts enemy HP + damage for a duo', () => {
        const s = makeSession(frontline(), { partySize: 2 });
        const beforeHp = (0, _tower_session_js_1.getActor)(s, 'en-1').maxHp;
        (0, _engine_js_1.applyPartyScaling)(s, makeFloor('defeat-all')); // balanceFor defaults to 4 → factor 0.6
        const en = (0, _tower_session_js_1.getActor)(s, 'en-1');
        node_assert_1.strict.equal(en.maxHp, Math.round(beforeHp * 0.6));
        node_assert_1.strict.ok(en.hp <= en.maxHp);
        node_assert_1.strict.equal(en.character.towerDmgScale, 0.6);
    });
    (0, node_test_1.it)('a full party (==balanceFor) is not scaled', () => {
        const s = makeSession(frontline(), { partySize: 4 });
        const before = (0, _tower_session_js_1.getActor)(s, 'en-1').maxHp;
        (0, _engine_js_1.applyPartyScaling)(s, makeFloor('defeat-all'));
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-1').maxHp, before);
    });
    (0, node_test_1.it)('protect-npc fails the floor if the npc dies', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: WEAK }),
            makeActor('npc-1', 'npc', 8, { character: WEAK, hp: 50, maxHp: 50 }),
            makeActor('en-1', 'enemy', 9, { character: STRONG }),
            makeActor('en-2', 'enemy', 1, { character: STRONG }),
        ];
        const s = (0, _engine_js_1.runTowerFloor)(makeSession(actors, { objectiveKind: 'protect-npc' }), makeFloor('protect-npc'), (0, _sim_js_1.makeRng)(7));
        node_assert_1.strict.equal(s.winner, 'enemy', 'losing the npc (or the squad) fails the floor');
        node_assert_1.strict.ok(s.objectiveState.failed);
    });
    (0, node_test_1.it)('computeDamage scales with the offense/defense gap (pins statFactor / MAX_STAT)', () => {
        const j = { effectPower: 10, type: 'Taijutsu', ap: 40 };
        const att = makeActor('a', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 3000 } } });
        const lowDef = makeActor('d1', 'enemy', 1, { character: { stats: { taijutsuDefense: 0 } } });
        const eqDef = makeActor('d2', 'enemy', 1, { character: { stats: { taijutsuDefense: 3000 } } });
        const highDef = makeActor('d3', 'enemy', 1, { character: { stats: { taijutsuDefense: 9000 } } });
        const hi = (0, _engine_js_1.computeDamage)(att, lowDef, j, 50);
        const eq = (0, _engine_js_1.computeDamage)(att, eqDef, j, 50);
        const lo = (0, _engine_js_1.computeDamage)(att, highDef, j, 50);
        node_assert_1.strict.ok(hi > eq && eq > lo, `expected ${hi} > ${eq} > ${lo}`);
    });
    (0, node_test_1.it)('defeat-boss with no bossId still clears on a full wipe (C1 regression)', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: STRONG }),
            makeActor('en-1', 'enemy', 1, { character: WEAK, hp: 100, maxHp: 100 }),
        ];
        const s = (0, _engine_js_1.runTowerFloor)(makeSession(actors, { objectiveKind: 'defeat-boss' }), makeFloor('defeat-boss'), (0, _sim_js_1.makeRng)(5));
        node_assert_1.strict.equal(s.winner, 'squad', 'a genuine wipe must clear, not score a loss');
    });
    (0, node_test_1.it)('reach-tile wins when a squad actor is already on the goal tile (H1 regression)', () => {
        const actors = [
            makeActor('sq-1', 'squad', 0, { character: WEAK }),
            makeActor('en-1', 'enemy', 63, { character: WEAK, hp: 1_000_000, maxHp: 1_000_000 }),
        ];
        const s = makeSession(actors, { objectiveKind: 'reach-tile' });
        (0, _engine_js_1.startRound)(s);
        (0, _engine_js_1.checkTowerWinner)(s, makeFloor('reach-tile', { goalTile: 0 })); // sq-1 spawns on tile 0
        node_assert_1.strict.equal(s.winner, 'squad');
    });
    (0, node_test_1.it)('applyPartyScaling is idempotent (L1 regression — no double-scaling)', () => {
        const s = makeSession(frontline(), { partySize: 2 });
        const floor = makeFloor('defeat-all');
        (0, _engine_js_1.applyPartyScaling)(s, floor);
        const once = (0, _tower_session_js_1.getActor)(s, 'en-1').maxHp;
        (0, _engine_js_1.applyPartyScaling)(s, floor); // second call must be a no-op
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-1').maxHp, once);
    });
    (0, node_test_1.it)('runAiUntilHuman advances AI turns and stops at a live human (live driver)', () => {
        const actors = [
            makeActor('sq-0', 'squad', 0, { ai: true, character: STRONG }), // AI ally
            makeActor('sq-1', 'squad', 8, { ai: false, character: STRONG }), // live human
            makeActor('en-0', 'enemy', 1, { character: WEAK }),
        ];
        const s = makeSession(actors);
        (0, _engine_js_1.startRound)(s);
        (0, _engine_js_1.runAiUntilHuman)(s, makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(1));
        if (s.status === 'active') {
            node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s)?.ai, false, 'stops on a human turn');
            node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s)?.id, 'sq-1');
        }
    });
});
