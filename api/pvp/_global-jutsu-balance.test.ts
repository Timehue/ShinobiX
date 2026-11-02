import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { CANONICAL_TAG_NAMES, REQUIRES_DAMAGE_TAGS } from './_tags.js';

const global = Object.values(JUTSU_CATALOG).filter(j => j.id.startsWith('starter-') && j.element !== 'None');

test('each element and discipline has the same action and resource budget', () => {
    for (const element of ['earth', 'wind', 'lightning', 'fire', 'water']) {
        for (const discipline of ['nin', 'gen', 'tai', 'buki']) {
            const kit = global.filter(j => j.id.startsWith(`starter-${discipline}-${element}-`));
            assert.equal(kit.length, 7);
            assert.equal(kit.filter(j => j.effectPower > 0).length, 4);
            assert.equal(kit.filter(j => j.method === 'AOE_BURST').length, 1);
            for (const j of kit) {
                const damage = j.effectPower > 0;
                assert.equal(j.ap, damage ? 60 : 40, j.id);
                assert.equal(j.effectPower, damage ? 36 : 0, j.id);
                assert.equal(j.cooldown, 7, j.id);
                assert.equal(j.chakraCost, damage ? 250 : 125, j.id);
                assert.equal(j.staminaCost, j.chakraCost, j.id);
                for (const tag of j.tags) {
                    assert.ok(CANONICAL_TAG_NAMES.includes(tag.name), `${j.id}: ${tag.name}`);
                    assert.ok(damage || !REQUIRES_DAMAGE_TAGS.has(tag.name), `${j.id} has a damage-dependent utility tag`);
                }
            }
        }
    }
});

test('global roster adds forty attacks and one shared utility per element without overlapping original families', () => {
    assert.equal(global.length, 145);
    assert.equal(Object.values(JUTSU_CATALOG).filter(j => j.id.startsWith('starter-')).length, 146);
    const additions = global.filter(j => /-[56]$/.test(j.id) || j.id.startsWith('starter-any-'));
    assert.equal(additions.filter(j => j.ap === 60).length, 40);
    assert.equal(additions.filter(j => j.ap === 40).length, 5);
    for (const element of ['earth', 'wind', 'lightning', 'fire', 'water']) {
        const elemental = global.filter(j => j.element.toLowerCase() === element);
        assert.equal(elemental.length, 29);
        assert.equal(elemental.filter(j => j.ap === 60).length, 16);
        assert.equal(elemental.filter(j => j.ap === 40 && j.type === 'Any').length, 13);
        const utility = JUTSU_CATALOG[`starter-any-${element}-1`];
        assert.equal(utility.ap, 40);
        assert.equal(utility.effectPower, 0);
        assert.equal(utility.range, 4);
        assert.equal(utility.cooldown, 7);
        assert.equal(utility.chakraCost, 125);
        assert.equal(utility.staminaCost, 125);
        assert.equal(utility.method, 'SINGLE');
        assert.equal(utility.target, element === 'wind' || element === 'lightning' ? 'SELF' : 'OPPONENT');
        const signature = (tags: typeof utility.tags) => tags.map(t => t.name).sort().join('|');
        assert.equal(elemental.filter(j => j.ap === 40 && signature(j.tags) === signature(utility.tags)).length, 1);
        assert.ok(utility.tags.every(t => CANONICAL_TAG_NAMES.includes(t.name) && !REQUIRES_DAMAGE_TAGS.has(t.name)));
        const missingTag = ({ earth: 'Poison', wind: 'Lifesteal', fire: 'Drain', water: 'Poison' } as Record<string, string>)[element];
        if (missingTag) {
            assert.ok(utility.tags.some(t => t.name === missingTag), `${element}: fills the missing ${missingTag} utility`);
            assert.ok(elemental.filter(j => j.ap === 40 && j.id !== utility.id).every(j => !j.tags.some(t => t.name === missingTag)));
        } else {
            assert.equal(signature(utility.tags), ['Shield', 'Decrease Damage Taken'].sort().join('|'));
        }
        for (const discipline of ['nin', 'gen', 'tai', 'buki']) {
            const prefix = `starter-${discipline}-${element}-`;
            const original = ['1', '2', '3', '4', 'aoe'].map(suffix => JUTSU_CATALOG[prefix + suffix]);
            const occupied = new Set(original.flatMap(j => j.tags.map(t => t.name)));
            const attacks = ['5', '6'].map(suffix => JUTSU_CATALOG[prefix + suffix]);
            assert.notEqual(attacks[0].tags[0].name, attacks[1].tags[0].name);
            for (const attack of attacks) {
                assert.equal(attack.tags.length, 1);
                assert.equal(attack.method, 'SINGLE');
                assert.equal(attack.target, 'OPPONENT');
                assert.equal(attack.range, 4);
                assert.ok(!occupied.has(attack.tags[0].name), `${attack.id} repeats an original family rider`);
                assert.equal(attack.tags[0].percent, attack.tags[0].name === 'Poison' ? 10 : attack.tags[0].name === 'Drain' ? 0 : 30);
            }
        }
    }
});

test('the same area-effect rider has the same potency across offense disciplines', () => {
    const potency = new Map<string, number | undefined>();
    for (const j of global.filter(j => j.method === 'AOE_BURST')) {
        assert.equal(j.tags.length, 1, j.id);
        const tag = j.tags[0];
        if (potency.has(tag.name)) assert.equal(tag.percent, potency.get(tag.name), `${j.id}: unequal ${tag.name} budget`);
        else potency.set(tag.name, tag.percent);
    }
});
