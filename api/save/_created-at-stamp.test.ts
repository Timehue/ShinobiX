import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';

/*
 * character.createdAt is the anti-alt reference for every 72 h rule (PvP
 * credit, hunt Fate Shards, the outbound transfer tier). The first save used to
 * keep the client's value, so a modded client could send createdAt: 1 and read
 * as years old on its first day. The server now stamps it and never takes it
 * from the client; once stamped it stays immutable.
 */

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function character(extra: Record<string, unknown> = {}) {
    return { name: 'Newcomer', village: 'Ember', level: 1, ryo: 100, stats: {}, unspentStats: 0, ...extra };
}

describe('createdAt is server-stamped', () => {
    it('a first save carrying createdAt: 1 is stored as now', () => {
        const out = sanitizeCharacterSave({ character: character({ createdAt: 1 }) }, null, { now: NOW });
        assert.equal((out.character as Record<string, unknown>).createdAt, NOW);
    });

    it('a first save without one is stamped now', () => {
        const out = sanitizeCharacterSave({ character: character() }, null, { now: NOW });
        assert.equal((out.character as Record<string, unknown>).createdAt, NOW);
    });

    it('a stored stamp is immutable: the client can neither age nor renew it', () => {
        const stored = NOW - 10 * 24 * 60 * 60 * 1000;
        const existing = { _saveVersion: 3, character: character({ createdAt: stored }) };
        for (const forged of [1, NOW, undefined]) {
            const out = sanitizeCharacterSave({ character: character({ createdAt: forged }) }, existing, { now: NOW });
            assert.equal((out.character as Record<string, unknown>).createdAt, stored, `forged ${forged}`);
        }
    });

    it('a stored save that never got a stamp is stamped now, not with the client value', () => {
        const existing = { _saveVersion: 3, character: character() };
        const out = sanitizeCharacterSave({ character: character({ createdAt: 1 }) }, existing, { now: NOW });
        assert.equal((out.character as Record<string, unknown>).createdAt, NOW);
    });
});
