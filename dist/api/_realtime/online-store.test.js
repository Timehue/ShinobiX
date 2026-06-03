"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const online_store_js_1 = require("./online-store.js");
// Deterministic fake clock so staleness is testable without sleeps.
function makeStore(offlineAfterMs = 60_000) {
    let t = 1_000;
    const store = new online_store_js_1.MemoryOnlineStateStore({ offlineAfterMs, now: () => t });
    return { store, advance: (ms) => { t += ms; }, at: () => t };
}
(0, node_test_1.test)('upsert is case-insensitive; get/list reflect it', () => {
    const { store } = makeStore();
    store.upsert({ name: 'Rill', sector: 40, character: { level: 5 } });
    const p = store.get('rill');
    strict_1.default.ok(p, 'lookup is case-insensitive');
    strict_1.default.equal(p.name, 'rill');
    strict_1.default.equal(p.displayName, 'Rill');
    strict_1.default.equal(p.sector, 40);
    strict_1.default.equal(store.list().length, 1);
    strict_1.default.equal(store.size(), 1);
});
(0, node_test_1.test)('upsert preserves pendingAttacker and connectedAt across beats', () => {
    const { store, advance } = makeStore();
    const first = store.upsert({ name: 'rill', sector: 1, character: null });
    strict_1.default.equal(store.setPendingAttacker('rill', { name: 'zayah' }), true);
    advance(2_000);
    const second = store.upsert({ name: 'rill', sector: 2, character: null });
    strict_1.default.equal(second.connectedAt, first.connectedAt, 'connectedAt is stable');
    strict_1.default.deepEqual(second.pendingAttacker, { name: 'zayah' }, 'pendingAttacker survives a refresh');
    strict_1.default.equal(second.sector, 2, 'sector updates');
});
(0, node_test_1.test)('character falls back to the previously-stored slim character', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: { level: 9 } });
    const next = store.upsert({ name: 'rill', sector: 1, character: null });
    strict_1.default.deepEqual(next.character, { level: 9 });
});
(0, node_test_1.test)('stale entries disappear from get/list and are removed by sweepStale', () => {
    const { store, advance } = makeStore(60_000);
    store.upsert({ name: 'rill', sector: 1, character: null });
    strict_1.default.equal(store.list().length, 1);
    advance(60_001); // just past the offline window
    strict_1.default.equal(store.get('rill'), null, 'stale get returns null');
    strict_1.default.equal(store.list().length, 0, 'stale entry excluded from list');
    strict_1.default.equal(store.size(), 1, 'still in the map until swept');
    const removed = store.sweepStale();
    strict_1.default.deepEqual(removed, ['rill']);
    strict_1.default.equal(store.size(), 0, 'swept out of the map');
});
(0, node_test_1.test)('setPendingAttacker returns false for an offline target', () => {
    const { store, advance } = makeStore(60_000);
    store.upsert({ name: 'rill', sector: 1, character: null });
    advance(60_001);
    strict_1.default.equal(store.setPendingAttacker('rill', { name: 'x' }), false, 'cannot queue on a stale target');
    strict_1.default.equal(store.setPendingAttacker('ghost', { name: 'x' }), false, 'cannot queue on an absent target');
});
(0, node_test_1.test)('clearPendingAttacker and setInBattle mutate in place', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null });
    store.setPendingAttacker('rill', { name: 'z' });
    store.clearPendingAttacker('rill');
    strict_1.default.equal(store.get('rill').pendingAttacker, null);
    store.setInBattle('rill', true);
    strict_1.default.equal(store.get('rill').inBattle, true);
    store.setInBattle('rill', false);
    strict_1.default.equal(store.get('rill').inBattle, undefined, 'false clears the flag');
});
(0, node_test_1.test)('remove forgets the player', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null });
    store.remove('RILL');
    strict_1.default.equal(store.get('rill'), null);
    strict_1.default.equal(store.size(), 0);
});
