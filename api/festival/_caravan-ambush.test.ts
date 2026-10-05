import assert from 'node:assert/strict';
import test from 'node:test';
import { ambushFloor } from './_caravan-combat.js';
import { buildTowerEncounter } from '../towers/_encounter.js';

const caravanRun = {
    day: '2026-10-01', seed: 18842, contract: { difficulty: 2, title: 'Twilight Shipment' },
    combat: { nodeId: 'node-4' },
} as Parameters<typeof ambushFloor>[0];

test('daily caravan ambush deterministically seals three to five distinct Tower enemies', () => {
    const first = ambushFloor(caravanRun, null, 42);
    const replay = ambushFloor(caravanRun, null, 42);
    assert.deepEqual(first.floor, replay.floor);
    assert.deepEqual(first.templates, replay.templates);
    const count = first.floor.enemies.reduce((sum, pod) => sum + pod.count, 0);
    assert.ok(count >= 3 && count <= 5, `expected 3–5 enemies, got ${count}`);
    assert.equal(Object.keys(first.templates).length, count);
    assert.equal(first.floor.objective, 'defeat-all');

    const session = buildTowerEncounter({
        floor: first.floor,
        squad: [{ id: 'sq-0', name: 'Test Shinobi', ownerSlug: 'test', ai: false,
            character: { level: 42, maxHp: 1200, maxChakra: 300, maxStamina: 300, specialty: 'Taijutsu', stats: {} } }],
        runId: 'caravan-tower:test:node-4', seed: 821, partySize: 1, now: 1_800_000_000_000,
        towerId: 'sunscar-caravan-ambush', embedFloor: true, enemyTemplates: first.templates,
    });
    assert.equal(session.actors.filter(actor => actor.side === 'enemy').length, count);
    assert.equal(session.actors.filter(actor => actor.side === 'squad' && actor.ai === false).length, 1);
    assert.equal(new Set(session.actors.filter(actor => actor.side === 'enemy').map(actor => actor.character.combatRole)).size, count,
        'each attacker should bring a distinct tactical role');
});
