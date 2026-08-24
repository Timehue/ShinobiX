/*
 * Village Stores client/server MIRROR parity.
 *
 * shinobij.client/src/lib/village-stores.ts (and its sibling
 * village-war-map-ui.ts) hand-copy a dozen server balance constants so the Town
 * Hall, the Cafeteria and the sector Intel card can say what a donation, a
 * siege or a declare costs BEFORE the request. Every one of them carries a
 * "KEEP IN SYNC" comment and, until this file existed, nothing enforced it:
 * the copy tests all import the CLIENT constants and assert the sentences
 * interpolate them, so they pass identically after a drift — the player is just
 * quietly told the wrong number, and the server refuses (or charges) something
 * else. That is the exact failure the clan-exchange and Spire mirrors already
 * have parity gates for.
 *
 * Imports BOTH trees, so it lives in scripts/ like the other cross-package
 * parity tests: it is a run-tests.mjs scan root, and the server tsc build
 * cannot compile client imports.
 *
 * This asserts EQUALITY of mirrors only. It changes no rule, cost or cap — if
 * one of these ever fails, the fix is to re-copy the server value, never to
 * relax the assertion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DAILY_CRAFT_POINT_DONATION_CAP as serverPointCap,
    DAILY_RATION_COOK_CAP as serverCookCap,
    DAILY_RATION_DONATION_CAP as serverRationCap,
    DEPOT_CONVERSION_POINTS_PER_WR as serverDepotPerWr,
    GARRISON_POINTS_CAP_FED as serverGarrisonCapFed,
    GARRISON_RATIONS_PER_DAY as serverGarrisonRations,
    RATION_ITEM_ID as serverRationItemId,
    STORES_LEDGER_VIEW_ROWS as serverLedgerRows,
    STRUCTURE_MATERIALS_BY_LEVEL as serverStructureMaterials,
    WAR_RATIONS_PER_DAY as serverWarRations,
} from '../api/_village-stores';
import { GARRISON_POINTS_CAP as serverGarrisonCap } from '../api/_sector-war';
import {
    INTEL_DECLARE_MULTIPLIER as serverDeclareMultiplier,
    INTEL_TIER_THRESHOLDS as serverIntelThresholds,
    INTEL_TTL_MS as serverIntelTtlMs,
    intelDeclareCost as serverIntelDeclareCost,
    intelTierFor as serverIntelTierFor,
    type IntelTier,
} from '../api/_village-intel';
import { SECTOR_WAR_WR as serverSectorWarWr } from '../api/_war-economy';
import { CRAFT_POINTS as serverCraftPoints } from '../api/craft/_forge';
import {
    CRAFT_POINT_VALUES as clientCraftPoints,
    DAILY_CRAFT_POINT_DONATION_CAP as clientPointCap,
    DAILY_RATION_COOK_CAP as clientCookCap,
    DAILY_RATION_DONATION_CAP as clientRationCap,
    DEPOT_CONVERSION_POINTS_PER_WR as clientDepotPerWr,
    GARRISON_RATIONS_PER_DAY as clientGarrisonRations,
    INTEL_DECLARE_BASE_COST as clientDeclareBaseCost,
    INTEL_TIER_THRESHOLDS as clientIntelThresholds,
    INTEL_TTL_DAYS as clientIntelTtlDays,
    INTEL_TTL_MS as clientIntelTtlMs,
    RATION_ITEM_ID as clientRationItemId,
    STORES_LEDGER_VIEW_ROWS as clientLedgerRows,
    STRUCTURE_MATERIALS_BY_LEVEL as clientStructureMaterials,
    WAR_RATIONS_PER_DAY as clientWarRations,
    intelTierFor as clientIntelTierFor,
} from '../shinobij.client/src/lib/village-stores';
import {
    GARRISON_POINTS_CAP as clientGarrisonCap,
    GARRISON_POINTS_CAP_FED as clientGarrisonCapFed,
    WAR_RATIONS_PER_DAY as warMapUiWarRations,
} from '../shinobij.client/src/lib/village-war-map-ui';

const TIERS: IntelTier[] = ['none', 'scouted', 'mapped', 'infiltrated'];

test('the ration burn rates the supply copy quotes match the daily pass', () => {
    // "a siege eats 30 a day — 15 more for a fed garrison" is sized from these.
    assert.equal(clientWarRations, serverWarRations);
    assert.equal(clientGarrisonRations, serverGarrisonRations);
});

test('there is exactly ONE client mirror of WAR_RATIONS_PER_DAY', () => {
    // village-war-map-ui.ts used to declare its own literal 30 beside
    // village-stores.ts's, each claiming to be THE mirror. It now re-exports,
    // so this is identity, not a second copy to keep in step.
    assert.equal(warMapUiWarRations, clientWarRations);
});

test('the per-donor daily caps the Town Hall enforces locally match the 429', () => {
    assert.equal(clientRationCap, serverRationCap);
    assert.equal(clientPointCap, serverPointCap);
    assert.equal(clientCookCap, serverCookCap);
});

test('the donatable-item table matches the server craft-points table exactly', () => {
    assert.deepEqual(clientCraftPoints, serverCraftPoints as Record<string, number>);
    assert.equal(clientRationItemId, serverRationItemId);
});

test('the structure materials gate and depot conversion rate are copied verbatim', () => {
    assert.deepEqual(clientStructureMaterials, serverStructureMaterials);
    assert.equal(clientDepotPerWr, serverDepotPerWr);
    assert.equal(clientLedgerRows, serverLedgerRows);
});

test('the garrison point caps the war map explains match the sector-war engine', () => {
    assert.equal(clientGarrisonCap, serverGarrisonCap);
    assert.equal(clientGarrisonCapFed, serverGarrisonCapFed);
});

test('the intel tier thresholds match, and both sides bucket points identically', () => {
    assert.deepEqual({ ...clientIntelThresholds }, { ...serverIntelThresholds });
    for (const points of [0, 1, 99, 100, 101, 249, 250, 251, 499, 500, 501, 2_000]) {
        assert.equal(clientIntelTierFor(points), serverIntelTierFor(points), `tier drifted at ${points} intel`);
    }
});

test('every declare BASE cost the intel card quotes is the server product', () => {
    // The client stores the RESULT (250 / 250 / 175 / 125); the server stores
    // the multiplier and rounds SECTOR_WAR_WR by it. This is the assertion the
    // copy tests could not make: it derives the client number from the server.
    for (const tier of TIERS) {
        const expected = Math.round(serverSectorWarWr * serverDeclareMultiplier[tier]);
        assert.equal(clientDeclareBaseCost[tier], expected, `${tier} declare base cost drifted`);
        // …and agrees with the server's own helper, which is what actually charges.
        assert.equal(clientDeclareBaseCost[tier], serverIntelDeclareCost(serverSectorWarWr, tier), `${tier} disagrees with intelDeclareCost`);
    }
    assert.equal(clientDeclareBaseCost.none, serverSectorWarWr);
});

test('the "intel goes cold" copy quotes the server TTL', () => {
    assert.equal(clientIntelTtlMs, serverIntelTtlMs);
    assert.equal(clientIntelTtlDays, serverIntelTtlMs / 86_400_000);
});
