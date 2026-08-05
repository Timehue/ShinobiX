import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { newSectorState, operationPressureReduction } from './_sector-state.js';
import { CLAN_BOSSES } from './_storage.js';

describe('Clan Boss sector pressure', () => {
    it('uses canonical world sector metadata without mutating ownership state', () => {
        const state = newSectorState('2026-W32', CLAN_BOSSES[0]!, 1);
        assert.equal(state.sectorId, 66);
        assert.equal(state.sectorName, 'Emberspine Ridge');
        assert.equal(state.pressure, 100);
    });

    it('requires active contribution and caps per-run pressure reduction', () => {
        const inactive = { actions: 0, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0, score: 0, active: false, survived: false, threshold: 'none' as const };
        const active = { ...inactive, actions: 1, damage: 100, score: 60, active: true, threshold: 'field' as const };
        assert.equal(operationPressureReduction(10_000, { a: inactive }), 0);
        assert.ok(operationPressureReduction(10_000, { a: active }) > 0);
        assert.equal(operationPressureReduction(1_000_000, { a: active, b: active, c: active, d: active }), 8);
    });
});

