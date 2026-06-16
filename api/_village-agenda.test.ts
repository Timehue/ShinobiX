/**
 * Guards the server-side daily-agenda seeding port + the verifiable-subset
 * completion gate (api/_village-agenda.ts) used by claim-daily-agenda.ts.
 *
 *   - seededVillageAgenda must mirror the client's makeVillageDailyAgenda so the
 *     server re-derives the SAME 3 tasks (deterministic, distinct, from the pool).
 *   - verifyAgendaCompletion must reject when the authoritative "control" task is
 *     seeded but unmet, pass when it's met, and never block on the trusted kinds.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { seededVillageAgenda, verifyAgendaCompletion, VILLAGE_AGENDA_POOL } from './_village-agenda.js';

const POOL_KINDS = new Set(VILLAGE_AGENDA_POOL.map((t) => t.kind));
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];

describe('seededVillageAgenda', () => {
    it('returns exactly 3 distinct tasks drawn from the pool', () => {
        const tasks = seededVillageAgenda('Stormveil Village', '2026-06-16');
        assert.equal(tasks.length, 3);
        const kinds = tasks.map((t) => t.kind);
        assert.equal(new Set(kinds).size, 3, 'the 3 tasks are distinct');
        for (const k of kinds) assert.ok(POOL_KINDS.has(k), `${k} is a real pool kind`);
    });

    it('is deterministic for the same village + date', () => {
        const a = seededVillageAgenda('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        const b = seededVillageAgenda('Ashen Leaf Village', '2026-06-16').map((t) => t.kind);
        assert.deepEqual(a, b);
    });

    it('varies across villages/dates (not a constant set)', () => {
        const seen = new Set<string>();
        for (const v of VILLAGES) {
            for (const d of ['2026-06-16', '2026-06-17', '2026-06-18']) {
                seen.add(seededVillageAgenda(v, d).map((t) => t.kind).join(','));
            }
        }
        assert.ok(seen.size > 1, 'seeding produces more than one distinct task set');
    });
});

describe('verifyAgendaCompletion (verifiable subset)', () => {
    it('rejects the claim when "control" is seeded but the village holds 0 sectors', () => {
        const r = verifyAgendaCompletion(['missions', 'control', 'pet'], 0);
        assert.equal(r.ok, false);
    });

    it('passes when "control" is seeded and the village holds >= 1 sector', () => {
        const r = verifyAgendaCompletion(['missions', 'control', 'pet'], 1);
        assert.equal(r.ok, true);
    });

    it('does not block on the trusted kinds when "control" is not in today\'s set', () => {
        // missions/explore/pet are client-trusted — even with 0 held sectors the
        // gate must pass (the hole here is documented TODO, not a false reject).
        assert.equal(verifyAgendaCompletion(['missions', 'explore', 'pet'], 0).ok, true);
    });
});
