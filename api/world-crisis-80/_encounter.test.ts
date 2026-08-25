import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { worldCrisis80EncounterForVillage } from '../../shared/world-crisis-80.js';
import { buildWorldCrisis80EnemyTemplates, buildWorldCrisis80Floor } from './_encounter.js';

describe('The Hollow Gate Reckoning combat seal', () => {
    it('authors a real one-versus-three Tower floor with escalating tactical pressure', () => {
        const encounter = worldCrisis80EncounterForVillage('Stormveil Village');
        const floor = buildWorldCrisis80Floor(encounter);

        assert.equal(floor.objective, 'defeat-all');
        assert.equal(floor.enemies.length, 3);
        assert.equal(floor.enemies.reduce((sum, stack) => sum + stack.count, 0), 3);
        assert.equal(new Set(floor.enemies.map((stack) => stack.aiId)).size, 3);
        assert.equal(floor.roundBudget, 14);
        assert.equal(floor.closingRing?.fromRound, 5);
        assert.equal(floor.dynamicHazards?.[0]?.count, 3);
        assert.match(floor.briefing?.warnings.join(' ') ?? '', /1-vs-3/i);
    });

    it('reconstructs the village triad server-side with distinct roles and focus policies', () => {
        const encounter = worldCrisis80EncounterForVillage('Moonshadow Village');
        const templates = Object.values(buildWorldCrisis80EnemyTemplates(encounter, 80, null));

        assert.equal(templates.length, 3);
        assert.deepEqual(templates.map((enemy) => enemy.name), encounter.triad.map((member) => member.name));
        assert.deepEqual(new Set(templates.map((enemy) => enemy.role)).size, 3);
        assert.deepEqual(new Set(templates.map((enemy) => enemy.targetMode)).size, 3);
        assert.ok(templates.every((enemy) => enemy.level === 82));
        assert.ok(templates.every((enemy) => enemy.hp >= 350 && (enemy.jutsu?.length ?? 0) > 0));
    });

    it('caps enemy scaling while keeping the event globally playable after awakening', () => {
        const encounter = worldCrisis80EncounterForVillage('Frostfang Village');
        const low = Object.values(buildWorldCrisis80EnemyTemplates(encounter, 12, null));
        const high = Object.values(buildWorldCrisis80EnemyTemplates(encounter, 999, null));

        assert.ok(low.every((enemy) => enemy.level === 22));
        assert.ok(high.every((enemy) => enemy.level === 100));
    });
});
