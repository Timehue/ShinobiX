import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ActivitySpine.tsx", import.meta.url), "utf8");

test("Daily Briefing preserves the saved server focus without rendering mastery controls", () => {
    assert.match(source, /useActivitySpine\(character\.name, undefined,/);
    assert.doesNotMatch(source, /const focus = "auto"/);
    const request = readFileSync(new URL("../lib/activity-spine-request.ts", import.meta.url), "utf8");
    assert.match(request, /if \(focus\) query\.set\('focus', focus\)/);
    assert.doesNotMatch(source, /Mastery focus/);
    assert.doesNotMatch(source, /activity-focus-select/);
    assert.doesNotMatch(source, /<select/);
});
