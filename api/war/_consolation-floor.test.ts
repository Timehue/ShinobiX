import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleVillageWarRewards, type WarRewardCharacter, type WarRewardDials, type VillageWarRewardRecord } from './_reward.js';
import { applyWarCrateOpen } from '../inventory/_war-crate.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 28);
const DIALS: WarRewardDials = { purseScale: 1, winK: .3, loseK: .18, epochMs: 0, minDurationMs: 72 * HOUR };
const base = (village = 'Sand', profession = 'vanguard'): WarRewardCharacter => ({
    name: 'Kira', village, profession, level: 90, createdAt: 1,
    ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, inventory: [], claimedWarCrateIds: [],
});
const war = (village = 'Sand', mvp = false, points = 400): VillageWarRewardRecord => ({
    id: 'floor-war', villages: ['Leaf', 'Sand'], startedAt: NOW - 121 * HOUR,
    pendingUntil: NOW - 120 * HOUR, endedAt: NOW, campaign: {}, winnerVillage: 'Leaf',
    warCrateId: 'winner-floor-war', loserCrateId: 'loser-floor-war',
    mvpByVillage: mvp ? { [village]: 'Kira' } : {},
    contributions: { kira: { name: 'Kira', side: village, damage: points } },
});
const currencies = (c: WarRewardCharacter) => [c.ryo, c.honorSeals, c.boneCharms, c.fateShards];
function bundle(village: string, mvp: boolean, profession: string) {
    const settled = settleVillageWarRewards(base(village, profession), war(village, mvp), NOW, DIALS);
    let character = settled.character;
    for (let i = 0; i < settled.crates; i++) {
        const opened = applyWarCrateOpen(character, 1);
        assert.equal(opened.ok, true);
        if (opened.ok) character = opened.character;
    }
    return character;
}

test('maximum same-effort war bundles no longer reward a loss with more scarce currency', () => {
    for (const profession of ['vanguard', 'healer', 'petTamer']) for (const mvp of [false, true]) {
        const winner = bundle('Leaf', mvp, profession), loser = bundle('Sand', mvp, profession);
        for (const currency of ['ryo', 'honorSeals', 'boneCharms', 'fateShards']) {
            assert.ok(Number(winner[currency]) >= Number(loser[currency]), profession + '/' + mvp + '/' + currency);
        }
    }
    assert.deepEqual(currencies(bundle('Leaf', true, 'vanguard')), [52_000, 200, 20, 8]);
    assert.deepEqual(currencies(bundle('Sand', true, 'vanguard')), [37_100, 175, 19, 8]);
    assert.deepEqual(currencies(bundle('Sand', false, 'vanguard')), [21_600, 50, 6, 2]);
});

test('a qualifying low-purse participant receives only the missing explicit support amounts', () => {
    const result = settleVillageWarRewards(base(), war('Sand', false, 50), NOW, DIALS);
    assert.equal(result.purse, 2_700);
    assert.deepEqual(currencies(result.character), [5_000, 50, 6, 1]);
    assert.equal(result.consolation, true);
    assert.equal(settleVillageWarRewards(result.character, war('Sand', false, 50), NOW, DIALS).granted, false);
    assert.equal(settleVillageWarRewards(base(), war('Sand', false, 49), NOW, DIALS).consolation, false);
});

test('previous MVP and purse markers count toward the floor without another payment', () => {
    const character = { ...base(), ryo: 36_600, honorSeals: 150, boneCharms: 18, fateShards: 8,
        claimedWarCrateIds: ['mvp-crate-floor-war', 'purse-floor-war', 'stats-floor-war'] };
    const result = settleVillageWarRewards(character, war('Sand', true), NOW, DIALS);
    assert.equal(result.consolation, true, 'stamp the previously unclaimed consolation');
    assert.equal(result.ryo, 0);
    assert.deepEqual(currencies(result.character), currencies(character));
    assert.equal(settleVillageWarRewards(result.character, war('Sand', true), NOW, DIALS).granted, false);
});

test('enabling a staged purse after a floor-only claim pays only the outstanding balance', () => {
    const record = war();
    const first = settleVillageWarRewards(base(), record, NOW, { ...DIALS, purseScale: 0 });
    assert.deepEqual(currencies(first.character), [5_000, 50, 6, 1]);
    const second = settleVillageWarRewards(first.character, record, NOW, DIALS);
    assert.equal(second.ryo, 16_600);
    assert.equal(second.purse, 16_600, 'report the actual new purse payment after prior support');
    assert.equal(second.purseHonor, 0);
    assert.deepEqual(currencies(second.character), [21_600, 50, 6, 2]);
    assert.equal(settleVillageWarRewards(second.character, record, NOW, DIALS).granted, false);
});

test('old additive receipts stay spent and already paid balances are never clawed back', () => {
    const character = { ...base(), ryo: 42_100, honorSeals: 225, boneCharms: 26, fateShards: 11,
        claimedWarCrateIds: ['mvp-crate-floor-war', 'purse-floor-war', 'stats-floor-war', 'loser-floor-war'] };
    const replay = settleVillageWarRewards(character, war('Sand', true), NOW, DIALS);
    assert.equal(replay.granted, false);
    assert.deepEqual(replay.character, character);
    const oldConsolation = { ...base(), ryo: 5_000, honorSeals: 50, boneCharms: 6, fateShards: 3,
        claimedWarCrateIds: ['loser-floor-war', 'stats-floor-war'] };
    const later = settleVillageWarRewards(oldConsolation, war(), NOW, DIALS);
    assert.deepEqual(currencies(later.character), [21_600, 50, 6, 3], 'existing extra FS are retained, not paid a second time');
});

test('loss support follows the established-account rule: 72 hours old OR level 20', () => {
    const fresh = { ...base(), level: 10, createdAt: NOW - HOUR };
    const young = settleVillageWarRewards(fresh, war('Sand', false, 50), NOW, DIALS);
    assert.equal(young.consolation, false, 'a fresh low-level alt on the losing side gets no floor');
    assert.deepEqual(currencies(young.character), [0, 0, 0, 0]);
    const freshButLevelled = settleVillageWarRewards({ ...fresh, level: 20 }, war('Sand', false, 50), NOW, DIALS);
    assert.equal(freshButLevelled.consolation, true, 'level 20 counts as established at any age');
    assert.deepEqual(currencies(freshButLevelled.character), [5_000, 50, 6, 1]);
});

test('a floor remains available on legacy wars, while draws have no loss consolation', () => {
    const legacy = { ...war('Sand', false, 50), campaign: undefined };
    assert.deepEqual(currencies(settleVillageWarRewards(base(), legacy, NOW, DIALS).character), [5_000, 50, 6, 1]);
    const draw = { ...war(), winnerVillage: undefined, warCrateId: undefined, loserCrateId: undefined };
    const result = settleVillageWarRewards(base(), draw, NOW, DIALS);
    assert.equal(result.consolation, false);
    assert.deepEqual(currencies(result.character), [21_600, 50, 6, 2]);
});
