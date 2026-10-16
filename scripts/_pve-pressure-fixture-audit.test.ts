import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { pressurePlayerSave, PRESSURE_LEVELS, PRESSURE_BUILDS } from './pve-pressure-benchmark.js';
import { diagnosticPlayerSave } from './pve-viability-diagnostic.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { maxLoadout } from '../api/_entitlements.js';
import { characterMayUseJutsu } from '../api/pvp/_bloodline-gate.js';

test('all current pressure and coherent moderate-bloodline fixtures satisfy earned server constraints without repair', () => {
    for (const level of PRESSURE_LEVELS) for (const build of PRESSURE_BUILDS) {
        for (const save of [pressurePlayerSave(level, build), diagnosticPlayerSave(level, build, 'coherent', 'B')]) {
            const before = structuredClone(save), audit = auditPressureFixture(save, level);
            assert.deepEqual(audit.failures, [], `${level}/${build}`);
            assert.deepEqual(audit.acquisitionWarnings, [], `${level}/${build}: current UI natures`);
            assert.deepEqual(save, before, 'validation never rewrites fixture evidence');
            assert.equal(audit.activeLoadoutLimit, 12, 'ordinary player entitlement exceeds the bounded eight-move fixture');
            if (build === 'maxed' && level >= 50) assert.equal(audit.derivedBloodlineMult, 1.2);
            else if ((save.character as Record<string, unknown>).equippedBloodlineId) assert.equal(audit.derivedBloodlineMult, 1.1);
        }
    }
});

test('fixture validation catches owned-count, slot and effective rarity-gate mistakes', () => {
    const missing = pressurePlayerSave(100, 'midgame');
    missing.character.inventory = [];
    assert.ok(auditPressureFixture(missing, 100).failures.some(f => f.code === 'equipment-owned-count'));
    const wrongSlot = pressurePlayerSave(100, 'midgame');
    wrongSlot.character.equipment.body = wrongSlot.character.equipment.hand;
    assert.ok(auditPressureFixture(wrongSlot, 100).failures.some(f => f.code === 'equipment-kind'));
    const oldGate = pressurePlayerSave(50, 'midgame');
    (oldGate.character.equipment as Record<string, string>).feet = 'crimson-feet';
    oldGate.character.inventory.push('crimson-feet');
    assert.ok(auditPressureFixture(oldGate, 50).failures.some(f => f.code === 'equipment-level-gate'));
});

test('fixture validation catches unlearned, unknown, bloodline-gated and oversized loadouts', () => {
    const unlearned = pressurePlayerSave(100, 'midgame');
    unlearned.character.jutsuMastery = [];
    assert.ok(auditPressureFixture(unlearned, 100).failures.some(f => f.code === 'jutsu-learned'));
    const unknown = pressurePlayerSave(100, 'midgame');
    unknown.character.equippedJutsuIds[0] = 'invented-fixture-jutsu';
    assert.ok(auditPressureFixture(unknown, 100).failures.some(f => f.code === 'jutsu-source'));
    const denied = pressurePlayerSave(100, 'midgame');
    denied.character.equippedJutsuIds[0] = 'ashen-eyes-blood-gaze';
    denied.character.jutsuMastery[0] = { jutsuId: 'ashen-eyes-blood-gaze', level: 30, xp: 0 };
    assert.ok(auditPressureFixture(denied, 100).failures.some(f => f.code === 'jutsu-access'));
    const tooMany = pressurePlayerSave(100, 'midgame');
    tooMany.character.equippedJutsuIds = Object.keys(JUTSU_CATALOG).filter(id => characterMayUseJutsu(tooMany.character, tooMany, JUTSU_CATALOG[id])).slice(0, maxLoadout(tooMany.character) + 1);
    tooMany.character.jutsuMastery = tooMany.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: 30, xp: 0 }));
    assert.ok(auditPressureFixture(tooMany, 100).failures.some(f => f.code === 'loadout-cap-or-duplicate'));
});

test('server-legal off-nature basics are distinguished from current UI acquisition', () => {
    const save = pressurePlayerSave(100, 'midgame');
    save.character.elements = ['Fire', 'Water'];
    const audit = auditPressureFixture(save, 100);
    assert.equal(audit.legal, true);
    assert.ok(audit.acquisitionWarnings.some(f => f.code === 'current-ui-nature-access'));
});

test('fixture loadout validation uses the actual 12/15 account entitlement', () => {
    const save = pressurePlayerSave(100, 'midgame');
    save.character.equippedJutsuIds = Object.keys(JUTSU_CATALOG).filter(id => characterMayUseJutsu(save.character, save, JUTSU_CATALOG[id])).slice(0, 15);
    save.character.jutsuMastery = save.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: 30, xp: 0 }));
    assert.ok(auditPressureFixture(save, 100).failures.some(f => f.code === 'loadout-cap-or-duplicate'));
    (save.character as Record<string, unknown>).patreon = { active: true };
    const entitled = auditPressureFixture(save, 100);
    assert.equal(entitled.activeLoadoutLimit, 15);
    assert.equal(entitled.legal, true);
});

test('fixture validation catches rank caps, fabricated ledger/pools and mismatched bloodline rank', () => {
    const stat = pressurePlayerSave(75, 'midgame');
    stat.character.stats.ninjutsuOffense = 2500;
    assert.ok(auditPressureFixture(stat, 75).failures.some(f => f.code === 'stat-rank-cap'));
    const mastery = pressurePlayerSave(25, 'midgame');
    mastery.character.jutsuMastery[0].level = 50;
    assert.ok(auditPressureFixture(mastery, 25).failures.some(f => f.code === 'mastery-rank-cap'));
    const ledger = pressurePlayerSave(100, 'midgame');
    ledger.character.earnedStatPoints--;
    ledger.character.maxChakra++;
    ledger.character.hp = Number.NaN;
    const failures = auditPressureFixture(ledger, 100).failures.map(f => f.code);
    for (const code of ['earned-ledger', 'level-resource-pool', 'current-resource-range']) assert.ok(failures.includes(code));
    const bloodline = diagnosticPlayerSave(100, 'midgame', 'coherent', 'B');
    assert.equal(auditPressureFixture(bloodline, 100, { expectedBloodlineRank: 'B Rank', expectedMasteryCeiling: 30 }).derivedBloodlineMult, 1.1);
    assert.ok(auditPressureFixture(bloodline, 100, { expectedBloodlineRank: 'S Rank' }).failures.some(f => f.code === 'bloodline-expected-rank'));
});
