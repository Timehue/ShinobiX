import assert from "node:assert/strict";
import test from "node:test";
import { SPIRE_BOSS_META } from "./spire-catalog";

test("Spire lobby profiles mirror server target selection and strike cadence", () => {
    assert.deepEqual(
        Object.fromEntries(Object.entries(SPIRE_BOSS_META).map(([key, boss]) => [key, {
            targetMode: boss.targetMode,
            kind: boss.strike.kind,
            everyRounds: boss.strike.everyRounds,
            firstRound: boss.strike.firstRound,
            radius: boss.strike.radius,
        }])),
        {
            warden: { targetMode: "squishiest", kind: "slam", everyRounds: 4, firstRound: 4, radius: 1 },
            revenant: { targetMode: "support", kind: "volley", everyRounds: 4, firstRound: 4, radius: 1 },
            ravager: { targetMode: "lowest-hp", kind: "nova", everyRounds: 4, firstRound: 4, radius: 1 },
            sovereign: { targetMode: "lowest-hp", kind: "nova", everyRounds: 3, firstRound: 3, radius: 1 },
        },
    );
});
