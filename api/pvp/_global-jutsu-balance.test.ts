import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JUTSU_CATALOG } from './_jutsu-catalog.js';
import { CANONICAL_TAG_NAMES, REQUIRES_DAMAGE_TAGS } from './_tags.js';

const global = Object.values(JUTSU_CATALOG).filter(j => j.id.startsWith('starter-') && j.element !== 'None');

test('each element and discipline has the same action and resource budget', () => {
    for (const element of ['earth', 'wind', 'lightning', 'fire', 'water']) {
        for (const discipline of ['nin', 'gen', 'tai', 'buki']) {
            const kit = global.filter(j => j.id.startsWith(`starter-${discipline}-${element}-`));
            assert.equal(kit.length, 5);
            assert.equal(kit.filter(j => j.effectPower > 0).length, 2);
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

test('the same area-effect rider has the same potency across offense disciplines', () => {
    const potency = new Map<string, number | undefined>();
    for (const j of global.filter(j => j.method === 'AOE_BURST')) {
        assert.equal(j.tags.length, 1, j.id);
        const tag = j.tags[0];
        if (potency.has(tag.name)) assert.equal(tag.percent, potency.get(tag.name), `${j.id}: unequal ${tag.name} budget`);
        else potency.set(tag.name, tag.percent);
    }
});
