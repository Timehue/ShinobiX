"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _anbu_infiltration_encounter_js_1 = require("./_anbu-infiltration-encounter.js");
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
function fighter(slug, name, maxHp, extra = {}) {
    return {
        slug, name,
        character: { level: 100, specialty: 'Ninjutsu', maxHp, maxChakra: 8000, maxStamina: 8000, stats: { ninjutsuOffence: 5000 }, ...extra },
    };
}
function build() {
    return (0, _anbu_infiltration_encounter_js_1.buildInfiltrationEncounter)({
        runId: 'infil-test-1',
        seed: 424242,
        now: NOW,
        raider: { ...fighter('raider', 'Raider', 9000), itemCharges: { 'kunai': 5, 'soldier-pill': 2 } },
        anbu: fighter('anbu-one', 'Anbu One', 12000),
        terrain: 'forest',
    });
}
(0, node_test_1.test)('biomeForTerrain: valid terrains pass; anything else is neutral central', () => {
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('forest'), 'forest');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('SNOW'), 'snow');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('volcano'), 'volcano');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('shadow'), 'shadow');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('central'), 'central');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)('swamp'), 'central');
    strict_1.default.equal((0, _anbu_infiltration_encounter_js_1.biomeForTerrain)(undefined), 'central');
});
(0, node_test_1.test)('makeInfiltrationFloor: defeat-boss shell, reserved id, off the public catalog', () => {
    const floor = (0, _anbu_infiltration_encounter_js_1.makeInfiltrationFloor)('volcano');
    strict_1.default.equal(floor.id, _anbu_infiltration_encounter_js_1.INFILTRATION_FLOOR_ID);
    strict_1.default.equal(floor.objective, 'defeat-boss');
    strict_1.default.equal(floor.biome, 'volcano');
    strict_1.default.equal(floor.enemies.length, 0);
    strict_1.default.equal(floor.map.width, _anbu_infiltration_encounter_js_1.INFILTRATION_MAP.width);
    strict_1.default.equal(floor.map.height, _anbu_infiltration_encounter_js_1.INFILTRATION_MAP.height);
});
(0, node_test_1.test)('buildInfiltrationEncounter: raider (squad) vs sealed Anbu (enemy boss)', () => {
    const { session, floor } = build();
    strict_1.default.equal(session.actors.length, 2);
    const raider = session.actors.find(a => a.id === 'sq-0');
    const anbu = session.actors.find(a => a.id === 'boss');
    strict_1.default.ok(raider && anbu);
    // Raider = live human squad member.
    strict_1.default.equal(raider.side, 'squad');
    strict_1.default.equal(raider.ai, false);
    strict_1.default.equal(raider.ownerSlug, 'raider');
    strict_1.default.equal(raider.hp, 9000);
    strict_1.default.equal(raider.maxHp, 9000);
    strict_1.default.deepEqual(raider.itemCharges, { 'kunai': 5, 'soldier-pill': 2 });
    // Anbu = AI-driven enemy boss, full strength, focus-fire targeting, no items.
    strict_1.default.equal(anbu.side, 'enemy');
    strict_1.default.equal(anbu.ai, true);
    strict_1.default.equal(anbu.ownerSlug, null); // matches the template-enemy contract
    strict_1.default.equal(anbu.hp, 12000);
    strict_1.default.equal(anbu.maxHp, 12000);
    strict_1.default.equal(anbu.character.boss, true);
    strict_1.default.equal(anbu.character.aiTargetMode, 'lowest-hp');
    strict_1.default.deepEqual(anbu.itemCharges, {});
    // The Anbu's real loadout carries through (sealed character preserved).
    strict_1.default.equal(anbu.character.level, 100);
    strict_1.default.equal(anbu.character.specialty, 'Ninjutsu');
    // Session wiring: boss tracked, defeat-boss objective, terrain biome for the home edge.
    strict_1.default.equal(session.phaseState.bossId, 'boss');
    strict_1.default.equal(session.objectiveState.kind, 'defeat-boss');
    strict_1.default.equal(session.map.biome, 'forest');
    strict_1.default.equal(session.partySize, 1);
    strict_1.default.equal(session.status, 'active');
    strict_1.default.equal(floor.objective, 'defeat-boss');
});
(0, node_test_1.test)('buildInfiltrationEncounter: raider left flank, Anbu right flank (they do not overlap)', () => {
    const { session } = build();
    const raider = session.actors.find(a => a.id === 'sq-0');
    const anbu = session.actors.find(a => a.id === 'boss');
    const W = _anbu_infiltration_encounter_js_1.INFILTRATION_MAP.width;
    strict_1.default.equal(raider.pos % W, 1); // left column
    strict_1.default.equal(anbu.pos % W, W - 2); // right column
    strict_1.default.notEqual(raider.pos, anbu.pos);
});
(0, node_test_1.test)('buildInfiltrationEncounter: deterministic (same inputs → identical session)', () => {
    const a = build();
    const b = build();
    strict_1.default.deepEqual(a.session, b.session);
    strict_1.default.deepEqual(a.floor, b.floor);
});
(0, node_test_1.test)('engine integration: the AI Anbu actually fights on the synthetic floor and the run terminates', async () => {
    // The whole feature rests on the shared tower engine running a SEALED real
    // character as the boss with no template lookup. Drive a full fight: the
    // raider only waits; the Anbu must act (deal damage) and the session must
    // reach 'done' within the round budget (KO or budget-fail — either ends it).
    const { applyAction, endTurn, runAiUntilHuman, startRound } = await import('./towers/_engine.js');
    const { makeRng } = await import('./towers/_sim.js');
    const { activeActor } = await import('./towers/_tower-session.js');
    const { session, floor } = (0, _anbu_infiltration_encounter_js_1.buildInfiltrationEncounter)({
        runId: 'infil-sim', seed: 777, now: NOW,
        raider: fighter('raider', 'Raider', 3000),
        // A strong melee Anbu with no jutsu → the AI basic-attacks (template
        // grunts do the same), which is enough to prove the sealed actor fights.
        anbu: fighter('anbu-one', 'Anbu One', 12000, { stats: { taijutsuOffence: 4000, taijutsuDefence: 2000 } }),
        terrain: 'snow',
    });
    const rng = makeRng(session.seed);
    startRound(session);
    runAiUntilHuman(session, floor, rng);
    let guard = 0;
    while (session.status === 'active' && guard++ < 200) {
        const actor = activeActor(session);
        if (!actor || actor.ai) {
            runAiUntilHuman(session, floor, rng);
            continue;
        }
        const result = applyAction(session, floor, { actorId: actor.id, type: 'wait' }, rng);
        strict_1.default.equal(result.applied, true);
        endTurn(session, floor);
        runAiUntilHuman(session, floor, rng);
    }
    strict_1.default.equal(session.status, 'done', 'fight must terminate');
    strict_1.default.ok(session.winner, 'a winner must be recorded');
    const raider = session.actors.find(a => a.id === 'sq-0');
    strict_1.default.ok(raider.hp < raider.maxHp, 'the AI Anbu must have dealt damage to the idle raider');
});
