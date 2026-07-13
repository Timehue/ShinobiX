"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _stat_entitlement_js_1 = require("./_stat-entitlement.js");
const _name__js_1 = require("./[name].js");
const stats = (strength = 20, speed = 10) => ({
    strength, speed, intelligence: 10, willpower: 10,
    bukijutsuOffense: 10, bukijutsuDefense: 10,
    taijutsuOffense: 10, taijutsuDefense: 10,
    genjutsuOffense: 10, genjutsuDefense: 10,
    ninjutsuOffense: 10, ninjutsuDefense: 10,
});
(0, node_test_1.describe)('stat-point entitlement', () => {
    (0, node_test_1.it)('allows allocating stored unspent points without creating power', () => {
        const out = (0, _stat_entitlement_js_1.preserveStatPointEntitlement)({ stats: stats(25), unspentStats: 5, fateShards: 100 }, { stats: stats(20), unspentStats: 10, fateShards: 100 });
        node_assert_1.strict.equal(out.accepted, 'allocation');
        node_assert_1.strict.equal(out.stats.strength, 25);
        node_assert_1.strict.equal(out.unspentStats, 5);
    });
    (0, node_test_1.it)('allows only the paid full reset redistribution path', () => {
        const accepted = (0, _stat_entitlement_js_1.preserveStatPointEntitlement)({ stats: stats(10), unspentStats: 10, fateShards: 50 }, { stats: stats(20), unspentStats: 0, fateShards: 100 });
        node_assert_1.strict.equal(accepted.accepted, 'respec');
        const free = (0, _stat_entitlement_js_1.preserveStatPointEntitlement)({ stats: stats(10), unspentStats: 10, fateShards: 100 }, { stats: stats(20), unspentStats: 0, fateShards: 100 });
        node_assert_1.strict.equal(free.accepted, 'rejected');
        node_assert_1.strict.equal(free.stats.strength, 20);
    });
    (0, node_test_1.it)('rejects forged new points even when spread across stats and pool', () => {
        const out = (0, _stat_entitlement_js_1.preserveStatPointEntitlement)({ stats: stats(520, 510), unspentStats: 1000, fateShards: 100 }, { stats: stats(20), unspentStats: 10, fateShards: 100 });
        node_assert_1.strict.equal(out.accepted, 'rejected');
        node_assert_1.strict.deepEqual(out.stats, stats(20));
        node_assert_1.strict.equal(out.unspentStats, 10);
    });
    (0, node_test_1.it)('rejects point-moving between allocated stats without a paid full respec', () => {
        const out = (0, _stat_entitlement_js_1.preserveStatPointEntitlement)({ stats: stats(15, 15), unspentStats: 0, fateShards: 100 }, { stats: stats(20, 10), unspentStats: 0, fateShards: 100 });
        node_assert_1.strict.equal(out.accepted, 'rejected');
        node_assert_1.strict.deepEqual(out.stats, stats(20, 10));
    });
    (0, node_test_1.it)('is enforced by the real generic save sanitizer for an existing character', () => {
        const existingCharacter = { name: 'Audit', level: 10, xp: 0, ryo: 100, fateShards: 100, stats: stats(20), unspentStats: 10, totalStatsTrained: 10 };
        const out = (0, _name__js_1.sanitizeCharacterSave)({ character: { ...existingCharacter, stats: stats(520, 510), unspentStats: 1000, totalStatsTrained: 9999 } }, { character: existingCharacter });
        const character = out.character;
        node_assert_1.strict.deepEqual(character.stats, stats(20));
        node_assert_1.strict.equal(character.unspentStats, 10);
        node_assert_1.strict.equal(character.totalStatsTrained, 10);
    });
});
