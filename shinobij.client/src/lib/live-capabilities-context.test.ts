import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

test("live capability command readers stay stable while reading the current snapshot", () => {
    const source = readFileSync(new URL("./live-capabilities-context.ts", import.meta.url), "utf8");

    assert.match(source, /const availability = useCallback\([\s\S]*store\.getSnapshot\(\)[\s\S]*\[store\]/);
    assert.match(source, /const viewAvailability = useCallback\([\s\S]*store\.getSnapshot\(\)[\s\S]*\[store\]/);
    assert.match(source, /const mutationAvailability = useCallback\([\s\S]*store\.getSnapshot\(\)[\s\S]*\[store\]/);
    assert.match(source, /\[availability, mutationAvailability, snapshot, store, viewAvailability\]/);
    assert.doesNotMatch(source, /capability(?:Mutation|View)?Availability\(snapshot,/,
        "snapshot publications must not recreate functions consumed by polling effects");
});
