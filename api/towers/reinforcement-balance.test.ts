import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTowerEncounter } from './_encounter.js';
import { getFloor } from './_floor-catalog.js';
import { applyAction } from './_engine.js';
import { applyTowerRouteChoice } from './_route-choice.js';
import { sealPveAiMastery } from '../_pve-ai-mastery.js';
import { pveAiMasteryForLevel } from '../_pve-difficulty.js';
import type { TowerActor } from './_tower-session.js';

const build = (floorId: number, partySize = 4, legacy = false) => {
    const floor = structuredClone(getFloor(floorId)!);
    if (legacy) { delete floor.squadBalance; delete floor.recommendedLevel; }
    return buildTowerEncounter({
    floor, partySize, runId: 'reinforcement-audit', seed: 101, now: 0,
    squad: Array.from({ length: partySize }, (_, index) => ({
        id: `sq-${index}`, name: `Player ${index}`, ownerSlug: `player-${index}`, ai: false,
        character: { level: 100, maxHp: 10000, maxChakra: 10000, maxStamina: 10000,
            specialty: 'Taijutsu', stats: { taijutsuOffense: 2000, strength: 2000, speed: 2000 } },
    })),
    });
};

function assertMastery(actor: TowerActor) {
    const jutsu = actor.character.jutsu as Array<{ id: string }>;
    assert.ok(jutsu.length, 'the regression must exercise a real damaging kit');
    assert.deepEqual(actor.character.jutsuMastery, jutsu.map(entry => ({
        jutsuId: entry.id, level: pveAiMasteryForLevel(Number(actor.character.level)),
    })));
}

test('Story delayed waves receive the same level-derived mastery as opening enemies', () => {
    const session = build(4);
    const delayed = session.pendingEnemyWaves!.flatMap(wave => wave.actors);
    assert.ok(delayed.length, 'the floor must actually contain delayed enemies');
    sealPveAiMastery(session, { mode: 'TOWER', env: {} });
    for (const actor of [...session.actors, ...delayed].filter(actor => actor.side === 'enemy')) assertMastery(actor);
    const sealed = structuredClone(session);
    assert.equal(sealPveAiMastery(session, { mode: 'TOWER', env: {} }), 0);
    assert.deepEqual(session, sealed, 'retrying launch setup must not ratchet mastery');
});

test('Elite Shortcut phase summons inherit its HP/damage and sealed mastery exactly once', () => {
    for (const floorId of [9, 15]) {
        const floor = getFloor(floorId)!;
        const session = build(floorId);
        const boss = session.actors.find(actor => actor.id === 'boss')!;
        const beforeTemplate = structuredClone(boss.character.summonTemplate) as { hp: number };
        applyTowerRouteChoice(session, 'elite-shortcut');
        sealPveAiMastery(session, { mode: 'TOWER', env: {} });
        // Drive the real phase transition after the opening guard line falls.
        for (const actor of session.actors.filter(actor => actor.side === 'enemy' && actor !== boss)) actor.hp = 0;
        session.pendingEnemyWaves = [];
        boss.hp = Math.floor(boss.maxHp * floor.boss!.phases![0]! / 100) + 1;
        boss.pos = 1; boss.shield = 0;
        session.actors[0]!.pos = 0;
        session.map.blockedTiles = []; session.map.features = []; session.map.boardObjects = [];
        session.round = 1; session.activeIndex = 0; session.activeAp = 100; session.actionsThisTurn = 0;
        session.turnQueue = ['sq-0'];
        const result = applyAction(session, floor, { actorId: 'sq-0', type: 'attack', targetId: 'boss' }, () => .5);
        assert.ok(result.applied, JSON.stringify(result));
        const adds = [...session.actors, ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)]
            .filter(actor => actor.id.startsWith('add-'));
        assert.equal(adds.length, floor.boss!.summonCount);
        for (const add of adds) {
            assert.equal(add.maxHp, Math.ceil(beforeTemplate.hp * 1.18), `F${floorId}: route HP must reach spawned adds`);
            assert.equal(add.character.towerDmgScale, 1.1, `F${floorId}: route damage must reach spawned adds`);
            assertMastery(add);
        }
        const sealed = structuredClone(session);
        applyTowerRouteChoice(session, 'elite-shortcut');
        assert.deepEqual(session, sealed, 'a route retry cannot boost existing or future actors twice');
    }
});

test('Tower mastery rollback leaves delayed waves and future summon templates unsealed', () => {
    for (const floorId of [4, 9, 15]) {
        const session = build(floorId);
        const before = structuredClone(session);
        assert.equal(sealPveAiMastery(session, { mode: 'TOWER', env: { DISABLE_PVE_AI_MASTERY_TOWER: '1' } }), 0);
        assert.deepEqual(session, before);
    }
});

test('Elite Shortcut preserves legacy summon HP scaling independently from its damage bonus', () => {
    const floor = structuredClone(getFloor(9)!);
    delete floor.squadBalance; delete floor.recommendedLevel;
    const session = build(9, 2, true);
    const boss = session.actors.find(actor => actor.id === 'boss')!;
    const templateHp = (boss.character.summonTemplate as { hp: number }).hp;
    const partyScale = Number(boss.character.towerDmgScale);
    assert.ok(partyScale > 0 && partyScale < 1, 'exercise a genuinely discounted legacy party');
    applyTowerRouteChoice(session, 'elite-shortcut');
    for (const actor of session.actors.filter(actor => actor.side === 'enemy' && actor !== boss)) actor.hp = 0;
    boss.hp = Math.floor(boss.maxHp * .66) + 1; boss.pos = 1; boss.shield = 0;
    session.actors[0]!.pos = 0; session.map.blockedTiles = []; session.map.features = []; session.map.boardObjects = [];
    session.round = 1; session.turnQueue = ['sq-0']; session.activeIndex = 0; session.activeAp = 100;
    assert.ok(applyAction(session, floor, { actorId: 'sq-0', type: 'attack', targetId: 'boss' }, () => .5).applied);
    const adds = session.actors.filter(actor => actor.id.startsWith('add-'));
    assert.equal(adds.length, 3);
    for (const add of adds) {
        assert.equal(add.maxHp, Math.round(Math.ceil(templateHp * 1.18) * partyScale));
        assert.equal(add.character.towerDmgScale, partyScale * 1.1);
    }
});
