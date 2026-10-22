import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMercCharacter, resolveMercBattle } from './_merc-fighters.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../combat-core/formulas.js';
import { maxHpForLevel, maxChakraForLevel, maxStaminaForLevel } from '../_xp-engine.js';
import { v2JutsuCosts } from '../_combat-resources.js';
import { effectiveItemLevelReq } from '../../shared/item-level-gate.js';
import { closeFightSave, closeFixtureAudit } from '../../scripts/pve-close-fights-benchmark.js';
import { sealTowerFighter } from './_seal.js';
import { probeWarMercenary } from '../../scripts/war-mercenary-pressure-benchmark.js';

const NOW = 1_700_000_000_000;

test('all five hired war tiers use legal catalog curricula, mastery, pools and one gear bonus', () => {
    for (const level of [75, 80, 85, 95, 100]) {
        const c = buildMercCharacter(level) as Record<string, any>;
        assert.equal(c.level, level);
        assert.equal(c.stats.strength, statCapForLevel(level));
        assert.equal(c.jutsu.length, level >= 95 ? 12 : level >= 85 ? 11 : level >= 80 ? 10 : 9);
        assert.deepEqual(c.elements, ['Earth', 'Wind']);
        assert.equal(c.maxHp, maxHpForLevel(level));
        assert.equal(c.maxChakra, maxChakraForLevel(level));
        assert.equal(c.maxStamina, maxStaminaForLevel(level));
        assert.equal(c.bloodlineMult, 1);
        assert.equal(c.itemDamagePct, 0);
        for (const j of c.jutsu) {
            const catalog = JUTSU_CATALOG[j.id];
            assert.ok(catalog);
            assert.ok(['Earth', 'Wind', 'None'].includes(j.element));
            for (const key of ['effectPower', 'ap', 'range', 'cooldown', 'target', 'method', 'tags']) assert.deepEqual(j[key], catalog[key as keyof typeof catalog]);
            assert.deepEqual({ chakraCost: j.chakraCost, staminaCost: j.staminaCost }, v2JutsuCosts(catalog, level, 'Taijutsu'));
            assert.equal(c.jutsuMastery.find((m: any) => m.jutsuId === j.id).level, jutsuLevelCapForLevel(level));
        }
        const weapon = c.pvpItems[0];
        assert.deepEqual(weapon, ITEM_CATALOG[c.equipment.hand]);
        assert.ok(effectiveItemLevelReq(weapon) <= level);
        for (const [key, bonus] of Object.entries(weapon.bonuses ?? {})) assert.equal(c.stats[key], statCapForLevel(level) + Number(bonus));
    }
});

test('headless resolution remains deterministic with a real legal prepared defender', () => {
    const save = closeFightSave(100, 'stress');
    assert.equal(closeFixtureAudit(100, 'stress').legal, true);
    const sealed = sealTowerFighter(save.character, save as unknown as Record<string, unknown>, {}, null);
    const args = { playerName: 'offline', playerSlug: 'offline', playerSealedChar: sealed, mercLevel: 100, seed: 7, now: NOW };
    const a = resolveMercBattle(args), b = resolveMercBattle(args);
    assert.deepEqual(a, b);
    assert.ok(a.rounds > 0 && a.rounds <= 26);
    assert.match(a.log[0], /Wound.*Absorb.*automatically/);
    const observed = probeWarMercenary(buildMercCharacter(100), sealed, 7);
    assert.equal(observed.winner, a.winner, 'instrumented evidence uses the production outcome');
    assert.equal(observed.rounds, a.rounds);
    assert.equal(observed.metrics[0].finalHp, a.vitals?.player.hp);
    assert.equal(observed.metrics[1].finalHp, a.vitals?.merc.hp);
});

test('only the hired NPC policy uses its catalog weapon; the player snapshot is unchanged', () => {
    const save = closeFightSave(100, 'stress');
    const sealed = sealTowerFighter(save.character, save as unknown as Record<string, unknown>, {}, null);
    const prior = structuredClone(sealed);
    const result = probeWarMercenary(buildMercCharacter(100), sealed, 1);
    assert.ok(result.actions.some(a => a.actor === 'merc-0' && a.type === 'weapon' && a.applied));
    assert.ok(!result.actions.some(a => a.actor === 'sq-0' && a.type === 'weapon'), 'human snapshot retains existing auto policy');
    const markedHuman = { ...sealed, warMercenaryProfile: { classification: 'special-npc' } };
    const spoofed = probeWarMercenary(buildMercCharacter(100), markedHuman, 1);
    assert.ok(!spoofed.actions.some(a => a.actor === 'sq-0' && a.type === 'weapon'), 'a saved human marker cannot grant NPC policy');
    assert.deepEqual(sealed, prior, 'simulation never mutates the stored/sealed input');
    const rounds = new Set(result.actions.filter(a => a.actor === 'merc-0' && a.type === 'weapon' && a.applied).map(a => a.round));
    assert.ok(result.actions.some(a => a.actor === 'merc-0' && a.type === 'jutsu' && a.applied && rounds.has(a.round)), 'a weapon and legal jutsu share a turn');
    const clone = buildMercCharacter(100);
    delete clone.warMercenaryProfile;
    const legacyPolicy = probeWarMercenary(clone, sealed, 1);
    assert.ok(!legacyPolicy.actions.some(a => a.actor === 'merc-0' && a.type === 'weapon'), 'no global enemy/PvP AI change');
});
