"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Guards the server-side daily-agenda seeding port + the verifiable-subset
 * completion gate (api/_village-agenda.ts) used by claim-daily-agenda.ts.
 *
 *   - seededVillageAgenda must mirror the client's makeVillageDailyAgenda so the
 *     server re-derives the SAME 3 tasks (deterministic, distinct, from the pool).
 *   - verifyAgendaCompletion must reject when the authoritative "control" task is
 *     seeded but unmet, pass when it's met, and never block on the trusted kinds.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _village_agenda_js_1 = require("./_village-agenda.js");
const POOL_KINDS = new Set(_village_agenda_js_1.VILLAGE_AGENDA_POOL.map((t) => t.kind));
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
(0, node_test_1.describe)('seededVillageAgenda', () => {
    (0, node_test_1.it)('returns exactly 3 distinct tasks drawn from the pool', () => {
        const tasks = (0, _village_agenda_js_1.seededVillageAgenda)('Stormveil Village', '2026-06-16');
        node_assert_1.strict.equal(tasks.length, 3);
        const kinds = tasks.map((t) => t.kind);
        node_assert_1.strict.equal(new Set(kinds).size, 3, 'the 3 tasks are distinct');
        for (const k of kinds)
            node_assert_1.strict.ok(POOL_KINDS.has(k), `${k} is a real pool kind`);
    });
    (0, node_test_1.it)('is deterministic for the same village + date', () => {
        const a = (0, _village_agenda_js_1.seededVillageAgenda)('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        const b = (0, _village_agenda_js_1.seededVillageAgenda)('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        node_assert_1.strict.deepEqual(a, b);
    });
    (0, node_test_1.it)('varies across villages/dates (not a constant set)', () => {
        const seen = new Set();
        for (const v of VILLAGES) {
            for (const d of ['2026-06-16', '2026-06-17', '2026-06-18']) {
                seen.add((0, _village_agenda_js_1.seededVillageAgenda)(v, d).map((t) => t.kind).join(','));
            }
        }
        node_assert_1.strict.ok(seen.size > 1, 'seeding produces more than one distinct task set');
    });
});
(0, node_test_1.describe)('verifyAgendaCompletion (verifiable subset)', () => {
    (0, node_test_1.it)('rejects the claim when "control" is seeded but the village holds 0 sectors', () => {
        const r = (0, _village_agenda_js_1.verifyAgendaCompletion)(['missions', 'control', 'pet'], 0);
        node_assert_1.strict.equal(r.ok, false);
    });
    (0, node_test_1.it)('passes when "control" is seeded and the village holds >= 1 sector', () => {
        const r = (0, _village_agenda_js_1.verifyAgendaCompletion)(['missions', 'control', 'pet'], 1);
        node_assert_1.strict.equal(r.ok, true);
    });
    (0, node_test_1.it)('does not block on the trusted kinds when "control" is not in today\'s set', () => {
        // missions/explore/pet are client-trusted — even with 0 held sectors the
        // gate must pass (the hole here is documented TODO, not a false reject).
        node_assert_1.strict.equal((0, _village_agenda_js_1.verifyAgendaCompletion)(['missions', 'explore', 'pet'], 0).ok, true);
    });
});
