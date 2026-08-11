import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fight = readFileSync(new URL("./screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const harness = readFileSync(new URL("./towerfx.tsx", import.meta.url), "utf8");

test("Tower fight state transport is injectable without changing the production default", () => {
    assert.match(fight, /stateFn = fetchTowerState/);
    assert.match(fight, /stateFn\?: typeof fetchTowerState/);
    assert.equal(fight.match(/stateFn\(runId, me, controller\.signal\)/g)?.length, 2,
        "initial recovery and active polling must share the injected state transport");
    assert.match(harness, /stateFn=\{async \(\) => session\}/);
    assert.match(harness, /actionFn=\{async \(\) => \(\{ applied: false, reason: "dev-preview"/);
});
