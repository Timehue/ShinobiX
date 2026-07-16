"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _traces_js_1 = require("./_traces.js");
const shrines_js_1 = require("../../shared/shrines.js");
const NOW = 1_752_600_000_000; // 2025-07-15T18:40Z-ish, fixed for determinism
function sign(name, at, extra = {}) {
    return { id: `id-${name}-${at}`, name, tile: 40, text: 'was here', at, sparks: 0, sparkedBy: [], ...extra };
}
(0, node_test_1.describe)('sector traces — trail signs', () => {
    (0, node_test_1.it)('prunes signs past the 72h TTL', () => {
        const fresh = sign('aki', NOW - 1000);
        const stale = sign('ben', NOW - _traces_js_1.TRAIL_SIGN_TTL_MS - 1);
        strict_1.default.deepEqual((0, _traces_js_1.pruneSigns)([fresh, stale], NOW), [fresh]);
    });
    (0, node_test_1.it)('one active sign per player per sector — posting again replaces yours', () => {
        const first = sign('aki', NOW - 5000);
        const second = sign('aki', NOW);
        const out = (0, _traces_js_1.addSign)([first], second, NOW);
        strict_1.default.equal(out.length, 1);
        strict_1.default.equal(out[0].at, NOW);
    });
    (0, node_test_1.it)('evicts the oldest sign past the per-sector cap', () => {
        let signs = [];
        for (let i = 0; i < _traces_js_1.MAX_SIGNS_PER_SECTOR; i += 1) {
            signs = (0, _traces_js_1.addSign)(signs, sign(`p${i}`, NOW - 1000 * (_traces_js_1.MAX_SIGNS_PER_SECTOR - i)), NOW);
        }
        strict_1.default.equal(signs.length, _traces_js_1.MAX_SIGNS_PER_SECTOR);
        const out = (0, _traces_js_1.addSign)(signs, sign('newest', NOW), NOW);
        strict_1.default.equal(out.length, _traces_js_1.MAX_SIGNS_PER_SECTOR);
        strict_1.default.ok(!out.some((s) => s.name === 'p0'), 'oldest sign should be evicted');
        strict_1.default.ok(out.some((s) => s.name === 'newest'));
    });
    (0, node_test_1.it)('spark: dedupes per player and rejects self-sparks', () => {
        const signs = [sign('aki', NOW - 1000)];
        const own = (0, _traces_js_1.applySpark)(signs, signs[0].id, 'aki', NOW);
        strict_1.default.deepEqual(own, { ok: false, reason: 'own-sign' });
        const first = (0, _traces_js_1.applySpark)(signs, signs[0].id, 'ben', NOW);
        strict_1.default.ok(first.ok && first.sparks === 1);
        const again = (0, _traces_js_1.applySpark)(signs, signs[0].id, 'ben', NOW);
        strict_1.default.deepEqual(again, { ok: false, reason: 'already-sparked' });
        const missing = (0, _traces_js_1.applySpark)(signs, 'nope', 'cho', NOW);
        strict_1.default.deepEqual(missing, { ok: false, reason: 'not-found' });
    });
    (0, node_test_1.it)('parseSigns round-trips valid records and drops junk', () => {
        const good = sign('aki', NOW);
        const parsed = (0, _traces_js_1.parseSigns)([good, null, 'junk', { id: 1 }, { ...sign('ben', NOW), tile: 999 }]);
        strict_1.default.equal(parsed.length, 2);
        strict_1.default.deepEqual(parsed[0], good);
        strict_1.default.equal(parsed[1].tile, 77, 'out-of-range tile clamps to the board default');
    });
});
(0, node_test_1.describe)('sector traces — footfall + sector guard', () => {
    (0, node_test_1.it)('footfall key is per sector per UTC day', () => {
        strict_1.default.equal((0, _traces_js_1.footfallKey)(42, Date.UTC(2026, 6, 16, 12)), 'world:footfall:42:2026-07-16');
    });
    (0, node_test_1.it)('trace sectors are the wild 1-60 only', () => {
        strict_1.default.ok((0, _traces_js_1.isTraceSector)(1) && (0, _traces_js_1.isTraceSector)(60));
        for (const bad of [0, 61, 99, -3, 4.5, NaN, 'x', null])
            strict_1.default.ok(!(0, _traces_js_1.isTraceSector)(bad), `${String(bad)} should be rejected`);
    });
});
(0, node_test_1.describe)('sector shrines', () => {
    (0, node_test_1.it)('shrine config: unique ids, unique sectors, lookups agree', () => {
        strict_1.default.equal(new Set(shrines_js_1.SHRINE_DEFS.map((d) => d.id)).size, shrines_js_1.SHRINE_DEFS.length);
        strict_1.default.equal(new Set(shrines_js_1.SHRINE_DEFS.map((d) => d.sector)).size, shrines_js_1.SHRINE_DEFS.length);
        for (const def of shrines_js_1.SHRINE_DEFS) {
            strict_1.default.equal((0, shrines_js_1.shrineForSector)(def.sector), def);
            strict_1.default.equal((0, shrines_js_1.shrineById)(def.id), def);
        }
        strict_1.default.equal((0, shrines_js_1.shrineForSector)(1), undefined);
    });
    (0, node_test_1.it)('tier thresholds are monotonic and map totals to the right tier', () => {
        for (let i = 1; i < shrines_js_1.SHRINE_TIERS.length; i += 1)
            strict_1.default.ok(shrines_js_1.SHRINE_TIERS[i].at > shrines_js_1.SHRINE_TIERS[i - 1].at);
        strict_1.default.equal((0, shrines_js_1.shrineTier)(0), 0);
        strict_1.default.equal((0, shrines_js_1.shrineTier)(shrines_js_1.SHRINE_TIERS[1].at), 1);
        strict_1.default.equal((0, shrines_js_1.shrineTier)(shrines_js_1.SHRINE_TIERS[1].at - 1), 0);
        strict_1.default.equal((0, shrines_js_1.shrineTier)(Number.MAX_SAFE_INTEGER), shrines_js_1.SHRINE_TIERS.length - 1);
    });
    (0, node_test_1.it)('offerings accumulate per player and sort the weekly board', () => {
        let state = (0, _traces_js_1.parseShrineState)(null);
        state = (0, _traces_js_1.applyOffering)(state, 'aki', 100, NOW);
        state = (0, _traces_js_1.applyOffering)(state, 'ben', 300, NOW);
        state = (0, _traces_js_1.applyOffering)(state, 'aki', 300, NOW);
        strict_1.default.equal(state.total, 700);
        strict_1.default.equal(state.weekTotal, 700);
        strict_1.default.deepEqual(state.topWeek[0], { name: 'aki', amount: 400 });
        strict_1.default.deepEqual(state.topWeek[1], { name: 'ben', amount: 300 });
    });
    (0, node_test_1.it)('weekly board rolls over on ISO-week change, lifetime total persists', () => {
        let state = (0, _traces_js_1.parseShrineState)(null);
        state = (0, _traces_js_1.applyOffering)(state, 'aki', 500, NOW);
        const nextWeek = NOW + 8 * 24 * 60 * 60 * 1000;
        strict_1.default.notEqual((0, _traces_js_1.isoWeekKey)(NOW), (0, _traces_js_1.isoWeekKey)(nextWeek));
        state = (0, _traces_js_1.applyOffering)(state, 'ben', 200, nextWeek);
        strict_1.default.equal(state.total, 700);
        strict_1.default.equal(state.weekTotal, 200);
        strict_1.default.deepEqual(state.topWeek, [{ name: 'ben', amount: 200 }]);
        strict_1.default.equal(state.lastWeek?.week, (0, _traces_js_1.isoWeekKey)(NOW));
        strict_1.default.deepEqual(state.lastWeek?.topWeek[0], { name: 'aki', amount: 500 });
    });
    (0, node_test_1.it)('parseShrineState survives junk without throwing', () => {
        for (const junk of [null, 'x', 42, [], { total: 'NaN', topWeek: 'nope', lastWeek: { week: 5 } }]) {
            const state = (0, _traces_js_1.parseShrineState)(junk);
            strict_1.default.equal(typeof state.total, 'number');
            strict_1.default.deepEqual(state.topWeek, []);
            strict_1.default.equal(state.lastWeek, null);
        }
    });
    (0, node_test_1.it)('isoWeekKey handles year boundaries (ISO week of the Thursday)', () => {
        strict_1.default.equal((0, _traces_js_1.isoWeekKey)(Date.UTC(2026, 0, 1)), '2026-W01'); // Thu 2026-01-01
        strict_1.default.equal((0, _traces_js_1.isoWeekKey)(Date.UTC(2027, 0, 1)), '2026-W53'); // Fri 2027-01-01 → ISO week 53 of 2026
    });
});
