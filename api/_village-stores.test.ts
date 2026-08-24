import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    stepVillageStoresDay, depotConversionCap, structureMaterialsCost, storesDonationRouting,
    unfedStructureMultiplier, homeLossBurn, appendStoresLedger, parseStoresLedger,
    dailyCounter, stampDailyCounter,
    WAR_RATIONS_PER_DAY, MERC_RATIONS_PER_MEMBER, GARRISON_RATIONS_PER_DAY, STORES_LEDGER_CAP,
} from './_village-stores.js';
import { CRAFT_POINTS } from './craft/_forge.js';
import { villageStoresEnabled } from './_release-flags.js';

const NOW = Date.UTC(2026, 7, 22, 4, 0, 0);
const base = { materialPoints: 0, warResources: 0, wrPoolCap: 5000, depotLevel: 0, wars: [], mercs: [], now: NOW };

describe('village stores — kill switch', () => {
    it('is on by default and off only on the exact value', () => {
        assert.equal(villageStoresEnabled({}), true);
        assert.equal(villageStoresEnabled({ DISABLE_VILLAGE_STORES: '1' }), false);
        assert.equal(villageStoresEnabled({ DISABLE_VILLAGE_STORES: 'true' }), true);
    });
});

describe('stepVillageStoresDay — spoilage', () => {
    it('spoils 5%/day, floored, before anything eats', () => {
        const out = stepVillageStoresDay({ ...base, provisions: 199 });
        assert.equal(out.spoiled, 9);
        assert.equal(out.provisions, 190);
        assert.deepEqual(out.ledger.map((e) => e.kind), ['spoil']);
    });
    it('a stock under 20 never spoils (floor)', () => {
        assert.equal(stepVillageStoresDay({ ...base, provisions: 19 }).spoiled, 0);
    });
});

describe('stepVillageStoresDay — burn order wars → mercs → garrisons', () => {
    it('feeds in order and marks the first consumer the stock cannot cover UNFED', () => {
        // 100 → spoil 5 → 95. war A 30 (65), war B 30 (35), merc 3×8=24 (11), garrison A 15 → unfed.
        const out = stepVillageStoresDay({
            ...base, provisions: 100,
            wars: [{ id: 'A', garrisonFed: true }, { id: 'B', garrisonFed: false }],
            mercs: [{ tierId: 'merc-ronin', player: 'p', size: 3 }],
        });
        assert.deepEqual(out.wars, [{ id: 'A', fed: true, garrisonCovered: false }, { id: 'B', fed: true, garrisonCovered: false }]);
        assert.deepEqual(out.mercs, [{ tierId: 'merc-ronin', player: 'p', fed: true }]);
        assert.equal(out.provisions, 11);
        assert.equal(out.anyWarUnfed, false);
        assert.deepEqual(out.ledger.map((e) => [e.kind, e.amount]), [['spoil', 5], ['war', 30], ['war', 30], ['merc', 24]]);
    });
    it('an unfed war is skipped entirely (no partial feeding) and flags anyWarUnfed; a later cheaper consumer can still eat', () => {
        // 40 → spoil 2 → 38 → war 30 (8) → second war unfed → merc size 1 = 8 → fed (0).
        const out = stepVillageStoresDay({
            ...base, provisions: 40,
            wars: [{ id: 'A', garrisonFed: false }, { id: 'B', garrisonFed: false }],
            mercs: [{ tierId: 'merc-ronin', player: 'p', size: 1 }],
        });
        assert.equal(out.wars[0].fed, true);
        assert.equal(out.wars[1].fed, false);
        assert.equal(out.mercs[0].fed, true);
        assert.equal(out.provisions, 0);
        assert.equal(out.anyWarUnfed, true);
    });
    it('garrison coverage is separate from the war ration and costs 15', () => {
        // 47 -> spoil 2 -> 45 -> war 30 -> 15 -> garrison 15 -> 0.
        const out = stepVillageStoresDay({ ...base, provisions: 47, wars: [{ id: 'A', garrisonFed: true }] });
        assert.equal(WAR_RATIONS_PER_DAY + GARRISON_RATIONS_PER_DAY, 45);
        assert.equal(out.wars[0].fed, true);
        assert.equal(out.wars[0].garrisonCovered, true);
        assert.equal(out.provisions, 0);
        assert.equal(MERC_RATIONS_PER_MEMBER, 8);
    });
    it('each fed war costs its own 15 garrison rations (two wars = 30)', () => {
        // 120 -> spoil 6 -> 114 -> wars 60 -> 54 -> garrisons 30 -> 24.
        const out = stepVillageStoresDay({ ...base, provisions: 120, wars: [{ id: 'A', garrisonFed: true }, { id: 'B', garrisonFed: true }] });
        assert.deepEqual(out.wars.map((w) => w.garrisonCovered), [true, true]);
        assert.equal(out.provisions, 24);
        assert.deepEqual(out.ledger.filter((e) => e.kind === 'garrison').map((e) => e.amount), [15, 15]);
    });
    it('a merc band with zero survivors costs nothing and reads fed', () => {
        const out = stepVillageStoresDay({ ...base, provisions: 0, mercs: [{ tierId: 't', player: 'p', size: 0 }] });
        assert.equal(out.mercs[0].fed, true);
    });
});

describe('stepVillageStoresDay — depot conversion', () => {
    it('converts 10 points per WR up to the depot cap: L0 100, L5 250, L10 400', () => {
        assert.equal(depotConversionCap(0), 100);
        assert.equal(depotConversionCap(5), 250);
        assert.equal(depotConversionCap(10), 400);
        const out = stepVillageStoresDay({ ...base, provisions: 0, materialPoints: 9_999, depotLevel: 5 });
        assert.equal(out.wrConverted, 250);
        assert.equal(out.pointsConverted, 2_500);
        assert.equal(out.materialPoints, 7_499);
        assert.equal(out.warResources, 250);
        assert.deepEqual(out.ledger, [{ at: NOW, kind: 'convert', amount: 2500, ref: 'wr:250' }]);
    });
    it('converts whole WR only and is bounded by affordable points', () => {
        const out = stepVillageStoresDay({ ...base, provisions: 0, materialPoints: 57 });
        assert.equal(out.wrConverted, 5);
        assert.equal(out.materialPoints, 7);
    });
    it('respects WR_POOL_CAP (never overfills the pool)', () => {
        const out = stepVillageStoresDay({ ...base, provisions: 0, materialPoints: 5_000, warResources: 4_990, wrPoolCap: 5_000 });
        assert.equal(out.wrConverted, 10);
        assert.equal(out.warResources, 5_000);
        assert.equal(out.materialPoints, 4_900);
    });
});

describe('village stores — helpers', () => {
    it('structure materials gate: L6..L10 priced, ≤5 free', () => {
        assert.equal(structureMaterialsCost(5), 0);
        assert.deepEqual([6, 7, 8, 9, 10].map(structureMaterialsCost), [400, 700, 1100, 1600, 2400]);
    });
    it('routes rations 1:1 to provisions and CRAFT_POINTS items to material points', () => {
        assert.deepEqual(storesDonationRouting('ration-pack', 7, CRAFT_POINTS), { store: 'provisions', amount: 7 });
        assert.deepEqual(storesDonationRouting('hunt-ash-scale', 3, CRAFT_POINTS), { store: 'materialPoints', amount: 45, perItem: 15 });
        assert.deepEqual(storesDonationRouting('warforged-relic', 1, CRAFT_POINTS), { store: 'materialPoints', amount: 250, perItem: 250 });
        assert.equal(storesDonationRouting('legendary-crown', 1, CRAFT_POINTS), null);
    });
    it('halves a structure bonus for an unfed war (1.15 → 1.075, 1 stays 1)', () => {
        assert.equal(unfedStructureMultiplier(1.15), 1.075);
        assert.equal(unfedStructureMultiplier(1), 1);
    });
    it('home loss burns 25% floored', () => {
        assert.equal(homeLossBurn(103), 25);
        assert.equal(homeLossBurn(3), 0);
    });
    it('ledger is capped at 30 newest-last and parses only known kinds', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ at: i, kind: 'war' as const, amount: 1 }));
        const out = appendStoresLedger([], many);
        assert.equal(out.length, STORES_LEDGER_CAP);
        assert.equal(out[0].at, 10);
        assert.deepEqual(parseStoresLedger([{ at: 1, kind: 'bogus', amount: 1 }, { at: 2, kind: 'spoil', amount: 3, ref: 'x' }]), [{ at: 2, kind: 'spoil', amount: 3, ref: 'x' }]);
    });
    it('daily counters key on the UTC day and are monotonic within it', () => {
        const c = { rationsCookedDate: '2026-08-22', rationsCookedToday: 25 };
        assert.equal(dailyCounter(c, 'rationsCookedDate', 'rationsCookedToday', '2026-08-22'), 25);
        assert.equal(dailyCounter(c, 'rationsCookedDate', 'rationsCookedToday', '2026-08-23'), 0);
        const lowered = stampDailyCounter(c, 'rationsCookedDate', 'rationsCookedToday', '2026-08-22', 10);
        assert.equal(lowered.rationsCookedToday, 25);
        const fresh = stampDailyCounter(c, 'rationsCookedDate', 'rationsCookedToday', '2026-08-23', 5);
        assert.equal(fresh.rationsCookedToday, 5);
    });
});
