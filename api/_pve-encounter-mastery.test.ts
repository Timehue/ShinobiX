import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pveAiMasteryForEncounter } from './_pve-ai-mastery.js';
import { pveAiMasteryForLevel } from './_pve-difficulty.js';
import { jutsuLevelCapForLevel, masteryDamageFrac, directDamageBaseFormula } from './combat-core/formulas.js';
import { jutsuRyoTrainingCap, jutsuSealTrainingCap } from './training/_jutsu-ryo.js';
import { buildSoloPveAiEncounter } from './solo-pve/_ai-encounter.js';
import { progressiveOrdinaryAiJutsuIds, resolveAiProfileJutsu } from './_ai-opponent-loadout.js';
import { JUTSU_CATALOG } from './pvp/_jutsu-catalog.js';

test('ordinary NPC mastery follows player ryo, Seal, battle and rank ceilings', () => {
    for (let level = 1; level <= 100; level++) {
        const standard = pveAiMasteryForEncounter(level, 'standard');
        assert.equal(standard, Math.min(level, jutsuRyoTrainingCap(level)));
        assert.equal(pveAiMasteryForEncounter(level, 'weaker'), Math.floor(standard * 0.7));
        assert.equal(pveAiMasteryForEncounter(level, 'dangerous'), jutsuSealTrainingCap(level));
        assert.equal(pveAiMasteryForEncounter(level, 'elite'), jutsuLevelCapForLevel(level));
        assert.equal(pveAiMasteryForEncounter(level, 'final-kage'), jutsuLevelCapForLevel(level));
        assert.equal(pveAiMasteryForEncounter(level, undefined), pveAiMasteryForLevel(level), 'unclassified hosts retain historical mastery');
    }
    assert.deepEqual([10, 25, 50, 75, 100].map(l => pveAiMasteryForEncounter(l, 'standard')), [10, 20, 30, 30, 30]);
    assert.deepEqual([10, 25, 50, 75, 100].map(l => pveAiMasteryForEncounter(l, 'dangerous')), [10, 20, 40, 40, 40]);
});

test('NPC damage uses the shared effective EP once, and setup remains zero damage', () => {
    const stats = { strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500, ninjutsuOffense: 2500, ninjutsuDefense: 2500 };
    const base = { attackerStats: stats, defenderStats: stats, attackerCharacter: {}, defenderCharacter: {} };
    for (const masteryLevel of [10, 20, 30, 40, 50]) {
        const damage = directDamageBaseFormula({ ...base, masteryLevel, jutsu: { id: 'catalog-damage', type: 'Ninjutsu', ap: 60, effectPower: 36 } });
        assert.equal(damage.baseDmg, Math.floor(46 * masteryDamageFrac(masteryLevel) * 32));
        const setup = directDamageBaseFormula({ ...base, masteryLevel, jutsu: { id: 'catalog-setup', type: 'Ninjutsu', ap: 40, effectPower: 36 } });
        assert.equal(setup.baseDmg, 0);
    }
});

test('builder seals tier mastery, difficulty and safe identity art for this encounter', () => {
    const build = (difficulty: string) => buildSoloPveAiEncounter({ sessionId: difficulty, playerName: 'a', now: 1, admin: null,
        save: { character: { name: 'A', level: 100, stats: {}, hp: 10000, maxHp: 10000, equipment: {} } },
        profile: { id: 'npc', name: 'NPC', level: 100, pveDifficulty: difficulty, avatarImage: '/portraits/npc.webp',
            jutsu: [{ id: 'hit', name: 'Hit', type: 'Ninjutsu', ap: 60, effectPower: 36, cooldown: 7 }] },
    });
    const standard = build('standard'), elite = build('elite');
    assert.deepEqual(standard.enemy.character.jutsuMastery, [{ jutsuId: 'hit', level: 30 }]);
    assert.deepEqual(elite.enemy.character.jutsuMastery, [{ jutsuId: 'hit', level: 50 }]);
    assert.equal(standard.enemy.character.avatarImage, '/portraits/npc.webp');
    assert.equal(standard.enemy.character.pveDifficulty, 'standard');
    assert.equal(standard.enemy.maxHp, elite.enemy.maxHp, 'mastery adds no HP');
});

test('ordinary progressive kits learn damaging rotations without inflating shared jutsu', () => {
    for (const id of ['builtin-ai-rogue-ninja', 'builtin-ai-ember-duelist', 'builtin-ai-shadow-weaver', 'builtin-ai-frost-sealer', 'builtin-ai-mist-sentinel']) {
        assert.equal(progressiveOrdinaryAiJutsuIds(id, 35, 'elite'), null, 'early authored kit stays intact');
        assert.equal(progressiveOrdinaryAiJutsuIds(id, 100, 'weaker'), null, 'weaker kits stay intact');
        assert.equal(progressiveOrdinaryAiJutsuIds(id, 100, undefined), null, 'no implicit opt in');
        const counts: number[] = [];
        for (const level of [36, 61, 86, 100]) {
            const ids = progressiveOrdinaryAiJutsuIds(id, level, 'standard')!;
            const kit = resolveAiProfileJutsu(ids);
            assert.ok(kit.length <= 8);
            assert.equal(kit.length, ids.length);
            const damaging = kit.filter(j => j.ap === 60);
            counts.push(damaging.length);
            for (const j of kit) {
                const catalog = resolveAiProfileJutsu([j.id])[0];
                assert.deepEqual(j, catalog, 'NPC uses the same sanitized/catalog resource rules as a player');
                assert.ok(JUTSU_CATALOG[j.id], 'no fabricated attack');
                if (j.ap === 60) { assert.equal(j.effectPower, 36); assert.equal(j.cooldown, 7); }
            }
        }
        assert.deepEqual(counts, [5, 5, 6, 6]);
    }
    assert.equal(progressiveOrdinaryAiJutsuIds('tsukika', 100, 'elite'), null, 'named identities are not replaced');
});
