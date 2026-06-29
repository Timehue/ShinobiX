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
// level: 100 so the per-rank stat cap (move.ts perRankStatCap, Special Jonin = 2500)
// is a no-op for these fixtures — these engine tests exercise win/loss + scaling with
// an intended raw stat gap, not the anti-twink clamp (which is unit-tested separately).
const STRONG = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } };
const WEAK = { specialty: 'Taijutsu', level: 100, stats: { taijutsuOffense: 200, taijutsuDefense: 200 } };
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
        const j = { effectPower: 10, type: 'Taijutsu', ap: 60 }; // 60 AP = real damage jutsu (40 AP is the utility convention → 0 dmg)
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
        const j = { effectPower: 10, type: 'Taijutsu', ap: 60 }; // 60 AP = real damage jutsu (40 AP is the utility convention → 0 dmg)
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
    (0, node_test_1.it)('runAiUntilHuman never leaves an all-AI run stuck active (timeout safety net)', () => {
        // No live human → the driver must reach a terminal state, never freeze on an active board.
        const s = makeSession([
            makeActor('sq-1', 'squad', 0, { ai: true, character: WEAK }),
            makeActor('en-1', 'enemy', 1, { character: STRONG }),
        ]);
        (0, _engine_js_1.startRound)(s);
        (0, _engine_js_1.runAiUntilHuman)(s, makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(3));
        node_assert_1.strict.equal(s.status, 'done', 'an all-AI run always resolves');
    });
});
(0, node_test_1.describe)('Battle Towers environmental features (pylons / wards / hazards)', () => {
    // A Fire-jutsu attacker on tile 0 vs a tanky enemy on tile 1 (adjacent). Returns the
    // single-hit damage dealt, optionally with battlefield features in play.
    const FIRE_CASTER = {
        specialty: 'Ninjutsu',
        stats: { ninjutsuOffense: 2500, ninjutsuDefense: 2500 },
        jutsu: [{ id: 'fireball', element: 'Fire', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 1 }],
    };
    function fireballDamage(features) {
        const attacker = makeActor('sq-1', 'squad', 0, { ai: false, ownerSlug: 'me', character: FIRE_CASTER });
        const enemy = makeActor('en-1', 'enemy', 1, { character: WEAK, hp: 100000, maxHp: 100000 });
        const session = makeSession([attacker, enemy], { map: { ...MAP8, features } });
        (0, _engine_js_1.startRound)(session);
        const res = (0, _engine_js_1.applyAction)(session, makeFloor('defeat-all'), { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fireball', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(res.applied, 'fireball applied');
        return 100000 - (0, _tower_session_js_1.getActor)(session, 'en-1').hp;
    }
    (0, node_test_1.it)('a Flame Pylon boosts the matching element and weakens the opposite', () => {
        const base = fireballDamage([]);
        const boosted = fireballDamage([{ kind: 'pylon', tiles: [0], element: 'Fire', weakenElement: 'Water', percent: 25 }]);
        const weakened = fireballDamage([{ kind: 'pylon', tiles: [0], element: 'Water', weakenElement: 'Fire', percent: 25 }]);
        node_assert_1.strict.ok(boosted > base, 'Fire on a Fire pylon hits harder');
        node_assert_1.strict.ok(weakened < base, 'Fire on a Water pylon hits softer');
        // ~+25% / ~-25% (allow ±1 for floor rounding)
        node_assert_1.strict.ok(Math.abs(boosted - Math.floor(base * 1.25)) <= 1, `boosted≈+25% (base ${base}, got ${boosted})`);
        node_assert_1.strict.ok(Math.abs(weakened - Math.floor(base * 0.75)) <= 1, `weakened≈-25% (base ${base}, got ${weakened})`);
    });
    (0, node_test_1.it)('a pylon does nothing unless the attacker stands on it', () => {
        const base = fireballDamage([]);
        const offPylon = fireballDamage([{ kind: 'pylon', tiles: [5], element: 'Fire', weakenElement: 'Water', percent: 25 }]);
        node_assert_1.strict.equal(offPylon, base, 'pylon on a different tile has no effect');
    });
    (0, node_test_1.it)('a ward reduces damage taken by a unit on its tile', () => {
        const base = fireballDamage([]);
        const warded = fireballDamage([{ kind: 'ward', tiles: [1], percent: 20 }]); // enemy stands on tile 1
        node_assert_1.strict.ok(warded < base, 'a warded target takes less');
        node_assert_1.strict.ok(Math.abs(warded - Math.floor(base * 0.8)) <= 1, `ward≈-20% (base ${base}, got ${warded})`);
    });
    (0, node_test_1.it)('a hazard chips a unit standing on it at round end', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: WEAK }); // on the hazard
        const sq2 = makeActor('sq-2', 'squad', 8, { character: WEAK });
        const en = makeActor('en-1', 'enemy', 63, { character: WEAK }); // far corner
        const session = makeSession([sq, sq2, en], { map: { ...MAP8, features: [{ kind: 'hazard', tiles: [0], percent: 10 }] } });
        (0, _engine_js_1.startRound)(session);
        const floor = makeFloor('defeat-all');
        const startHp = (0, _tower_session_js_1.getActor)(session, 'sq-1').hp;
        const r0 = session.round;
        let guard = 0;
        while (session.round === r0 && session.status === 'active' && guard++ < 20)
            (0, _engine_js_1.endTurn)(session, floor);
        const after = (0, _tower_session_js_1.getActor)(session, 'sq-1').hp;
        node_assert_1.strict.equal(after, startHp - Math.floor(startHp * 0.1), 'lost 10% maxHp to the hazard at round end');
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(session, 'sq-2').hp === startHp, 'a unit off the hazard is untouched');
    });
    (0, node_test_1.it)('features stay deterministic (settle recompute reproduces them byte-for-byte)', () => {
        const features = [
            { kind: 'pylon', tiles: [3], element: 'Fire', weakenElement: 'Water', percent: 25 },
            { kind: 'ward', tiles: [10], percent: 20 },
            { kind: 'hazard', tiles: [4], percent: 8 },
        ];
        const build = () => makeSession(frontline(), { map: { ...MAP8, features } });
        const a = (0, _engine_js_1.runTowerFloor)(build(), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(777));
        const b = (0, _engine_js_1.runTowerFloor)(build(), makeFloor('defeat-all'), (0, _sim_js_1.makeRng)(777));
        node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b));
    });
});
(0, node_test_1.describe)('Battle Towers boss mechanics (bulwark / regen / summon / enrage)', () => {
    function attacker() {
        return makeActor('sq-1', 'squad', 0, { ai: false, ownerSlug: 'me', character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 } } });
    }
    const bossFloor = makeFloor('defeat-boss', { id: 5 });
    (0, node_test_1.it)('bulwark: boss takes HALF damage while a guard lives, full when it is alone', () => {
        const hit = (guardHp) => {
            const boss = makeActor('boss', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { specialty: 'Taijutsu', stats: { taijutsuDefense: 200 }, mechanic: 'bulwark' } });
            const guard = makeActor('en-1', 'enemy', 8, { hp: guardHp, maxHp: Math.max(1, guardHp), character: WEAK });
            const s = makeSession([attacker(), boss, guard], { objectiveKind: 'defeat-boss', bossId: 'boss' });
            (0, _engine_js_1.startRound)(s);
            (0, _engine_js_1.applyAction)(s, bossFloor, { actorId: 'sq-1', type: 'attack', targetId: 'boss' }, (0, _sim_js_1.makeRng)(1));
            return 1_000_000 - (0, _tower_session_js_1.getActor)(s, 'boss').hp;
        };
        const guarded = hit(100); // a guard is alive → bulwark halves it
        const alone = hit(0); // guard already down → full damage
        node_assert_1.strict.ok(guarded > 0 && alone > 0);
        node_assert_1.strict.ok(Math.abs(guarded - Math.floor(alone * 0.5)) <= 1, `guarded≈half (${guarded} vs ${alone})`);
    });
    (0, node_test_1.it)('enrage: a stack ramps the boss outgoing damage ~+35%', () => {
        const bossHit = (enrage) => {
            const boss = makeActor('boss', 'enemy', 1, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 2500, taijutsuDefense: 2500 }, mechanic: 'enrage', enrage } });
            const tgt = makeActor('sq-1', 'squad', 0, { hp: 1_000_000, maxHp: 1_000_000, character: WEAK });
            const s = makeSession([tgt, boss], { objectiveKind: 'defeat-boss', bossId: 'boss' });
            (0, _engine_js_1.startRound)(s);
            (0, _engine_js_1.endTurn)(s, bossFloor); // advance to the boss's turn
            (0, _engine_js_1.applyAction)(s, bossFloor, { actorId: 'boss', type: 'attack', targetId: 'sq-1' }, (0, _sim_js_1.makeRng)(1));
            return 1_000_000 - (0, _tower_session_js_1.getActor)(s, 'sq-1').hp;
        };
        const base = bossHit(0);
        const raged = bossHit(1);
        node_assert_1.strict.ok(raged > base, 'enraged boss hits harder');
        node_assert_1.strict.ok(Math.abs(raged - Math.floor(base * 1.35)) <= 1, `enrage≈+35% (${base} → ${raged})`);
    });
    (0, node_test_1.it)('summon: crossing a phase gate spawns reinforcements', () => {
        const boss = makeActor('boss', 'enemy', 1, {
            hp: 610, maxHp: 1000,
            character: { specialty: 'Taijutsu', stats: { taijutsuDefense: 200 }, mechanic: 'summon', summonCount: 2, summonTemplate: { name: 'Add', specialty: 'Taijutsu', hp: 200, stats: {}, visual: 'bandit' } },
        });
        const s = makeSession([attacker(), boss], { objectiveKind: 'defeat-boss', bossId: 'boss', bossPhases: [60] });
        (0, _engine_js_1.startRound)(s);
        (0, _engine_js_1.applyAction)(s, bossFloor, { actorId: 'sq-1', type: 'attack', targetId: 'boss' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'boss').hp < 600, 'boss dropped past the 60% gate');
        const adds = s.actors.filter(a => a.id.startsWith('add-'));
        node_assert_1.strict.ok(adds.length >= 1 && adds.every(a => a.side === 'enemy'), 'spawned enemy adds');
    });
    (0, node_test_1.it)('regen: the boss heals at round end', () => {
        const boss = makeActor('boss', 'enemy', 1, { hp: 500, maxHp: 1000, character: { specialty: 'Taijutsu', stats: {}, mechanic: 'regen' } });
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: WEAK }), makeActor('sq-2', 'squad', 8, { character: WEAK }), boss], { objectiveKind: 'defeat-boss', bossId: 'boss' });
        (0, _engine_js_1.startRound)(s);
        const r0 = s.round;
        let guard = 0;
        while (s.round === r0 && s.status === 'active' && guard++ < 20)
            (0, _engine_js_1.endTurn)(s, bossFloor);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'boss').hp > 500, 'regen healed the boss at round end');
    });
});
// ─── Real loadout: resource costs / cooldowns / weapons / consumables / terrain ───
(0, node_test_1.describe)('Battle Towers loadout combat (jutsu resources / cooldowns / weapons / items)', () => {
    const floor = makeFloor('defeat-all');
    // sq-1 (caster) adjacent to a high-HP dummy enemy that survives the fight.
    function caster(jutsu, over = {}) {
        return makeActor('sq-1', 'squad', 0, { chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 2000 }, jutsu, ...over } });
    }
    const bigEnemy = () => makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });
    (0, node_test_1.it)('a jutsu deducts its chakra + stamina cost', () => {
        const sq = caster([{ id: 'fb', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 2, chakraCost: 30, staminaCost: 10 }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fb', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').chakra, 70);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').stamina, 90);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').hp < 1_000_000, 'dealt real damage');
    });
    (0, node_test_1.it)('blocks a jutsu the actor cannot afford (chakra)', () => {
        const sq = caster([{ id: 'fb', type: 'Ninjutsu', effectPower: 40, ap: 60, range: 2, chakraCost: 30 }], {});
        sq.chakra = 5;
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'fb', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(r.applied, false);
        node_assert_1.strict.equal(r.reason, 'no-chakra');
    });
    (0, node_test_1.it)('arms a cooldown on cast, blocks reuse, then ticks down on the next turn', () => {
        const sq = caster([{ id: 'cdj', type: 'Ninjutsu', effectPower: 30, ap: 30, range: 2, cooldown: 2 }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'cdj', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').cooldowns['cdj'], 2, 'cooldown armed');
        const again = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'cdj', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(again.reason, 'on-cooldown');
        // sq-1's turn ends → enemy's "turn" → round rolls over → sq-1 up again (ticks its cd).
        (0, _engine_js_1.endTurn)(s, floor);
        (0, _engine_js_1.endTurn)(s, floor);
        node_assert_1.strict.equal((0, _tower_session_js_1.activeActor)(s).id, 'sq-1');
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').cooldowns['cdj'], 1, 'cooldown ticked down a turn');
    });
    (0, node_test_1.it)('a 40-AP utility jutsu deals zero direct damage (tag layer deferred)', () => {
        const sq = caster([{ id: 'buff', type: 'Ninjutsu', effectPower: 40, ap: 40, range: 2 }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'buff', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-1').hp, 1_000_000, 'utility jutsu does no phantom damage');
    });
    (0, node_test_1.it)('an equipped weapon strikes for its weaponEp', () => {
        const sq = makeActor('sq-1', 'squad', 0, { character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'sword', slot: 'hand', weaponEp: 30, weaponRange: 1, apCost: 40 }], equipment: { hand: 'sword' } } });
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'sword' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied, 'weapon attack applied');
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').hp < 1_000_000, 'weapon dealt damage');
    });
    (0, node_test_1.it)('a thrown weapon spends a charge and runs out', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            itemCharges: { kunai: 1 },
            character: { specialty: 'Bukijutsu', stats: { bukijutsuOffense: 1500 }, pvpItems: [{ id: 'kunai', slot: 'thrown', weaponEp: 20, weaponRange: 4, apCost: 40 }], equipment: { thrown: 'kunai' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'kunai' }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').itemCharges['kunai'], 0, 'charge spent');
        const out = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'weapon', targetId: 'en-1', itemId: 'kunai' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(out.reason, 'out-of-ammo');
    });
    (0, node_test_1.it)('a potion restores chakra/stamina and spends a charge', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            chakra: 10, maxChakra: 100, stamina: 50, maxStamina: 100, itemCharges: { pot: 2 },
            character: { specialty: 'Ninjutsu', stats: {}, pvpItems: [{ id: 'pot', slot: 'potion', restoreChakra: 50, restoreStamina: 20, apCost: 35 }], equipment: { potion: 'pot' } },
        });
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'pot' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').chakra, 60);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').stamina, 70);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').itemCharges['pot'], 1, 'one charge spent');
    });
    (0, node_test_1.it)('biome terrain gives the matching discipline +10%', () => {
        const j = { id: 'tj', type: 'Taijutsu', effectPower: 40, ap: 60, range: 1 };
        const hit = (biome) => {
            const sq = makeActor('sq-1', 'squad', 0, { character: { specialty: 'Taijutsu', stats: { taijutsuOffense: 1500 }, jutsu: [j] } });
            const en = makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });
            const s = makeSession([sq, en], { map: { ...MAP8, biome } });
            (0, _engine_js_1.startRound)(s);
            (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'tj', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
            return 1_000_000 - (0, _tower_session_js_1.getActor)(s, 'en-1').hp;
        };
        const forest = hit('forest'); // Taijutsu match → 1.1×
        const central = hit('central'); // no terrain bonus
        node_assert_1.strict.ok(forest > central, 'forest boosts Taijutsu');
        node_assert_1.strict.ok(Math.abs(forest - Math.floor(central * 1.1)) <= 2, `forest≈+10% (${central} → ${forest})`);
    });
});
// ─── Tag / status combat (reuses PvP applyJutsu + applyDoTs/tickStatuses) ─────
(0, node_test_1.describe)('Battle Towers tag/status combat (heal / DoT / buff / stun / self-cast)', () => {
    const floor = makeFloor('defeat-all');
    function caster(jutsu, over = {}) {
        return makeActor('sq-1', 'squad', 0, { chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu }, ...over });
    }
    const bigEnemy = (over = {}) => makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, chakra: 1000, maxChakra: 1000, character: { stats: {} }, ...over });
    const cast = (s, jutsuId, targetId = 'en-1') => (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId, targetId }, (0, _sim_js_1.makeRng)(1));
    (0, node_test_1.it)('a Heal-tag jutsu heals the caster', () => {
        const sq = caster([{ id: 'mend', name: 'Mend', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Heal' }] }], { hp: 200, maxHp: 5000 });
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok(cast(s, 'mend').applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'sq-1').hp > 200, 'caster healed');
    });
    (0, node_test_1.it)('a self-target jutsu resolves on the caster (no foe needed)', () => {
        const sq = caster([{ id: 'guard', name: 'Inner Guard', type: 'Ninjutsu', ap: 40, range: 0, target: 'SELF', tags: [{ name: 'Heal' }] }], { hp: 100, maxHp: 5000 });
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        // targetId is ignored for a SELF jutsu — it always resolves on the caster.
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'guard', targetId: 'sq-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'sq-1').hp > 100, 'self-heal applied');
    });
    (0, node_test_1.it)('a Stun-tag jutsu applies Stun to the enemy', () => {
        const sq = caster([{ id: 'flash', name: 'Flash', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Stun' }] }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok(cast(s, 'flash').applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').statuses.some(st => st.name === 'Stun'), 'enemy is stunned');
    });
    (0, node_test_1.it)('an Increase-Damage-Given jutsu buffs the caster', () => {
        const sq = caster([{ id: 'rage', name: 'Rage', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Increase Damage Given', percent: 30 }] }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok(cast(s, 'rage').applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'sq-1').statuses.some(st => st.name === 'Increase Damage Given'), 'caster gains the buff');
    });
    (0, node_test_1.it)('Poison bleeds the enemy over rounds (DoT ticks at round end)', () => {
        const sq = caster([{ id: 'venom', name: 'Venom', type: 'Ninjutsu', ap: 40, range: 2, target: 'OPPONENT', tags: [{ name: 'Poison', percent: 10 }] }]);
        const s = makeSession([sq, bigEnemy()]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok(cast(s, 'venom').applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').statuses.some(st => st.name === 'Poison'), 'enemy poisoned');
        // Drive rounds: Poison defers one round (activeRound = round+1), then ticks at round end.
        let guard = 0;
        while (s.round < 3 && s.status === 'active' && guard++ < 60)
            (0, _engine_js_1.endTurn)(s, floor);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').hp < 1_000_000, 'poison bled the enemy');
    });
});
// ─── AOE jutsu + full consumables (heal/buff potions) ────────────────────────
(0, node_test_1.describe)('Battle Towers AOE + consumables', () => {
    const floor = makeFloor('defeat-all');
    (0, node_test_1.it)('an AOE jutsu splashes the foes around the struck target', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu: [{ id: 'nova', name: 'Nova', type: 'Ninjutsu', ap: 60, range: 3, effectPower: 60, method: 'AOE_CIRCLE' }] } });
        const e1 = makeActor('en-1', 'enemy', 1, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const e2 = makeActor('en-2', 'enemy', 2, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const s = makeSession([sq, e1, e2]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'nova', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').hp < 100_000, 'primary target hit');
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-2').hp < 100_000, 'adjacent foe caught in the blast');
    });
    (0, node_test_1.it)('a single-target jutsu does NOT splash neighbors', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: { ninjutsuOffense: 1500 }, jutsu: [{ id: 'bolt', name: 'Bolt', type: 'Ninjutsu', ap: 60, range: 3, effectPower: 60, method: 'SINGLE' }] } });
        const e1 = makeActor('en-1', 'enemy', 1, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const e2 = makeActor('en-2', 'enemy', 2, { hp: 100_000, maxHp: 100_000, character: { stats: {} } });
        const s = makeSession([sq, e1, e2]);
        (0, _engine_js_1.startRound)(s);
        (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'bolt', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'en-2').hp, 100_000, 'neighbor untouched by a single-target jutsu');
    });
    (0, node_test_1.it)('a Heal-tag potion (no restore values) heals the caster + spends a charge', () => {
        const sq = makeActor('sq-1', 'squad', 0, {
            hp: 200, maxHp: 5000, itemCharges: { 'heal-pot': 2 },
            character: { specialty: 'Ninjutsu', stats: {}, jutsu: [], pvpItems: [{ id: 'heal-pot', name: 'Salve', slot: 'potion', weaponTags: [{ name: 'Heal' }], apCost: 35 }], equipment: { potion: 'heal-pot' } },
        });
        const en = makeActor('en-1', 'enemy', 1, { hp: 1_000_000, maxHp: 1_000_000, character: { stats: {} } });
        const s = makeSession([sq, en]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'item', itemId: 'heal-pot' }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'sq-1').hp > 200, 'heal potion healed the caster');
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').itemCharges['heal-pot'], 1, 'charge spent');
    });
    (0, node_test_1.it)('a ground-target jutsu places a persistent zone that poisons units standing in it', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 5000, maxHp: 5000, chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: {}, jutsu: [{ id: 'mire', name: 'Poison Mire', type: 'Ninjutsu', ap: 60, range: 4, target: 'EMPTY_GROUND', tags: [{ name: 'Poison', percent: 10 }] }] } });
        const en = makeActor('en-1', 'enemy', 3, { hp: 1_000_000, maxHp: 1_000_000, chakra: 1000, maxChakra: 1000, character: { stats: {} } });
        const s = makeSession([sq, en]);
        (0, _engine_js_1.startRound)(s);
        const r = (0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'mire', tile: 3 }, (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.ok(r.applied, 'ground jutsu placed at the tile');
        node_assert_1.strict.equal((s.groundEffects ?? []).length, 1, 'a persistent zone was created');
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').statuses.some(st => st.name === 'Poison'), 'a unit standing in the zone is poisoned on cast');
        // Drive rounds: the zone re-applies + the poison bleeds, then the zone expires.
        let guard = 0;
        while (s.round < 3 && s.status === 'active' && guard++ < 60)
            (0, _engine_js_1.endTurn)(s, floor);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'en-1').hp < 1_000_000, 'the zone bled the enemy');
        node_assert_1.strict.equal((s.groundEffects ?? []).length, 0, 'the 2-round zone expired');
    });
    (0, node_test_1.it)('rejects a ground jutsu out of range / with no ground-eligible tags', () => {
        const sq = makeActor('sq-1', 'squad', 0, { chakra: 300, maxChakra: 300, character: { specialty: 'Ninjutsu', stats: {}, jutsu: [
                    { id: 'far', name: 'Far Mire', type: 'Ninjutsu', ap: 60, range: 2, target: 'EMPTY_GROUND', tags: [{ name: 'Poison' }] },
                    { id: 'empty', name: 'Empty Field', type: 'Ninjutsu', ap: 60, range: 4, target: 'EMPTY_GROUND', tags: [{ name: 'Heal' }] },
                ] } });
        const s = makeSession([sq, makeActor('en-1', 'enemy', 1, { hp: 9999, maxHp: 9999, character: { stats: {} } })]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'far', tile: 60 }, (0, _sim_js_1.makeRng)(1)).reason, 'out-of-range');
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'jutsu', jutsuId: 'empty', tile: 3 }, (0, _sim_js_1.makeRng)(1)).reason, 'no-ground-tags');
    });
});
// ─── Basic actions: heal / cleanse / clear / dash (ported from PvP) ───────────
(0, node_test_1.describe)('Battle Towers basic actions', () => {
    const floor = makeFloor('defeat-all');
    (0, node_test_1.it)('heal restores 10% max HP, costs chakra, goes on cooldown', () => {
        const sq = makeActor('sq-1', 'squad', 0, { hp: 1000, maxHp: 5000, chakra: 100, maxChakra: 100, character: { specialty: 'Ninjutsu', stats: {} } });
        const s = makeSession([sq, makeActor('en-1', 'enemy', 1, { character: WEAK })]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'heal' }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').hp, 1500);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').chakra, 90);
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'heal' }, (0, _sim_js_1.makeRng)(1)).reason, 'on-cooldown');
    });
    (0, node_test_1.it)('cleanse strips the actor\'s own debuffs but keeps buffs', () => {
        const sq = makeActor('sq-1', 'squad', 0, { statuses: [{ name: 'Poison', rounds: 2, kind: 'negative' }, { name: 'Increase Damage Given', rounds: 2, kind: 'positive' }], character: { specialty: 'Ninjutsu', stats: {} } });
        const s = makeSession([sq, makeActor('en-1', 'enemy', 1, { character: WEAK })]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'cleanse' }, (0, _sim_js_1.makeRng)(1)).applied);
        const st = (0, _tower_session_js_1.getActor)(s, 'sq-1').statuses;
        node_assert_1.strict.ok(!st.some(x => x.kind === 'negative'), 'debuffs gone');
        node_assert_1.strict.ok(st.some(x => x.name === 'Increase Damage Given'), 'buffs kept');
    });
    (0, node_test_1.it)('clear strips a hostile target\'s buffs', () => {
        const en = makeActor('en-1', 'enemy', 1, { statuses: [{ name: 'Reflect', rounds: 2, kind: 'positive' }], character: WEAK });
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: { specialty: 'Ninjutsu', stats: {} } }), en]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'clear', targetId: 'en-1' }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.ok(!(0, _tower_session_js_1.getActor)(s, 'en-1').statuses.some(x => x.kind === 'positive'), 'enemy buffs cleared');
    });
    (0, node_test_1.it)('dash relocates up to 3 hexes and rejects farther', () => {
        const s = makeSession([makeActor('sq-1', 'squad', 0, { character: { specialty: 'Ninjutsu', stats: {} } }), makeActor('en-1', 'enemy', 30, { character: WEAK })]);
        (0, _engine_js_1.startRound)(s);
        node_assert_1.strict.ok((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'dash', tile: 3 }, (0, _sim_js_1.makeRng)(1)).applied);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(s, 'sq-1').pos, 3);
        node_assert_1.strict.equal((0, _engine_js_1.applyAction)(s, floor, { actorId: 'sq-1', type: 'dash', tile: 60 }, (0, _sim_js_1.makeRng)(1)).reason, 'out-of-range');
    });
});
