"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const session_js_1 = require("./session.js");
// P0.1 sub-2 — the server stamps a bloodline's rank onto its jutsu in
// resolveEquippedLoadout so combat (move.ts woundCapForJutsu / ampTagCapForRank)
// applies the correct per-rank caps. Authoritative: rank comes from the save's
// bloodline OBJECT, never the client. PERMANENTLY ON (owner decision 2026-07-11 —
// the old BLOODLINE_RANK_CAPS env flag is retired; the client PvE path already
// stamped bloodlineRank unconditionally, so this closes a PvE<->PvP parity gap).
// Every test runs with the retired env var explicitly CLEARED to prove the stamp
// cannot be switched off.
(0, node_test_1.describe)('resolveEquippedLoadout — bloodline rank stamp (permanent)', () => {
    const save = {
        savedBloodlines: [
            { rank: 'S Rank', jutsus: [{ id: 'bl-nuke', name: 'Nuke', tags: [{ name: 'Wound', percent: 35 }] }] },
        ],
    };
    const saveChar = { equippedJutsuIds: ['bl-nuke'] };
    /** Run with the retired env flag explicitly CLEARED — the stamp must not depend on it. */
    function withFlagCleared(fn) {
        const prev = process.env.BLOODLINE_RANK_CAPS;
        delete process.env.BLOODLINE_RANK_CAPS;
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
    (0, node_test_1.it)('stamps bloodlineRank from the bloodline object even with the retired env flag cleared', () => {
        withFlagCleared(() => {
            const out = (0, session_js_1.resolveEquippedLoadout)(saveChar, save, {});
            node_assert_1.strict.equal(out.length, 1);
            node_assert_1.strict.equal(out[0].bloodlineRank, 'S Rank');
        });
    });
    (0, node_test_1.it)('never trusts a client-supplied rank (stamp is from the save bloodline)', () => {
        withFlagCleared(() => {
            // Client tries to assert "S Rank" on a jutsu whose save bloodline is B.
            const bSave = { savedBloodlines: [{ rank: 'B Rank', jutsus: [{ id: 'bl-x', name: 'X', tags: [] }] }] };
            const client = { jutsu: [{ id: 'bl-x', name: 'X', tags: [], bloodlineRank: 'S Rank' }] };
            const out = (0, session_js_1.resolveEquippedLoadout)({ equippedJutsuIds: ['bl-x'] }, bSave, client);
            node_assert_1.strict.equal(out[0].bloodlineRank, 'B Rank');
        });
    });
});
