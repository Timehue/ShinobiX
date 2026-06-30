import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    hollowShardDrop as serverShardDrop,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    maxFragmentsForDepth,
    maxHaulForDepth,
    maxShardsForDepth,
    settleItemCount,
    AUGMENT_CATALOG,
    rollAugmentOffers,
    rewardMultiplierForToken,
    augmentDisplay,
} from './_run-token.js';
import { settleCurrency } from './settle.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The api/ (cPanel tsc) and shinobij.client/ (Vite) build roots are separate
// module systems, so — like _cross-build-parity.test.ts — the drift guard reads
// the client run lib as TEXT rather than importing it across the boundary.
const CLIENT_RUN_SRC = readFileSync(join('shinobij.client', 'src', 'lib', 'hollow-gate-run.ts'), 'utf8');

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

test('settleCurrency never restores in-run spends (min with current balance)', () => {
    // Player spent below their entry mid-run — settle must not refund them back up.
    assert.equal(settleCurrency(80, 100, 30, 1000, 1), 80);
});

test('settleCurrency floors at 0 and ignores negative/junk input', () => {
    assert.equal(settleCurrency(-5, 0, -10, 50, 1), 0);
    assert.equal(settleCurrency(0, 0, 9999, 0, 1), 0); // zero ceiling → no credit
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

test('maxFragmentsForDepth grows with depth, clamps to 1..20, and is always positive', () => {
    assert.equal(maxFragmentsForDepth(1), 1);
    assert.equal(maxFragmentsForDepth(5), 5);
    assert.ok(maxFragmentsForDepth(5) > maxFragmentsForDepth(3), 'deeper runs allow more fragments');
    assert.equal(maxFragmentsForDepth(0), 1, 'floors at 1');
    assert.equal(maxFragmentsForDepth(999), 20, 'clamps at 20');
    assert.equal(maxFragmentsForDepth(NaN as unknown as number), 1, 'junk → 1');
});

test('settleItemCount clamps an over-claim to the sealed ceiling', () => {
    assert.equal(settleItemCount(99, 5, 1), 5);  // claimed 99, ceiling 5 → 5
    assert.equal(settleItemCount(2, 5, 1), 2);   // under the ceiling → claimed
});

test('settleItemCount applies the death claw-back fraction and floors', () => {
    assert.equal(settleItemCount(4, 10, 0.5), 2);  // floor(min(4,10)*0.5)
    assert.equal(settleItemCount(1, 10, 0.5), 0);  // a lone fragment is lost on death
});

test('settleItemCount floors at 0 and ignores negative/junk input', () => {
    assert.equal(settleItemCount(-3, 5, 1), 0);
    assert.equal(settleItemCount(5, 0, 1), 0);              // zero ceiling → no credit
    assert.equal(settleItemCount('junk', 5, 1), 0);
    assert.equal(settleItemCount(undefined, 5, 1), 0);      // current clients send nothing → inert
});
