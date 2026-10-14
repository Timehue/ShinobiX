import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const hall = readFileSync(new URL("./HallOfLegends.tsx", import.meta.url), "utf8");

test("Hall of Legends rows use one module-scope component, not a per-render inner one", () => {
    // A component declared inside HallOfLegends is a new type on every render,
    // so React unmounted and remounted every leaderboard row each time the
    // screen re-rendered. The row lives at module scope and takes `me` as a prop.
    assert.match(hall, /^function HolRow\(\{ me, /m);
    assert.doesNotMatch(hall, /^[ \t]+function \w*Row\(/m);
    assert.doesNotMatch(hall, /<Row\b/);
    // Every row is told who the viewer is, so the "hol-row-me" highlight keeps
    // working without the closure.
    const rows = (hall.match(/<HolRow\b/g) ?? []).length;
    assert.ok(rows > 0);
    assert.equal((hall.match(/<HolRow\s+me=\{me\}/g) ?? []).length, rows);
});
