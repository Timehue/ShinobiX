import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeFightSave, closeFixtureAudit } from './pve-close-fights-benchmark.js';
import { NAMED_WEAPON_EP_MAX, NAMED_WEAPON_EP_MIN, NAMED_WEAPON_OFFENSE, NAMED_ARMOR_STATS } from '../shared/named-forge-roll.js';

test('follow-up progression fixtures conserve legal slots, resources, elements, gear and mastery', () => {
    for (const level of [17, 25, 50, 75, 100]) for (const fixture of ['trained', 'specialist', 'optimized', 'narrow']) {
        const audit = closeFixtureAudit(level, fixture);
        assert.deepEqual(audit.failures, [], `${level}/${fixture}`);
        assert.deepEqual(audit.acquisitionWarnings, []);
        assert.equal(audit.legal, true);
        assert.ok(audit.kit.length <= 12);
    }
    const rookie = closeFixtureAudit(17, 'rookie');
    assert.equal(rookie.legal, true);
    assert.equal(rookie.save.character.unspentStats, 319);
    assert.ok(rookie.save.character.jutsuMastery.every(m => m.level === 1));
});

test('sustain fixture uses current legal forge definitions, never guessed Rill customs or legacy rolls', () => {
    const audit = closeFixtureAudit(100, 'sustain');
    assert.equal(audit.legal, true);
    assert.deepEqual(audit.acquisitionWarnings, []);
    assert.equal(audit.kit.length, 12);
    const definitions = audit.ownedNamedDefinitions!;
    const blade = definitions.find(i => i.slot === 'hand')!;
    assert.ok(blade.weaponEp >= NAMED_WEAPON_EP_MIN && blade.weaponEp <= NAMED_WEAPON_EP_MAX);
    assert.ok(blade.bonuses.ninjutsuOffense >= NAMED_WEAPON_OFFENSE.min && blade.bonuses.ninjutsuOffense <= NAMED_WEAPON_OFFENSE.max);
    assert.deepEqual(blade.weaponTags.map((t: { name: string }) => t.name), ['Heal', 'Shield']);
    for (const item of definitions.filter(i => i.slot !== 'hand')) {
        assert.equal(item.levelReq, 90);
        assert.ok(item.bonuses.ninjutsuOffense >= NAMED_ARMOR_STATS.min && item.bonuses.ninjutsuOffense <= NAMED_ARMOR_STATS.max);
        assert.equal(item.bonuses.lifeStealPercent, 2);
    }
    assert.deepEqual(closeFightSave(100, 'sustain'), closeFightSave(100, 'sustain'), 'fixed fixture identities keep matched-seed comparisons deterministic');
});

test('legacy stress control has real15-slot entitlement and explicitly separated33EP gear assumption', () => {
    const audit = closeFixtureAudit(100, 'stress');
    assert.equal(audit.legal, true);
    assert.equal(audit.activeLoadoutLimit, 15);
    assert.equal(audit.kit.length, 15);
    assert.equal(audit.ownedNamedDefinitions![0].weaponEp, 33);
    assert.equal(audit.save.character.jutsuMastery.every(m => m.level === 50), true);
});
