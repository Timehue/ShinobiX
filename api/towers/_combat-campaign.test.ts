import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTowerEncounter } from './_encounter.js';
import { checkTowerWinner } from './_engine.js';
import { FLOOR_CATALOG, getFloor, TOWER_CATALOG_VERSION, type TowerFloor } from './_floor-catalog.js';
import { floorForSession, sealTowerCatalogFloor } from './_session-floor.js';

function encounter(floor: TowerFloor) {
    return buildTowerEncounter({ floor, runId: 'campaign-check', seed: 42, partySize: 1, now: 1000,
        squad: [{ id: 'sq-0', name: 'Rill', ownerSlug: 'rill', ai: false,
            character: { specialty: 'Taijutsu', maxHp: 12000, stats: { taijutsuOffense: 2500, taijutsuDefense: 2500, speed: 100 } } }],
    });
}

test('every newly started Story floor resolves through enemies and bosses, without escort or timer objectives', () => {
    assert.equal(TOWER_CATALOG_VERSION, 'story-tower-v5');
    const allowed = new Set(['defeat-all', 'defeat-boss', 'defeat-all-then-boss', 'kill-adds-first']);
    for (const floor of FLOOR_CATALOG) {
        assert.ok(allowed.has(floor.objective), `floor ${floor.id} is a combat objective`);
        assert.equal(floor.npc, undefined, `floor ${floor.id} has no protected NPC`);
        assert.ok(encounter(floor).actors.some(actor => actor.side === 'enemy'));
    }
});

for (const id of [4, 8, 13]) test(`floor ${id} wins by clearing all waves, with no mandatory waiting after the last enemy`, () => {
    const floor = getFloor(id)!;
    const session = encounter(floor);
    for (const actor of session.actors) if (actor.side === 'enemy') actor.hp = 0;
    assert.ok(session.pendingEnemyWaves?.length);
    checkTowerWinner(session, floor);
    assert.equal(session.status, 'active', 'future reinforcements must still be fought');
    // Model the authoritative state after every scheduled wave has been defeated.
    session.pendingEnemyWaves = [];
    session.round = 5;
    checkTowerWinner(session, floor);
    assert.equal(session.winner, 'squad');
    assert.equal(session.status, 'done');
    assert.ok(session.round < floor.roundBudget, 'score par is not a survival requirement');
});

test('the Archivist survives its final phase gate and must be defeated to clear floor 12', () => {
    const floor = getFloor(12)!;
    const session = encounter(floor);
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
    for (const actor of session.actors) if (actor.side === 'enemy' && actor !== boss) actor.hp = 0;
    session.pendingEnemyWaves = [];
    boss.hp = Math.ceil(boss.maxHp * 0.2);
    checkTowerWinner(session, floor);
    assert.equal(session.phaseState.pendingPhases.length, 0);
    assert.equal(session.status, 'active', 'crossing all phases alone must not win');
    boss.hp = 0;
    checkTowerWinner(session, floor);
    assert.equal(session.winner, 'squad');
});

test('existing sealed v3 defense and archive runs keep their original objective and rewards', () => {
    for (const [id, objective] of [[4, 'protect-npc'], [8, 'kill-escort'], [12, 'break-objective'], [13, 'protect-npc']] as const) {
        const oldFloor: TowerFloor = { ...structuredClone(getFloor(id)!), objective,
            ...(objective === 'protect-npc' || objective === 'kill-escort' ? { npc: { aiId: 'npc-genin' } } : {}),
        };
        const session = encounter(oldFloor);
        session.towerId = 'celestial';
        sealTowerCatalogFloor(session, oldFloor, 'story');
        session.floorProvenance!.contentVersion = 'story-tower-v3';
        const resolved = floorForSession(session)!;
        assert.equal(resolved.objective, objective);
        assert.deepEqual(resolved.firstClearReward, oldFloor.firstClearReward);
        assert.notEqual(resolved.objective, getFloor(id)!.objective);
    }
});
