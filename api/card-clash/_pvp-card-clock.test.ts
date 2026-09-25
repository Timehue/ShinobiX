import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Every PvP card duel host runs the SAME clock: shared/chronicle-duel.ts
 * advanceExpiredChronicleTurn, which passes expired turns and forfeits a duelist
 * who misses two in a row. The three hosts used to carry three copies of a pass
 * loop with no walk-out rule, so this pins each one to the shared function and
 * refuses a local copy coming back. The rule itself is tested in
 * _chronicle-engine.test.ts, and end to end for Free Play in match.test.ts.
 */
const HOSTS = [
    "api/card-clash/match.ts",   // Free Play and the Dojo Circuit card trial
    "api/clan/war/tilecards.ts", // Clan War tile duels
    "api/village/sector-card.ts", // Sector War tables
];

test("every PvP card host runs the shared missed-turn clock and keeps no copy of its own", () => {
    for (const host of HOSTS) {
        // process.cwd(): api tests also compile into the CommonJS server build.
        const source = readFileSync(join(process.cwd(), host), "utf8");
        assert.match(source, /advanceExpiredChronicleTurn\(/, `${host} must run the shared clock`);
        assert.doesNotMatch(source, /TURN_TIMEOUT_MS/, `${host} must not time turns itself`);
        assert.doesNotMatch(source, /safety\s*<\s*5/, `${host} must not carry its own turn-pass loop`);
    }
});
