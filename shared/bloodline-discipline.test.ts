import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bloodlineDisciplineCounts, isCombatDiscipline, leadingBloodlineDiscipline } from './bloodline-discipline.js';

describe('stored bloodline discipline types', () => {
    it('accepts only primitive discipline strings without coercing stored JSON', () => {
        for (const value of ['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu']) {
            assert.equal(isCombatDiscipline(value), true);
            assert.equal(isCombatDiscipline([value]), false);
            assert.equal(isCombatDiscipline({ toString: () => value }), false);
        }
        for (const value of [null, undefined, 0, {}, [], 'Any', 'Medical']) {
            assert.equal(isCombatDiscipline(value), false);
        }
    });

    it('ignores array-valued types before resolving a tied discipline', () => {
        const counts = bloodlineDisciplineCounts({ jutsus: [
            { type: 'Ninjutsu', effectPower: 40, ap: 60 },
            { type: ['Bukijutsu'], effectPower: 40, ap: 60 },
            { type: 'Genjutsu', effectPower: 40, ap: 60 },
        ] });
        assert.equal(leadingBloodlineDiscipline(counts, 'Any'), 'Genjutsu');
        assert.deepEqual([...counts], [['Ninjutsu', 1], ['Genjutsu', 1]]);
        assert.equal(leadingBloodlineDiscipline(counts, 'Ninjutsu'), 'Ninjutsu');
    });
});
