"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _war_telemetry_js_1 = require("./_war-telemetry.js");
// In-memory kv matching the Pick<kv,'get'|'set'> surface the sink uses.
function memKv() {
    const m = new Map();
    return {
        store: m,
        get: async (k) => (m.has(k) ? m.get(k) : null),
        set: async (k, v) => { m.set(k, v); },
    };
}
(0, node_test_1.test)('villageSlug + warEcoAggKey normalize the display name', () => {
    strict_1.default.equal((0, _war_telemetry_js_1.villageSlug)('Stormveil Village'), 'stormveil-village');
    strict_1.default.equal((0, _war_telemetry_js_1.warEcoAggKey)('Ashen Leaf Village'), 'war:eco:agg:ashen-leaf-village');
});
(0, node_test_1.test)('applyEventToAgg folds amounts additively per kind, ignoring non-positive', () => {
    let agg = {};
    agg = (0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.earn', 100);
    agg = (0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.earn', 50);
    agg = (0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.spend.declare', 250);
    strict_1.default.equal(agg['wr.earn'], 150);
    strict_1.default.equal(agg['wr.spend.declare'], 250);
    // Zero / negative / NaN are no-ops (the kind carries the sign, not the amount).
    strict_1.default.deepEqual((0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.earn', 0), agg);
    strict_1.default.deepEqual((0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.earn', -10), agg);
    strict_1.default.deepEqual((0, _war_telemetry_js_1.applyEventToAgg)(agg, 'wr.earn', Number.NaN), agg);
});
(0, node_test_1.test)('summarizeVillageAgg derives WR + seal faucet/sink/net + tax split', () => {
    const agg = {
        'wr.earn': 1000,
        'wr.spend.declare': 250,
        'wr.spend.maintenance': 120,
        'wr.spend.merc': 60,
        'seals.earn': 800,
        'seals.spend.structure': 300,
        'tax.collect': 500,
        'tax.burn': 250,
        'tax.treasury': 250,
        'dormancy.enter': 1,
        'sector.capture': 3,
    };
    const v = (0, _war_telemetry_js_1.summarizeVillageAgg)(agg);
    strict_1.default.equal(v.wrIn, 1000);
    strict_1.default.equal(v.wrOut, 250 + 120 + 60); // declare + maintenance + merc
    strict_1.default.equal(v.wrNet, 1000 - 430);
    strict_1.default.equal(v.sealsIn, 800);
    strict_1.default.equal(v.sealsOut, 300); // structure upgrades
    strict_1.default.equal(v.sealsNet, 500);
    strict_1.default.equal(v.taxCollected, 500);
    strict_1.default.equal(v.taxBurned, 250);
    strict_1.default.equal(v.taxTreasury, 250);
    strict_1.default.equal(v.maintenancePaid, 120);
    strict_1.default.equal(v.dormancyEnters, 1);
    strict_1.default.equal(v.sectorsCaptured, 3);
});
(0, node_test_1.test)('duplicateEventIds flags a replayed eventId', () => {
    const evs = [
        { eventId: 'declare:5:20260630' },
        { eventId: 'declare:6:20260630' },
        { eventId: 'declare:5:20260630' },
    ];
    strict_1.default.deepEqual((0, _war_telemetry_js_1.duplicateEventIds)(evs), ['declare:5:20260630']);
    strict_1.default.deepEqual((0, _war_telemetry_js_1.duplicateEventIds)([{ eventId: 'a' }]), []);
});
(0, node_test_1.test)('recordWarEcoEvent writes the per-village aggregate + capped list', async () => {
    const kv = memKv();
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'd1', village: 'Stormveil Village', kind: 'wr.spend.declare', amount: 250 }, { kv });
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'e1', village: 'Stormveil Village', kind: 'wr.earn', amount: 80, meta: 'sector:31' }, { kv });
    const agg = (await kv.get((0, _war_telemetry_js_1.warEcoAggKey)('Stormveil Village')));
    strict_1.default.equal(agg['wr.spend.declare'], 250);
    strict_1.default.equal(agg['wr.earn'], 80);
    const list = (await kv.get(_war_telemetry_js_1.WAR_ECO_TXN_LIST_KEY));
    strict_1.default.equal(list.length, 2);
    strict_1.default.equal(list[0].eventId, 'e1'); // newest-first
    strict_1.default.equal(list[0].meta, 'sector:31');
    strict_1.default.equal(list[1].eventId, 'd1');
});
(0, node_test_1.test)('recordWarEcoEvent is a best-effort no-op on bad input (never throws)', async () => {
    const kv = memKv();
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'x', village: 'Stormveil Village', kind: 'not-a-kind', amount: 50 }, { kv });
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'x', village: 'Stormveil Village', kind: 'wr.earn', amount: 0 }, { kv });
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'x', village: '', kind: 'wr.earn', amount: 50 }, { kv });
    strict_1.default.equal(kv.store.size, 0); // nothing written for any invalid event
});
(0, node_test_1.test)('readWarEcoSnapshot returns per-village views + recent + dup flags', async () => {
    const kv = memKv();
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'a', village: 'Frostfang Village', kind: 'wr.earn', amount: 200 }, { kv });
    await (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: 'b', village: 'Frostfang Village', kind: 'wr.spend.merc', amount: 75 }, { kv });
    // A village with no events is omitted from the snapshot.
    const snap = await (0, _war_telemetry_js_1.readWarEcoSnapshot)(['Frostfang Village', 'Moonshadow Village'], 50, { kv });
    strict_1.default.ok(snap.villages['Frostfang Village']);
    strict_1.default.equal(snap.villages['Frostfang Village'].wrIn, 200);
    strict_1.default.equal(snap.villages['Frostfang Village'].wrOut, 75);
    strict_1.default.equal(snap.villages['Frostfang Village'].wrNet, 125);
    strict_1.default.equal(snap.villages['Moonshadow Village'], undefined);
    strict_1.default.equal(snap.recent.length, 2);
    strict_1.default.deepEqual(snap.duplicateEventIds, []);
});
