import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adoptSaveVersion } from "./save-version";

describe("server mutation save versions", () => {
    it("adopts a newer story-settlement version", () => {
        assert.equal(adoptSaveVersion(41, 42), 42);
    });

    it("does not regress or corrupt the current version", () => {
        assert.equal(adoptSaveVersion(42, 41), 42);
        assert.equal(adoptSaveVersion(42, undefined), 42);
        assert.equal(adoptSaveVersion(42, Number.NaN), 42);
    });
});
