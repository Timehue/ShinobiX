import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyEarnedRelicRoll, relicRewardRoll, relicDropPool, relicForDropRoll, type RelicRollProof } from './_relic-rewards.js';
import { budgetItemBonuses } from './_item-budget.js';

const NOW = Date.UTC(2026, 9, 2, 12);
const proof: RelicRollProof = { kind: 'pvp', id: 'server-match-1', opponent: 'bob', eventAt: NOW, level: 100 };
const fresh = () => ({ inventory: [], fateShards: 0 });

test('public match IDs cannot reproduce the server-private relic roll', () => {
    const proofs = Array.from({ length: 32 }, (_, i) => ({ ...proof, id: `chosen-public-id-${i}` }));
    const publicRolls = proofs.map(p => createHash('sha256').update(`relic-v1:${p.kind}:${p.id}:alice`).digest().readUInt32BE(0) / 0x1_0000_0000);
    const privateRolls = proofs.map(p => relicRewardRoll(p, 'alice'));
    assert.notDeepEqual(privateRolls, publicRolls);
    assert.deepEqual(privateRolls, proofs.map(p => relicRewardRoll(p, 'alice')));
    assert.ok(privateRolls.every(roll => roll >= 0 && roll < 1));
});

test('authored items cannot smuggle specialist percentages through the flat-stat budget', () => {
    const item = budgetItemBonuses({ slot: 'relic', bonuses: { pveFireDamagePercent: 400, pveNinjutsuDamagePercent: 999, ninjutsuOffense: 100 } });
    assert.deepEqual(item.bonuses, { pveFireDamagePercent: 10, pveNinjutsuDamagePercent: 10, ninjutsuOffense: 100 });
});

test('winning and losing rolls both seal an outcome; retry never rerolls', () => {
    const first = applyEarnedRelicRoll(fresh(), proof, 0, NOW);
    assert.equal(first.outcome.itemId, 'relic-duelists-red-cord');
    const replay = applyEarnedRelicRoll(first.character, proof, 0.011, NOW);
    assert.equal(replay.changed, false);
    assert.equal(replay.outcome.itemId, first.outcome.itemId);
    const miss = applyEarnedRelicRoll(fresh(), proof, 0.99, NOW);
    assert.equal(applyEarnedRelicRoll(miss.character, proof, 0, NOW).outcome.itemId, undefined);
    assert.equal(relicRewardRoll(proof, 'alice'), relicRewardRoll(proof, 'alice'));
});

test('ranked farming is bounded to ten wins over distinct opponents each UTC day', () => {
    let character: Record<string, unknown> = fresh();
    for (let n = 0; n < 10; n++) character = applyEarnedRelicRoll(character, { ...proof, id: `match-${n}`, opponent: `opponent-${n}` }, 0.99, NOW).character;
    assert.equal(applyEarnedRelicRoll(character, { ...proof, id: 'extra' }, 0, NOW).outcome.reason, 'daily-cap');
    const first = applyEarnedRelicRoll(fresh(), proof, 0.99, NOW);
    assert.equal(applyEarnedRelicRoll(first.character, { ...proof, id: 'repeat' }, 0, NOW).outcome.reason, 'repeat-opponent');
});

test('tower roll requires both a late floor and the sealed player level', () => {
    const tower = { ...proof, kind: 'tower' as const, floor: 15, level: 69 };
    assert.equal(applyEarnedRelicRoll(fresh(), tower, 0, NOW).outcome.reason, 'below-relic-tier');
    assert.equal(applyEarnedRelicRoll(fresh(), { ...tower, level: 100, floor: 9 }, 0, NOW).outcome.reason, 'below-relic-tier');
    assert.equal(applyEarnedRelicRoll(fresh(), { ...tower, level: 70, floor: 10 }, 0, NOW).outcome.itemId, 'relic-skybreak-prism');
    assert.equal(applyEarnedRelicRoll(fresh(), { ...tower, level: 100 }, 0.023, NOW).outcome.itemId, 'relic-zenith-lotus');
    let character: Record<string, unknown> = fresh();
    for (let n = 0; n < 5; n++) character = applyEarnedRelicRoll(character, { ...tower, level: 100, id: `run-${n}` }, 0.99, NOW).character;
    assert.equal(applyEarnedRelicRoll(character, { ...tower, level: 100, id: 'extra' }, 0, NOW).outcome.reason, 'daily-cap');
});

test('all four offenses have equal top damage, levels and odds in every endgame source', () => {
    const ids = ['relic-duelists-red-cord', 'relic-mirror-mask-shard', 'relic-conquerors-war-seal', 'relic-fivefold-chakra-seal'];
    const schools = ['Bukijutsu', 'Genjutsu', 'Taijutsu', 'Ninjutsu'];
    for (const [kind, chance] of [['pvp', 0.00025], ['tower', 0.002], ['war-crate', 0.001]] as const) {
        const pool = relicDropPool(kind, 100, 15);
        const top = pool.filter(entry => ids.includes(entry.item.id));
        assert.deepEqual(top.map(entry => entry.item.id), ids);
        for (const [i, entry] of top.entries()) {
            assert.deepEqual(entry.item.bonuses, { [`pve${schools[i]}DamagePercent`]: 14 });
            assert.equal(entry.item.levelReq, 100);
            assert.equal(entry.item.tier, 6);
            assert.equal(entry.chance, chance);
        }
        assert.ok(!relicDropPool(kind, 99, 15).some(entry => ids.includes(entry.item.id)));
        let start = 0;
        for (const entry of pool) {
            assert.equal(relicForDropRoll(pool, start + entry.chance / 2), entry.item.id);
            start += entry.chance;
        }
        assert.equal(relicForDropRoll(pool, start), undefined, 'no payout beyond the configured band');
        for (const roll of [-1, 1, NaN, Infinity]) assert.equal(relicForDropRoll(pool, roll), undefined);
    }
    assert.ok(!relicDropPool('tower', 100, 14).some(entry => ids.includes(entry.item.id)));
    assert.equal(relicDropPool('pvp', 99).length, 0);
    assert.equal(relicDropPool('war-crate', 99).length, 0);
});

test('equipped duplicates pay shards exactly once and old proofs cannot outlive receipts', () => {
    const first = applyEarnedRelicRoll({ ...fresh(), equipment: { relic: 'relic-duelists-red-cord' } }, proof, 0, NOW);
    assert.equal(first.character.fateShards, 15);
    assert.deepEqual(first.character.inventory, []);
    assert.equal(applyEarnedRelicRoll(first.character, proof, 0, NOW + 86_400_000).character.fateShards, 15);
    assert.equal(applyEarnedRelicRoll(fresh(), proof, 0, NOW + 3 * 86_400_000).outcome.reason, 'expired-or-invalid-proof');
});
