import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ActivitySpine.tsx", import.meta.url), "utf8");

test("Legacy mastery focus fails closed against live server capability", () => {
    assert.match(source, /legacyFocusAvailable = availability\("legacy"\) === "available"/);
    assert.match(source, /storedFocus === "legacy" && !legacyFocusAvailable \? "auto" : storedFocus/);
    assert.match(source, /MASTERY_FOCUS_OPTIONS\.filter\(\(option\) => option\.id !== "legacy" \|\| legacyFocusAvailable\)/);
    assert.match(source, /if \(next === "legacy" && !legacyFocusAvailable\) return/);
    assert.match(source, /focusOptions\.map\(\(option\) => <option/);
});
