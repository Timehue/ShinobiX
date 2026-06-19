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
