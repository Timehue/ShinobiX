/**
 * Guards the server-side daily-agenda seeding port and completion gate
 * (api/_village-agenda.ts) used by claim-daily-agenda.ts.
 *
 *   - seededVillageAgenda must mirror the client's makeVillageDailyAgenda.
 *   - verifyAgendaCompletion must reject when the authoritative "control" task is
 *     seeded but unmet, pass when it is met, and never reward client counters.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { seededVillageAgenda, verifyAgendaCompletion, VILLAGE_AGENDA_POOL } from './_village-agenda.js';

const POOL_KINDS = new Set(VILLAGE_AGENDA_POOL.map((t) => t.kind));
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];

describe('seededVillageAgenda', () => {
    it('returns the server-verifiable task drawn from the pool', () => {
        const tasks = seededVillageAgenda('Stormveil Village', '2026-06-16');
        assert.equal(tasks.length, VILLAGE_AGENDA_POOL.length);
        const kinds = tasks.map((t) => t.kind);
        assert.equal(new Set(kinds).size, kinds.length, 'tasks are distinct');
        for (const k of kinds) assert.ok(POOL_KINDS.has(k), `${k} is a real pool kind`);
    });

    it('is deterministic for the same village + date', () => {
        const a = seededVillageAgenda('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        const b = seededVillageAgenda('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        assert.deepEqual(a, b);
    });

    it('contains only control tasks until server ledgers exist for client counters', () => {
        for (const v of VILLAGES) {
            for (const d of ['2026-06-16', '2026-06-17', '2026-06-18']) {
                assert.deepEqual(seededVillageAgenda(v, d).map((t) => t.kind), ['control']);
            }
        }
    });
});

describe('verifyAgendaCompletion', () => {
    it('rejects the claim when "control" is seeded but the village holds 0 sectors', () => {
        const r = verifyAgendaCompletion(['missions', 'control', 'pet'], 0);
        assert.equal(r.ok, false);
    });

    it('passes when "control" is seeded and the village holds >= 1 sector', () => {
        const r = verifyAgendaCompletion(['missions', 'control', 'pet'], 1);
        assert.equal(r.ok, true);
    });

    it('does not include client-counter kinds in the rewardable agenda pool', () => {
        assert.deepEqual(VILLAGE_AGENDA_POOL.map((task) => task.kind), ['control']);
    });
});
