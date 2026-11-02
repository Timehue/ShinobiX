import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Character } from '../types/character';
import { starterJutsus } from './jutsu';
import { getPvpJutsuLoadout } from '../lib/jutsu-loadout';
import { canEquipElementJutsu } from '../lib/bloodline';
import { v2JutsuCosts, v2JutsuResourceCost } from '../lib/jutsu-scaling';
import { getJutsuSelectOptions } from '../lib/jutsu-options';
import { jutsuEffectInfo } from '../lib/jutsu-effects';
import { COMBAT_VFX_REGISTRY, resolveCombatVfxSpec } from '../lib/combat-vfx';

const additions = starterJutsus.filter(j => /^starter-(?:nin|gen|tai|buki)-[a-z]+-[56]$/.test(j.id) || j.id.startsWith('starter-any-'));

test('new global options keep elemental access, shared utilities and one-bar resource routing', () => {
    assert.equal(additions.length, 45);
    for (const jutsu of additions) {
        for (const specialty of ['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu'] as const) {
            const owner = { name: 'element-owner', level: 100, specialty, elements: [jutsu.element], element: jutsu.element } as Character;
            assert.equal(canEquipElementJutsu(owner, jutsu, []), true);
            assert.equal(canEquipElementJutsu({ ...owner, elements: [], element: 'None' }, jutsu, []), false);
            if (jutsu.ap === 40) assert.equal(jutsu.type, 'Any');
            for (const level of [10, 50, 100]) {
                const costs = v2JutsuCosts(jutsu, level, specialty);
                const discipline = jutsu.type === 'Any' ? specialty : jutsu.type;
                const chakra = discipline === 'Ninjutsu' || discipline === 'Genjutsu';
                assert.equal(costs.chakraCost, chakra ? v2JutsuResourceCost(jutsu.ap, level) : 0);
                assert.equal(costs.staminaCost, chakra ? 0 : v2JutsuResourceCost(jutsu.ap, level));
            }
        }
    }
});

test('new jutsu preserve equipped order and resolve after save/reload without automatic equipment', () => {
    const ids = ['starter-buki-wind-6', 'starter-any-wind-1', 'starter-buki-wind-5'];
    const saved = { name: 'saved-loadout', element: 'Wind', elements: ['Wind'], specialty: 'Bukijutsu',
        equippedJutsuIds: ids, jutsuMastery: ids.map(jutsuId => ({ jutsuId, level: 1, xp: 0 })) } as Character;
    const loaded = JSON.parse(JSON.stringify(saved)) as Character;
    const loadout = getPvpJutsuLoadout([], [], loaded);
    assert.deepEqual(loadout.map(j => j.id), ids);
    assert.ok(loadout.every(j => j.image === `/jutsu/global/${j.id}.avif`));
    assert.equal(getPvpJutsuLoadout([], [], { ...loaded, equippedJutsuIds: [] }).length, 0);
    const styles = ['nin', 'tai', 'gen', 'buki'];
    const elements = ['earth', 'wind', 'lightning', 'fire', 'water'];
    const historicalOrder = [
        ...styles.flatMap(style => elements.flatMap(element => [1, 2, 3].map(n => `starter-${style}-${element}-${n}`))),
        ...styles.flatMap(style => elements.map(element => `starter-${style}-${element}-4`)),
        ...styles.flatMap(style => elements.map(element => `starter-${style}-${element}-aoe`)),
        'starter-universal-flicker',
    ];
    assert.deepEqual(starterJutsus.slice(0, 101).map(j => j.id), historicalOrder,
        'new options must not displace the original starter ordering');
    assert.ok(additions.every(j => j.description.length > 30 && j.battleDescription.length > 30));
});

test('all new jutsu reach elemental menus, explicit effect descriptions and registered combat visuals', () => {
    for (const jutsu of additions) {
        const menu = getJutsuSelectOptions(starterJutsus, jutsu.type, jutsu.element, 'effect');
        assert.ok(menu.some(entry => entry.id === jutsu.id), `${jutsu.id}: visible under its type and element`);
        assert.ok(menu.every(entry => entry.element === jutsu.element), `${jutsu.id}: element filter stays exact`);
        assert.ok(menu.every(entry => entry.type === jutsu.type || entry.type === 'Any'),
            `${jutsu.id}: offense filter permits shared utilities but excludes other offenses`);
        for (const tag of jutsu.tags) {
            const info = jutsuEffectInfo(jutsu, tag);
            assert.notEqual(info.rule, 'Custom effect tag.', `${jutsu.id}/${tag.name}: explicit effect rule`);
            assert.notEqual(info.duration, 'Varies', `${jutsu.id}/${tag.name}: explicit activation timing`);
        }
        const visual = resolveCombatVfxSpec({ ...jutsu, action: 'jutsu', discipline: jutsu.type, isUtility: jutsu.ap === 40 });
        assert.ok(COMBAT_VFX_REGISTRY[visual.key], `${jutsu.id}: shipped visual fallback`);
        if (jutsu.ap === 60) {
            assert.equal(visual.key, `${jutsu.element.toLowerCase()}60`);
            assert.equal(visual.target, 'target');
        } else {
            assert.equal(visual.target, jutsu.target === 'SELF' ? 'caster' : 'target');
        }
    }
});
