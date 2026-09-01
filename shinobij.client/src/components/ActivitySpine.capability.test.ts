import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ActivitySpine.tsx", import.meta.url), "utf8");

test("Daily Briefing uses automatic focus without rendering mastery controls", () => {
    assert.match(source, /const focus = "auto"/);
    assert.match(source, /focus=\$\{encodeURIComponent\(focus\)\}/);
    assert.doesNotMatch(source, /Mastery focus/);
    assert.doesNotMatch(source, /activity-focus-select/);
    assert.doesNotMatch(source, /<select/);
});
