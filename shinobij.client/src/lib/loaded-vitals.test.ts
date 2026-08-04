import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeLoadedVital } from "./loaded-vitals";

test("loading a stale maximum preserves an authoritative combat remainder", () => {
    assert.deepEqual(normalizeLoadedVital(30, 100, 500), {
        current: 30,
        maximum: 500,
    });
});

test("loading vitals clamps malformed and over-cap values without inventing healing", () => {
    assert.deepEqual(normalizeLoadedVital(-20, 100, 500), { current: 0, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(900, 100, 500), { current: 500, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(undefined, undefined, 500), { current: 500, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(250, 800, 500), { current: 250, maximum: 800 });
});
