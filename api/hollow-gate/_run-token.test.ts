import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    hollowShardDrop as serverShardDrop,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    clampFragmentTotal,
    itemStackCount,
    maxFragmentsForDepth,
    maxVeilsForDepth,
    maxXpForDepth,
    maxHaulForDepth,
    maxShardsForDepth,
    AUGMENT_CATALOG,
    rollAugmentOffers,
    rewardMultiplierForToken,
    augmentDisplay,
    canonicalHollowGateDepth,
} from './_run-token.js';
import { addCountedItem, settleCurrency, settleCurrencyWithServerCredit } from './settle.js';
import { normalizePublishedEventGate } from './start.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The api/ (cPanel tsc) and shinobij.client/ (Vite) build roots are separate
// module systems, so — like _cross-build-parity.test.ts — the drift guard reads
// the client run lib as TEXT rather than importing it across the boundary.
const CLIENT_RUN_SRC = readFileSync(join('shinobij.client', 'src', 'lib', 'hollow-gate-run.ts'), 'utf8');

test('the server seals the shipped five-floor depth unless a server-owned event gate overrides it', () => {
    assert.equal(canonicalHollowGateDepth(), 5);
    assert.equal(canonicalHollowGateDepth(3), 3);
    assert.equal(canonicalHollowGateDepth(999), 5);
    assert.equal(canonicalHollowGateDepth(0), 1);
    const startSource = readFileSync(join('api', 'hollow-gate', 'start.ts'), 'utf8');
    assert.ok(startSource.includes('const floorDepth = riftDef?.floors ?? eventDef?.floors ?? canonicalHollowGateDepth()'));
    assert.equal(startSource.includes('canonicalHollowGateDepth(body.floorDepth)'), false);
});

test('only the matching active admin-published event can seal a custom gate', () => {
    assert.equal(normalizePublishedEventGate({ id: 'event-one', active: false }, 'event-one'), null);
    assert.equal(normalizePublishedEventGate({ id: 'event-other', active: true }, 'event-one'), null);
    assert.deepEqual(normalizePublishedEventGate({
        id: 'event-one', active: true, maxFloor: 3, keyCost: 0,
        bossAiId: 'festival-oni', bossName: 'Festival Oni', updatedAt: 123,
    }, 'event-one'), {
        id: 'event-one', floors: 3, keyCost: 0, bossAiId: 'festival-oni', bossName: 'Festival Oni', updatedAt: 123,
    });
    assert.equal(normalizePublishedEventGate({ id: 'event-one', active: true, maxFloor: 999 }, 'event-one')?.floors, 5);
});

test('hollowShardDrop matches the documented curve, and the client source still defines it (drift guard)', () => {
    for (let f = 1; f <= 8; f++) {
        assert.equal(serverShardDrop(f, 'chest'), 2 + f);
        assert.equal(serverShardDrop(f, 'shardVein'), 3 + f * 2);
        assert.equal(serverShardDrop(f, 'lockedChest'), 5 + f * 2);
        assert.equal(serverShardDrop(f, 'boss'), 15 + f * 5);
    }
    // The CLIENT source must still define these exact formulas — if it changes,
    // this fails so the server mirror gets updated in lockstep.
    assert.ok(CLIENT_RUN_SRC.includes('return 2 + f;'), 'client chest curve drifted');
    assert.ok(CLIENT_RUN_SRC.includes('return 3 + f * 2;'), 'client shardVein curve drifted');
    assert.ok(CLIENT_RUN_SRC.includes('return 5 + f * 2;'), 'client lockedChest curve drifted');
    assert.ok(CLIENT_RUN_SRC.includes('return 15 + f * 5;'), 'client boss curve drifted');
});

test('clawback key set matches the client source', () => {
    assert.equal(HG_CLAWBACK_KEYS.length, 7);
    for (const k of HG_CLAWBACK_KEYS) {
        assert.ok(CLIENT_RUN_SRC.includes(`"${k}"`), `client clawback keys missing ${k}`);
    }
});

test('maxHaulForDepth grows with depth, scales by the sealed multiplier, and is finite/positive', () => {
    const d3 = maxHaulForDepth(3, 1);
    const d5 = maxHaulForDepth(5, 1);
    assert.ok(d5.hollowShards > d3.hollowShards, 'deeper runs allow a bigger ceiling');
    const d3x2 = maxHaulForDepth(3, 2);
    assert.equal(d3x2.hollowShards, Math.ceil(maxShardsForDepth(3) * 2), 'multiplier scales the shard ceiling');
    assert.ok(d3x2.ryo > d3.ryo, 'multiplier scales the other currencies too');
    for (const k of HG_CLAWBACK_KEYS) assert.ok(d5[k] > 0 && Number.isFinite(d5[k]), `${k} ceiling must be finite+positive (bounds farming)`);
});

test('rollAugmentOffers returns N distinct real catalog augments', () => {
    const offers = rollAugmentOffers(3);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((o) => o.id)).size, 3, 'no duplicate offers');
    for (const o of offers) assert.ok(AUGMENT_CATALOG[o.id], 'offer is a real augment');
});

test('rewardMultiplier comes ONLY from the sealed chosen augment', () => {
    assert.equal(rewardMultiplierForToken({ chosenAugmentId: null }), 1);
    assert.equal(rewardMultiplierForToken({ chosenAugmentId: 'greedy-pact' }), 2.0);
    assert.equal(rewardMultiplierForToken({ chosenAugmentId: 'not-a-real-augment' }), 1, 'unknown id → no multiplier (no inflation)');
});

test('every augment multiplier is a reward bonus (>=1) and capped (<=2)', () => {
    for (const a of Object.values(AUGMENT_CATALOG)) {
        assert.ok(a.rewardMultiplier >= 1 && a.rewardMultiplier <= 2.0, `${a.id} multiplier out of bounds`);
    }
});

test('augmentDisplay never leaks the rewardMultiplier to the client', () => {
    const d = augmentDisplay(AUGMENT_CATALOG['greedy-pact']) as Record<string, unknown>;
    assert.equal(d.rewardMultiplier, undefined, 'sealed multiplier must not be sent to the client');
    assert.equal(d.id, 'greedy-pact');
});

test('settleCurrency clamps an over-claim to the sealed ceiling', () => {
    // A crafted client reports a huge balance + claim; the ceiling caps the credit.
    assert.equal(settleCurrency(1_000_000, 100, 5000, 50, 1), 150); // entry 100 + min(5000,50) = 150
});

test('settleCurrency applies the server death claw-back (x0.5)', () => {
    assert.equal(settleCurrency(140, 100, 40, 1000, 0.5), 120); // entry 100 + floor(40*0.5)=20
});

test('settleCurrency preserves an in-run spend while crediting the earned haul', () => {
    // Entry 100, spend 20, earn 30 => 110 (the spend is not refunded).
    assert.equal(settleCurrency(80, 100, 30, 1000, 1), 110);
});

test('settleCurrency floors at 0 and ignores negative/junk input', () => {
    assert.equal(settleCurrency(-5, 0, -10, 50, 1), 0);
    assert.equal(settleCurrency(0, 0, 9999, 0, 1), 0); // zero ceiling → no credit
});

test('server-banked combat currency survives a stale extraction snapshot without being paid twice', () => {
    assert.equal(settleCurrencyWithServerCredit(120, 100, 0, 20, 1000, 1), 120);
    assert.equal(settleCurrencyWithServerCredit(125, 100, 25, 20, 1000, 1), 125);
});

test('server-banked combat currency still preserves in-run spends and death retention', () => {
    assert.equal(settleCurrencyWithServerCredit(110, 100, 10, 20, 1000, 1), 110);
    assert.equal(settleCurrencyWithServerCredit(120, 100, 20, 20, 1000, 0.5), 110);
});

// ─── P0.2c high-value ITEM ceiling (Dungeon Legendary Fragment) ──────────────────

test('HG_HIGH_VALUE_ITEM_ID mirrors the client DUNGEON_LEGENDARY_FRAGMENT_ID (drift guard)', () => {
    assert.equal(HG_HIGH_VALUE_ITEM_ID, 'dungeon-legendary-fragment');
    const CLIENT_GAME_CONSTS = readFileSync(join('shinobij.client', 'src', 'constants', 'game.ts'), 'utf8');
    assert.ok(
        CLIENT_GAME_CONSTS.includes('DUNGEON_LEGENDARY_FRAGMENT_ID = "dungeon-legendary-fragment"'),
        'client fragment id drifted from the server mirror',
    );
});

test('maxFragmentsForDepth grows with depth, clamps to 2..40, and is always positive', () => {
    assert.equal(maxFragmentsForDepth(1), 2);
    assert.equal(maxFragmentsForDepth(5), 10);
    assert.ok(maxFragmentsForDepth(5) > maxFragmentsForDepth(3), 'deeper runs allow a bigger ceiling');
    assert.equal(maxFragmentsForDepth(0), 2, 'floors at the min ceiling');
    assert.equal(maxFragmentsForDepth(999), 40, 'clamps at 40');
    assert.equal(maxFragmentsForDepth(NaN as unknown as number), 2, 'junk → floor');
});

test('XP and Veil settlement ceilings are finite and depth-bounded', () => {
    assert.equal(maxXpForDepth(5), 50_000);
    assert.equal(maxXpForDepth(5, 2), 100_000);
    assert.equal(maxVeilsForDepth(5), 6);
    assert.equal(maxVeilsForDepth(999), 21);
});

test('addCountedItem creates and increments only the requested stack', () => {
    assert.deepEqual(addCountedItem([], 'fragment', 2), [{ itemId: 'fragment', count: 2 }]);
    assert.deepEqual(addCountedItem([{ itemId: 'fragment', count: 2 }, { itemId: 'other', count: 4 }], 'fragment', 3), [
        { itemId: 'fragment', count: 5 }, { itemId: 'other', count: 4 },
    ]);
    assert.deepEqual(addCountedItem([{ itemId: 'fragment', count: 2 }], 'fragment', -10), [{ itemId: 'fragment', count: 2 }]);
});

test('itemStackCount sums the counted-stack total for an item id', () => {
    const stacks = [{ itemId: 'dungeon-legendary-fragment', count: 3 }, { itemId: 'other', count: 9 }];
    assert.equal(itemStackCount(stacks, 'dungeon-legendary-fragment'), 3);
    assert.equal(itemStackCount(stacks, 'missing'), 0);
    assert.equal(itemStackCount(null, 'x'), 0);                          // no stacks → 0
    assert.equal(itemStackCount([{ itemId: 'x', count: -5 }], 'x'), 0);  // junk count floored
});

test('clampFragmentTotal caps the run GAIN to the ceiling, byte-identical under it', () => {
    // entry 4, ceiling 10 → allowed up to 14; a legit total under that is unchanged.
    assert.equal(clampFragmentTotal(9, 4, 10), 9);   // gained 5 (<=10) → no clamp
    assert.equal(clampFragmentTotal(14, 4, 10), 14); // gained exactly 10 → boundary, kept
    assert.equal(clampFragmentTotal(99, 4, 10), 14); // gained 95 → clawed back to entry+ceiling
});

test('clampFragmentTotal never restores an in-run spend and never goes negative', () => {
    assert.equal(clampFragmentTotal(2, 5, 10), 2);   // spent below entry mid-run → keep current, no refund
    assert.equal(clampFragmentTotal(-3, 0, 10), 0);  // junk → 0
    assert.equal(clampFragmentTotal(5, 0, 0), 0);    // zero entry + zero ceiling → 0
});
