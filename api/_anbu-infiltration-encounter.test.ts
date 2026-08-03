import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildInfiltrationEncounter,
    biomeForTerrain,
    makeInfiltrationFloor,
    INFILTRATION_FLOOR_ID,
    INFILTRATION_MAP,
    type InfiltrationFighter,
} from './_anbu-infiltration-encounter.js';

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);

function fighter(slug: string, name: string, maxHp: number, extra: Record<string, unknown> = {}): InfiltrationFighter {
    return {
        slug, name,
        character: { level: 100, specialty: 'Ninjutsu', maxHp, maxChakra: 8000, maxStamina: 8000, stats: { ninjutsuOffence: 5000 }, ...extra },
    };
}

function build() {
    return buildInfiltrationEncounter({
        runId: 'infil-test-1',
        seed: 424242,
        now: NOW,
        raider: { ...fighter('raider', 'Raider', 9000), itemCharges: { 'kunai': 5, 'soldier-pill': 2 } },
        anbu: fighter('anbu-one', 'Anbu One', 12000),
        terrain: 'forest',
    });
}

test('biomeForTerrain: valid terrains pass; anything else is neutral central', () => {
    assert.equal(biomeForTerrain('forest'), 'forest');
    assert.equal(biomeForTerrain('SNOW'), 'snow');
    assert.equal(biomeForTerrain('volcano'), 'volcano');
    assert.equal(biomeForTerrain('shadow'), 'shadow');
    assert.equal(biomeForTerrain('central'), 'central');
    assert.equal(biomeForTerrain('swamp'), 'central');
    assert.equal(biomeForTerrain(undefined), 'central');
});

test('makeInfiltrationFloor: defeat-boss shell, reserved id, off the public catalog', () => {
    const floor = makeInfiltrationFloor('volcano');
    assert.equal(floor.id, INFILTRATION_FLOOR_ID);
    assert.equal(floor.objective, 'defeat-boss');
    assert.equal(floor.biome, 'volcano');
    assert.equal(floor.enemies.length, 0);
    assert.equal(floor.map.width, INFILTRATION_MAP.width);
    assert.equal(floor.map.height, INFILTRATION_MAP.height);
});

test('buildInfiltrationEncounter: raider (squad) vs sealed Anbu (enemy boss)', () => {
    const { session, floor } = build();
    assert.equal(session.actors.length, 2);

    const raider = session.actors.find(a => a.id === 'sq-0')!;
    const anbu = session.actors.find(a => a.id === 'boss')!;
    assert.ok(raider && anbu);

    // Raider = live human squad member.
    assert.equal(raider.side, 'squad');
    assert.equal(raider.ai, false);
    assert.equal(raider.ownerSlug, 'raider');
    assert.equal(raider.hp, 9000);
    assert.equal(raider.maxHp, 9000);
    assert.deepEqual(raider.itemCharges, { 'kunai': 5, 'soldier-pill': 2 });

    // Anbu = AI-driven enemy boss, full strength, focus-fire targeting, no items.
    assert.equal(anbu.side, 'enemy');
    assert.equal(anbu.ai, true);
    assert.equal(anbu.ownerSlug, null); // matches the template-enemy contract
    assert.equal(anbu.hp, 12000);
    assert.equal(anbu.maxHp, 12000);
    assert.equal(anbu.character.boss, true);
    assert.equal(anbu.character.aiTargetMode, 'lowest-hp');
    assert.deepEqual(anbu.itemCharges, {});

    // The Anbu's real loadout carries through (sealed character preserved).
    assert.equal(anbu.character.level, 100);
    assert.equal(anbu.character.specialty, 'Ninjutsu');

    // Session wiring: boss tracked, defeat-boss objective, terrain biome for the home edge.
    assert.equal(session.phaseState.bossId, 'boss');
    assert.equal(session.objectiveState.kind, 'defeat-boss');
    assert.equal(session.map.biome, 'forest');
    assert.equal(session.partySize, 1);
    assert.equal(session.status, 'active');
    assert.equal(floor.objective, 'defeat-boss');
});

test('buildInfiltrationEncounter: raider and Anbu start a few hexes apart on their own sides', () => {
    const { session } = build();
    const raider = session.actors.find(a => a.id === 'sq-0')!;
    const anbu = session.actors.find(a => a.id === 'boss')!;
    const W = INFILTRATION_MAP.width;
    const mid = Math.floor(W / 2);
    assert.equal(raider.pos % W, mid - 2);                                  // left of centre
    assert.equal(anbu.pos % W, mid + 2);                                    // right of centre (guarding the vault)
    assert.equal(Math.floor(raider.pos / W), Math.floor(anbu.pos / W));     // same row
    assert.notEqual(raider.pos, anbu.pos);
    // The solo arena has no Dash (tower-only), so the two must NOT start full-board
    // apart, or the opening becomes a multi-turn walk. Keep the duel spacing tight.
    assert.ok((anbu.pos % W) - (raider.pos % W) <= 5, 'duel spacing stays tight');
});

test('buildInfiltrationEncounter: deterministic (same inputs → identical session)', () => {
    const a = build();
    const b = build();
    assert.deepEqual(a.session, b.session);
    assert.deepEqual(a.floor, b.floor);
});

test('engine integration: the AI Anbu actually fights on the synthetic floor and the run terminates', async () => {
    // The whole feature rests on the shared tower engine running a SEALED real
    // character as the boss with no template lookup. Drive a full fight: the
    // raider only waits; the Anbu must act (deal damage) and the session must
    // reach 'done' within the round budget (KO or budget-fail — either ends it).
    const { applyAction, endTurn, runAiUntilHuman, startRound } = await import('./towers/_engine.js');
    const { makeRng } = await import('./towers/_sim.js');
    const { activeActor } = await import('./towers/_tower-session.js');

    const { session, floor } = buildInfiltrationEncounter({
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
        if (!actor || actor.ai) { runAiUntilHuman(session, floor, rng); continue; }
        const result = applyAction(session, floor, { actorId: actor.id, type: 'wait' }, rng);
        assert.equal(result.applied, true);
        endTurn(session, floor);
        runAiUntilHuman(session, floor, rng);
    }

    assert.equal(session.status, 'done', 'fight must terminate');
    assert.ok(session.winner, 'a winner must be recorded');
    const raider = session.actors.find(a => a.id === 'sq-0')!;
    assert.ok(raider.hp < raider.maxHp, 'the AI Anbu must have dealt damage to the idle raider');
});
