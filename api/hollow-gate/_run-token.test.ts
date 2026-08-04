import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    hollowShardDrop as serverShardDrop,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    itemStackCount,
    AUGMENT_CATALOG,
    rollAugmentOffers,
    rewardMultiplierForToken,
    augmentDisplay,
    canonicalHollowGateDepth,
} from './_run-token.js';
import {
    creditHollowGateLedger,
    hollowGateDeathRetention,
    normalizeHollowGateLedger,
    multiplyHollowGateCurrencyCredit,
    reconcileLedgerAmount,
    setCountedItem,
} from './_ledger.js';
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
        id: 'event-one', floors: 3, width: 25, height: 17, keyCost: 0,
        bossAiId: 'festival-oni', bossName: 'Festival Oni', updatedAt: 123,
    });
    assert.deepEqual(normalizePublishedEventGate({
        id: 'event-one', active: true, maxFloor: 2, width: 19, height: 13,
    }, 'event-one'), {
        id: 'event-one', floors: 2, width: 19, height: 13, keyCost: 1, updatedAt: 0,
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

test('exact ledger ignores duplicate reward sources and records currencies plus items', () => {
    const run = {
        rewardLedger: { currencies: {}, items: {}, sourceIds: [] },
        serverCreditedCurrencies: {},
    } as never;
    const first = creditHollowGateLedger(run, 'combat:floor-1-boss', {
        currencies: { ryo: 20, hollowShards: 5 },
        items: { 'veil-of-the-hollow': 1 },
    });
    assert.equal(first.alreadyCredited, false);
    assert.deepEqual(first.ledger.currencies, { ryo: 20, hollowShards: 5 });
    assert.deepEqual(first.ledger.items, { 'veil-of-the-hollow': 1 });
    const duplicate = creditHollowGateLedger({ rewardLedger: first.ledger, serverCreditedCurrencies: {} } as never, 'combat:floor-1-boss', {
        currencies: { ryo: 999 },
    });
    assert.equal(duplicate.alreadyCredited, true);
    assert.equal(duplicate.ledger.currencies.ryo, 20);
});
test('ledger reconciliation preserves spending and rejects unrecorded gain', () => {
    assert.equal(reconcileLedgerAmount(1_000_000, 100, 20, 1), 120);
    assert.equal(reconcileLedgerAmount(110, 100, 20, 1), 110);
    assert.equal(reconcileLedgerAmount(120, 100, 20, 0.5), 110);
    assert.equal(reconcileLedgerAmount(-5, 0, 20, 1), 0);
});

test('legacy credits migrate into the ledger and Greedy Hands is server-derived', () => {
    assert.deepEqual(normalizeHollowGateLedger({ serverCreditedCurrencies: { ryo: 7 } }).currencies, { ryo: 7 });
    assert.equal(hollowGateDeathRetention({}), 0.5);
    assert.equal(hollowGateDeathRetention({ hollowGateAttunement: { 'greedy-hands': 2 } }), 0.7);
    assert.equal(hollowGateDeathRetention({ hollowGateAttunement: { 'greedy-hands': 999 } }), 0.8);
});

test('sealed reward multiplier scales currency credits but never duplicates counted items', () => {
    assert.deepEqual(multiplyHollowGateCurrencyCredit({
        currencies: { ryo: 11, hollowShards: 3 },
        items: { 'veil-of-the-hollow': 1 },
    }, 2), {
        currencies: { ryo: 22, hollowShards: 6 },
        items: { 'veil-of-the-hollow': 1 },
    });
});

// ─── Counted-item ledger identity ────────────────────────────────────────────────

test('HG_HIGH_VALUE_ITEM_ID mirrors the client DUNGEON_LEGENDARY_FRAGMENT_ID (drift guard)', () => {
    assert.equal(HG_HIGH_VALUE_ITEM_ID, 'dungeon-legendary-fragment');
    const CLIENT_GAME_CONSTS = readFileSync(join('shinobij.client', 'src', 'constants', 'game.ts'), 'utf8');
    assert.ok(
        CLIENT_GAME_CONSTS.includes('DUNGEON_LEGENDARY_FRAGMENT_ID = "dungeon-legendary-fragment"'),
        'client fragment id drifted from the server mirror',
    );
});

test('setCountedItem replaces only the requested counted stack', () => {
    assert.deepEqual(setCountedItem([], 'fragment', 2), [{ itemId: 'fragment', count: 2 }]);
    assert.deepEqual(setCountedItem([{ itemId: 'fragment', count: 2 }, { itemId: 'other', count: 4 }], 'fragment', 3), [
        { itemId: 'other', count: 4 }, { itemId: 'fragment', count: 3 },
    ]);
    assert.deepEqual(setCountedItem([{ itemId: 'fragment', count: 2 }], 'fragment', -10), []);
});

test('itemStackCount sums the counted-stack total for an item id', () => {
    const stacks = [{ itemId: 'dungeon-legendary-fragment', count: 3 }, { itemId: 'other', count: 9 }];
    assert.equal(itemStackCount(stacks, 'dungeon-legendary-fragment'), 3);
    assert.equal(itemStackCount(stacks, 'missing'), 0);
    assert.equal(itemStackCount(null, 'x'), 0);                          // no stacks → 0
    assert.equal(itemStackCount([{ itemId: 'x', count: -5 }], 'x'), 0);  // junk count floored
});
