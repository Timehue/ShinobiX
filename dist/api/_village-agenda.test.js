"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Guards the server-side daily-agenda seeding port and completion gate
 * (api/_village-agenda.ts) used by claim-daily-agenda.ts.
 *
 *   - seededVillageAgenda must mirror the client's makeVillageDailyAgenda.
 *   - verifyAgendaCompletion must reject when the authoritative "control" task is
 *     seeded but unmet, pass when it is met, and never reward client counters.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _village_agenda_js_1 = require("./_village-agenda.js");
const POOL_KINDS = new Set(_village_agenda_js_1.VILLAGE_AGENDA_POOL.map((t) => t.kind));
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
(0, node_test_1.describe)('seededVillageAgenda', () => {
    (0, node_test_1.it)('returns the server-verifiable task drawn from the pool', () => {
        const tasks = (0, _village_agenda_js_1.seededVillageAgenda)('Stormveil Village', '2026-06-16');
        node_assert_1.strict.equal(tasks.length, _village_agenda_js_1.VILLAGE_AGENDA_POOL.length);
        const kinds = tasks.map((t) => t.kind);
        node_assert_1.strict.equal(new Set(kinds).size, kinds.length, 'tasks are distinct');
        for (const k of kinds)
            node_assert_1.strict.ok(POOL_KINDS.has(k), `${k} is a real pool kind`);
    });
    (0, node_test_1.it)('is deterministic for the same village + date', () => {
        const a = (0, _village_agenda_js_1.seededVillageAgenda)('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        const b = (0, _village_agenda_js_1.seededVillageAgenda)('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        node_assert_1.strict.deepEqual(a, b);
    });
    (0, node_test_1.it)('contains only control tasks until server ledgers exist for client counters', () => {
        for (const v of VILLAGES) {
            for (const d of ['2026-06-16', '2026-06-17', '2026-06-18']) {
                node_assert_1.strict.deepEqual((0, _village_agenda_js_1.seededVillageAgenda)(v, d).map((t) => t.kind), ['control']);
            }
        }
    });
});
(0, node_test_1.describe)('verifyAgendaCompletion', () => {
    (0, node_test_1.it)('rejects the claim when "control" is seeded but the village holds 0 sectors', () => {
        const r = (0, _village_agenda_js_1.verifyAgendaCompletion)(['missions', 'control', 'pet'], 0);
        node_assert_1.strict.equal(r.ok, false);
    });
    (0, node_test_1.it)('passes when "control" is seeded and the village holds >= 1 sector', () => {
        const r = (0, _village_agenda_js_1.verifyAgendaCompletion)(['missions', 'control', 'pet'], 1);
        node_assert_1.strict.equal(r.ok, true);
    });
    (0, node_test_1.it)('does not include client-counter kinds in the rewardable agenda pool', () => {
        node_assert_1.strict.deepEqual(_village_agenda_js_1.VILLAGE_AGENDA_POOL.map((task) => task.kind), ['control']);
    });
});
