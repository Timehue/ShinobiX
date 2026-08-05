import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { operationProfessionXp } from './_profession.js';
import type { ClanBossContributionResult } from '../../shared/clan-boss-operation.js';

const base: ClanBossContributionResult = { actions: 5, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0, score: 250, active: true, survived: true, threshold: 'veteran' };

describe('operation profession XP', () => {
    it('rewards role-relevant support, offense, and objective/survival within the bounded grant', () => {
        assert.ok(operationProfessionXp('healer', { ...base, healing: 2_000, cleanses: 2 }) > 90);
        assert.ok(operationProfessionXp('vanguard', { ...base, damage: 8_000, objective: 1 }) > 90);
        assert.ok(operationProfessionXp('petTamer', { ...base, objective: 1 }) > 90);
        assert.ok(operationProfessionXp('healer', { ...base, threshold: 'elite' }) <= 150);
    });

    it('pays no XP to AFK or unknown professions', () => {
        assert.equal(operationProfessionXp('healer', { ...base, active: false, threshold: 'none' }), 0);
        assert.equal(operationProfessionXp('unknown', base), 0);
    });
});

