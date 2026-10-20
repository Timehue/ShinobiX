import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unlockGroupCases, unlockGroupSession } from './narrative-group-balance-audit.js';
import { GROUP_SCHOOLS, groupBalanceSave, pilotGroup } from './test-fixtures/narrative-group-balance.js';
import { STAT_KEYS, allocatedStatPoints, earnedForLevel, maxHpForLevel } from '../api/_xp-engine.js';
import { statCapForLevel } from '../api/combat-core/formulas.js';
import { narrativeGroupFor } from '../shared/narrative-groups.js';
import { applyAction } from '../api/towers/_engine.js';
import { makeRng } from '../api/towers/_sim.js';

test('balance fixtures use legal progression budgets, ordinary gear and learned catalog techniques', () => {
    for (const level of [1, 12, 15, 35, 37, 40, 50, 52, 65]) for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const save = groupBalanceSave(level, school, focused), character = save.character;
        assert.equal(allocatedStatPoints(character.stats as never), earnedForLevel(level));
        assert.ok(STAT_KEYS.every(key => character.stats[key] <= statCapForLevel(level)));
        assert.equal(character.maxHp, maxHpForLevel(level));
        assert.ok(character.jutsuMastery.every(m => m.level <= 10));
        assert.ok(character.equippedJutsuIds.every(id => id.startsWith('starter-')));
        assert.ok(character.inventory.every(id => ['cloth-robe', 'leather-headband', 'reinforced-vest', 'padded-leggings', 'shinobi-boots', 'leather-belt'].includes(id)));
    }
});

for (const entry of unlockGroupCases) test(`${entry.key}${'wave' in entry ? ` wave ${entry.wave}` : ''}: ordinary builds in all four schools can win at level ${entry.level}`, async () => {
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const initial = await unlockGroupSession(entry, school, focused), untouched = structuredClone(initial);
        const result = pilotGroup(initial);
        assert.equal(result.outcome, 'win', `${school}/${focused ? 'focused' : 'balanced'}: ${JSON.stringify(result)}`);
        assert.ok(result.hp > 0, 'a simultaneous player KO is not counted as a healthy clear');
        if (entry.key === 'story-stormveil-65') assert.ok(result.hp <= result.maxHp * .35,
            'the level-65 boss should pressure ordinary builds rather than routinely leave over 40% HP');
        assert.equal(result.enemiesDefeated, result.enemies);
        assert.ok(result.rounds <= 30, 'no attrition timeout or endless heal loop');
        assert.deepEqual(initial, untouched, 'offline simulation must not mutate its sealed starting fixture');
        if (initial.huntCombat!.purpose === 'narrative-group') {
            const group = narrativeGroupFor(initial.encounter.sourceId!, 'wave' in entry ? `goro-wave-${entry.wave}` : undefined, initial.enemy.name)!;
            for (const enemy of initial.huntCombat!.battle.actors.filter(a => a.side === 'enemy')) assert.equal(enemy.character.towerDmgScale, group.damageScale ?? 1);
        }
    }
});

test('Goro can be cleared across all three waves without restoring health or resources between fights', async () => {
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        let vitals: { hp: number; chakra: number; stamina: number } | undefined;
        for (const entry of unlockGroupCases.filter(c => c.key === 'qb-caravan')) {
            const initial = await unlockGroupSession(entry, school, focused, vitals);
            if (vitals) assert.equal(initial.huntCombat!.battle.actors[0].hp, vitals.hp);
            const result = pilotGroup(initial);
            assert.equal(result.outcome, 'win', `${school}/${focused}: wave ${'wave' in entry ? entry.wave : 0}`);
            assert.ok(result.hp > 0);
            assert.equal(result.enemiesDefeated, result.enemies);
            vitals = { hp: result.hp, chakra: result.chakra, stamina: result.stamina };
        }
    }
});

test('formation damage is sealed on enemies only and the existing preview follows the real resolver', async () => {
    const entry = unlockGroupCases.find(c => c.key === 'story-frost-35')!;
    const initial = await unlockGroupSession(entry, 'Ninjutsu', false);
    const clientModule = '../shinobij.client/src/lib/tower-tactical-ui.js';
    const { estimateTowerActionDamage } = await import(clientModule);
    const hit = (scale: number) => {
        const battle = structuredClone(initial.huntCombat!.battle), enemy = battle.actors[1], player = battle.actors[0];
        assert.equal(player.character.towerDmgScale, undefined, 'the player never inherits formation attenuation');
        enemy.character.towerDmgScale = scale; enemy.pos = 63; player.pos = 62;
        battle.turnQueue = [enemy.id, player.id]; battle.activeIndex = 0; battle.activeAp = 100;
        const jutsu = (enemy.character.jutsu as Array<{ id: string; ap: number; effectPower: number; type: string }>).find(j => j.ap === 60)!;
        const expected = estimateTowerActionDamage({ attacker: enemy, target: player, actionId: jutsu.id, effectPower: jutsu.effectPower,
            ap: jutsu.ap, type: jutsu.type, biome: battle.map.biome, round: battle.round });
        const hp = player.hp;
        const result = applyAction(battle, battle.encounterFloor!, { type: 'jutsu', actorId: enemy.id, jutsuId: jutsu.id, targetId: player.id }, makeRng(1));
        assert.equal(result.applied, true, result.reason);
        const damage = hp - player.hp;
        assert.ok(Math.abs(damage - expected.hpDamage) <= 1, `preview ${expected.hpDamage}, actual ${damage}`);
        return damage;
    };
    const full = hit(1), group = hit(.5);
    assert.ok(full > 0); assert.ok(Math.abs(group - full * .5) <= 2);
});
