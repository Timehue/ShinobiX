import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveEquippedLoadout } from './session.js';

// P0.1 sub-2 — the server stamps a bloodline's rank onto its jutsu in
// resolveEquippedLoadout so combat (move.ts woundCapForJutsu / ampTagCapForRank)
// applies the correct per-rank caps. Authoritative: rank comes from the save's
// bloodline OBJECT, never the client. Gated by BLOODLINE_RANK_CAPS so the small
// A/S cap lift rolls out deliberately; flag-off must be byte-identical to today.
describe('resolveEquippedLoadout — bloodline rank stamp (BLOODLINE_RANK_CAPS)', () => {
    const save = {
        savedBloodlines: [
            { rank: 'S Rank', jutsus: [{ id: 'bl-nuke', name: 'Nuke', tags: [{ name: 'Wound', percent: 35 }] }] },
        ],
    };
    const saveChar = { equippedJutsuIds: ['bl-nuke'] };

    function withFlag(value: string | undefined, fn: () => void) {
        const prev = process.env.BLOODLINE_RANK_CAPS;
        if (value === undefined) delete process.env.BLOODLINE_RANK_CAPS;
        else process.env.BLOODLINE_RANK_CAPS = value;
        try { fn(); } finally {
            if (prev === undefined) delete process.env.BLOODLINE_RANK_CAPS;
            else process.env.BLOODLINE_RANK_CAPS = prev;
        }
    }

    it('stamps bloodlineRank from the bloodline object when the flag is ON', () => {
        withFlag('1', () => {
            const out = resolveEquippedLoadout(saveChar, save, {}) as Array<Record<string, unknown>>;
            assert.equal(out.length, 1);
            assert.equal(out[0]!.bloodlineRank, 'S Rank');
        });
    });

    it('does NOT stamp when the flag is OFF (byte-identical to today)', () => {
        withFlag(undefined, () => {
            const out = resolveEquippedLoadout(saveChar, save, {}) as Array<Record<string, unknown>>;
            assert.equal(out.length, 1);
            assert.equal('bloodlineRank' in out[0]!, false);
        });
    });

    it('never trusts a client-supplied rank (stamp is from the save bloodline)', () => {
        withFlag('1', () => {
            // Client tries to assert "S Rank" on a jutsu whose save bloodline is B.
            const bSave = { savedBloodlines: [{ rank: 'B Rank', jutsus: [{ id: 'bl-x', name: 'X', tags: [] }] }] };
            const client = { jutsu: [{ id: 'bl-x', name: 'X', tags: [], bloodlineRank: 'S Rank' }] };
            const out = resolveEquippedLoadout({ equippedJutsuIds: ['bl-x'] }, bSave, client) as Array<Record<string, unknown>>;
            assert.equal(out[0]!.bloodlineRank, 'B Rank');
        });
    });
});
