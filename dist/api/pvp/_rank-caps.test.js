"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const session_js_1 = require("./session.js");
// P0.1 sub-2 — the server stamps a bloodline's rank onto its jutsu in
// resolveEquippedLoadout so combat (move.ts woundCapForJutsu / ampTagCapForRank)
// applies the correct per-rank caps. Authoritative: rank comes from the save's
// bloodline OBJECT, never the client. Gated by BLOODLINE_RANK_CAPS so the small
// A/S cap lift rolls out deliberately; flag-off must be byte-identical to today.
(0, node_test_1.describe)('resolveEquippedLoadout — bloodline rank stamp (BLOODLINE_RANK_CAPS)', () => {
    const save = {
        savedBloodlines: [
            { rank: 'S Rank', jutsus: [{ id: 'bl-nuke', name: 'Nuke', tags: [{ name: 'Wound', percent: 35 }] }] },
        ],
    };
    const saveChar = { equippedJutsuIds: ['bl-nuke'] };
    function withFlag(value, fn) {
        const prev = process.env.BLOODLINE_RANK_CAPS;
        if (value === undefined)
            delete process.env.BLOODLINE_RANK_CAPS;
        else
            process.env.BLOODLINE_RANK_CAPS = value;
        try {
            fn();
        }
        finally {
            if (prev === undefined)
                delete process.env.BLOODLINE_RANK_CAPS;
            else
                process.env.BLOODLINE_RANK_CAPS = prev;
        }
    }
    (0, node_test_1.it)('stamps bloodlineRank from the bloodline object when the flag is ON', () => {
        withFlag('1', () => {
            const out = (0, session_js_1.resolveEquippedLoadout)(saveChar, save, {});
            node_assert_1.strict.equal(out.length, 1);
            node_assert_1.strict.equal(out[0].bloodlineRank, 'S Rank');
        });
    });
    (0, node_test_1.it)('does NOT stamp when the flag is OFF (byte-identical to today)', () => {
        withFlag(undefined, () => {
            const out = (0, session_js_1.resolveEquippedLoadout)(saveChar, save, {});
            node_assert_1.strict.equal(out.length, 1);
            node_assert_1.strict.equal('bloodlineRank' in out[0], false);
        });
    });
    (0, node_test_1.it)('never trusts a client-supplied rank (stamp is from the save bloodline)', () => {
        withFlag('1', () => {
            // Client tries to assert "S Rank" on a jutsu whose save bloodline is B.
            const bSave = { savedBloodlines: [{ rank: 'B Rank', jutsus: [{ id: 'bl-x', name: 'X', tags: [] }] }] };
            const client = { jutsu: [{ id: 'bl-x', name: 'X', tags: [], bloodlineRank: 'S Rank' }] };
            const out = (0, session_js_1.resolveEquippedLoadout)({ equippedJutsuIds: ['bl-x'] }, bSave, client);
            node_assert_1.strict.equal(out[0].bloodlineRank, 'B Rank');
        });
    });
});
