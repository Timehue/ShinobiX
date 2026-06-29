"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _sim_js_1 = require("./_sim.js");
const _encounter_js_1 = require("./_encounter.js");
const _engine_js_1 = require("./_engine.js");
const _tower_session_js_1 = require("./_tower-session.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _enemy_templates_js_1 = require("./_enemy-templates.js");
function smallFloor(over = {}) {
    return {
        id: 1, name: 'T', biome: 'forest', objective: 'defeat-all', roundBudget: 25,
        map: { width: 8, height: 8 }, fieldRule: { kind: 'none' },
        enemies: [{ aiId: 'grunt-bandit', count: 2 }], firstClearReward: {}, ...over,
    };
}
function strongMember(id) {
    return {
        id, name: id, ownerSlug: `slug-${id}`, ai: true,
        character: { specialty: 'Taijutsu', maxHp: 1500, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500, strength: 100, speed: 100 } },
    };
}
function build(floor, squad, over = {}) {
    return (0, _encounter_js_1.buildTowerEncounter)({ floor, squad, runId: 'tower-test', seed: 42, partySize: squad.length, now: 1000, ...over });
}
(0, node_test_1.describe)('Battle Towers encounter builder (P1.B)', () => {
    (0, node_test_1.it)('builds squad + enemy actors with sane sides and in-bounds positions', () => {
        const s = build(smallFloor(), [strongMember('sq-0'), strongMember('sq-1')]);
        node_assert_1.strict.equal(s.actors.filter(a => a.side === 'squad').length, 2);
        node_assert_1.strict.equal(s.actors.filter(a => a.side === 'enemy').length, 2);
        for (const a of s.actors) {
            node_assert_1.strict.ok(a.pos >= 0 && a.pos < s.map.width * s.map.height, `pos in bounds for ${a.id}`);
            node_assert_1.strict.ok(a.hp > 0 && a.hp === a.maxHp, `full hp for ${a.id}`);
        }
        // squad on the left edge, enemies on the right edge → no shared tiles
        const positions = s.actors.map(a => a.pos);
        node_assert_1.strict.equal(new Set(positions).size, positions.length, 'no spawn overlap');
    });
    (0, node_test_1.it)('runs an end-to-end floor: a strong squad clears defeat-all', () => {
        const s = (0, _engine_js_1.runTowerFloor)(build(smallFloor(), [strongMember('sq-0'), strongMember('sq-1')]), smallFloor(), (0, _sim_js_1.makeRng)(1));
        node_assert_1.strict.equal(s.winner, 'squad');
        node_assert_1.strict.equal(s.status, 'done');
        node_assert_1.strict.ok(s.objectiveState.completed);
    });
    (0, node_test_1.it)('is deterministic (same inputs → byte-identical encounter + run)', () => {
        const a = (0, _engine_js_1.runTowerFloor)(build(smallFloor(), [strongMember('sq-0')]), smallFloor(), (0, _sim_js_1.makeRng)(7));
        const b = (0, _engine_js_1.runTowerFloor)(build(smallFloor(), [strongMember('sq-0')]), smallFloor(), (0, _sim_js_1.makeRng)(7));
        node_assert_1.strict.equal(JSON.stringify(a), JSON.stringify(b));
    });
    (0, node_test_1.it)('party-scales enemy HP for a duo vs the 4-balance baseline', () => {
        const full = build(smallFloor({ balanceFor: 4 }), [strongMember('a'), strongMember('b'), strongMember('c'), strongMember('d')], { partySize: 4 });
        const duo = build(smallFloor({ balanceFor: 4 }), [strongMember('a'), strongMember('b')], { partySize: 2 });
        const fullHp = (0, _tower_session_js_1.getActor)(full, 'en-0').maxHp;
        const duoHp = (0, _tower_session_js_1.getActor)(duo, 'en-0').maxHp;
        node_assert_1.strict.equal(fullHp, (0, _enemy_templates_js_1.getEnemyTemplate)('grunt-bandit').hp, 'full party = unscaled template HP');
        node_assert_1.strict.ok(duoHp < fullHp, `duo enemy HP ${duoHp} < full ${fullHp}`);
        node_assert_1.strict.equal((0, _tower_session_js_1.getActor)(duo, 'en-0').character.towerDmgScale, 0.6);
    });
    (0, node_test_1.it)('places a boss (with phases) and an npc when the floor has them', () => {
        const bossFloor = smallFloor({ objective: 'defeat-boss', enemies: [], boss: { aiId: 'boss-warden', phases: [33, 66] } });
        const s = build(bossFloor, [strongMember('sq-0')]);
        node_assert_1.strict.equal(s.phaseState.bossId, 'boss');
        node_assert_1.strict.deepEqual(s.phaseState.pendingPhases, [66, 33]);
        node_assert_1.strict.ok((0, _tower_session_js_1.getActor)(s, 'boss'));
        const npcFloor = smallFloor({ objective: 'protect-npc', npc: { aiId: 'npc-genin', pos: 9 } });
        const s2 = build(npcFloor, [strongMember('sq-0')]);
        const npc = s2.actors.find(a => a.side === 'npc');
        node_assert_1.strict.ok(npc, 'npc placed');
        node_assert_1.strict.equal(npc.pos, 9);
        node_assert_1.strict.equal(s2.objectiveState.npcAlive, true);
    });
    (0, node_test_1.it)('every aiId referenced by the shipped floor catalog has a real enemy template', () => {
        for (const floor of _floor_catalog_js_1.FLOOR_CATALOG) {
            for (const pod of floor.enemies) {
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(pod.aiId), `missing template for enemy "${pod.aiId}" on floor ${floor.id}`);
            }
            if (floor.boss)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.boss.aiId), `missing boss template "${floor.boss.aiId}" on floor ${floor.id}`);
            if (floor.npc)
                node_assert_1.strict.ok((0, _enemy_templates_js_1.hasEnemyTemplate)(floor.npc.aiId), `missing npc template "${floor.npc.aiId}" on floor ${floor.id}`);
        }
    });
});
(0, node_test_1.describe)('Battle Towers per-run elements (3 of 5, seeded)', () => {
    const VALID = new Set(['Fire', 'Water', 'Earth', 'Lightning', 'Wind']);
    (0, node_test_1.it)('picks exactly 3 distinct valid elements', () => {
        for (const seed of [1, 42, 9999, 0x7fffffff]) {
            const els = (0, _encounter_js_1.pickTowerElements)(seed);
            node_assert_1.strict.equal(els.length, 3, `seed ${seed}`);
            node_assert_1.strict.equal(new Set(els).size, 3, `seed ${seed}: distinct`);
            for (const e of els)
                node_assert_1.strict.ok(VALID.has(e), `seed ${seed}: ${e} valid`);
        }
    });
    (0, node_test_1.it)('is deterministic per seed (settle recompute reproduces it)', () => {
        node_assert_1.strict.deepEqual((0, _encounter_js_1.pickTowerElements)(12345), (0, _encounter_js_1.pickTowerElements)(12345));
        // and varies across seeds (not a constant)
        node_assert_1.strict.notDeepEqual((0, _encounter_js_1.pickTowerElements)(1), (0, _encounter_js_1.pickTowerElements)(4));
    });
    (0, node_test_1.it)('assigns the seeded elements to a floor\'s pylons (catalog elements are placeholders)', () => {
        const floor = _floor_catalog_js_1.FLOOR_CATALOG.find(f => f.features?.some(x => x.kind === 'pylon'));
        const session = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: [strongMember('a')], runId: 'r', seed: 777, partySize: 4, now: 1 });
        const want = (0, _encounter_js_1.pickTowerElements)(777);
        const pylons = (session.map.features ?? []).filter(f => f.kind === 'pylon');
        node_assert_1.strict.ok(pylons.length > 0);
        for (const p of pylons)
            node_assert_1.strict.ok(want.includes(p.element), `pylon element ${p.element} ∈ ${want.join(',')}`);
    });
});
(0, node_test_1.describe)('Battle Towers feature placement (non-overlapping, off the spawn band)', () => {
    const SPAWN_LEFT_COLS = 3; // mirrors _encounter
    (0, node_test_1.it)('features never overlap, avoid the player spawn band, and no actor spawns on one', () => {
        for (const floor of _floor_catalog_js_1.FLOOR_CATALOG) {
            for (const seed of [1, 55, 4242]) {
                const session = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad: [strongMember('h')], runId: 'r', seed, partySize: 4, now: 1 });
                const feats = session.map.features ?? [];
                const W = session.map.width;
                // (a) no two feature tiles collide
                const seen = new Set();
                for (const f of feats) {
                    for (const t of f.tiles) {
                        node_assert_1.strict.ok(!seen.has(t), `floor ${floor.id} seed ${seed}: feature overlap at ${t}`);
                        seen.add(t);
                        // (b) never in the player spawn band (left columns)
                        node_assert_1.strict.ok((t % W) > SPAWN_LEFT_COLS, `floor ${floor.id} seed ${seed}: feature in spawn band at col ${t % W}`);
                        // and on-board
                        node_assert_1.strict.ok(t >= 0 && t < W * session.map.height, `floor ${floor.id}: feature tile ${t} off-board`);
                    }
                }
                // (c) no actor stands on a feature tile at spawn
                for (const a of session.actors) {
                    node_assert_1.strict.ok(!seen.has(a.pos), `floor ${floor.id} seed ${seed}: ${a.id} spawned on a feature (${a.pos})`);
                }
            }
        }
    });
});
// Regression guard for the per-rank STAT CAP: tower combat routes through applyJutsu,
// which clamps each fighter's stats to statCapForLevel(level). Every enemy template MUST
// carry a level whose rank-band cap is >= its biggest stat, or its hand-tuned stats get
// gutted to the Academy ceiling in combat (the boss-over-nerf bug). statCapForLevel here
// mirrors api/pvp/move.ts (and shinobij.client/src/constants/game.ts).
(0, node_test_1.describe)('enemy templates fit their rank-band stat cap (no combat over-clamp)', () => {
    const statCapForLevel = (level) => {
        const lvl = Math.max(1, Math.floor(Number(level) || 1));
        if (lvl >= 80)
            return 2500;
        if (lvl >= 50)
            return 2100;
        if (lvl >= 30)
            return 1300;
        if (lvl >= 15)
            return 700;
        return 350;
    };
    for (const id of _enemy_templates_js_1.ENEMY_TEMPLATE_IDS) {
        (0, node_test_1.it)(`${id}: every stat fits statCapForLevel(level)`, () => {
            const tpl = (0, _enemy_templates_js_1.getEnemyTemplate)(id);
            node_assert_1.strict.ok(typeof tpl.level === 'number' && tpl.level >= 1, `${id} has no level`);
            const cap = statCapForLevel(tpl.level);
            for (const [k, v] of Object.entries(tpl.stats)) {
                node_assert_1.strict.ok(v <= cap, `${id}.${k}=${v} exceeds the level-${tpl.level} rank cap ${cap} — it would be clamped in combat; raise the template's level`);
            }
        });
    }
});
