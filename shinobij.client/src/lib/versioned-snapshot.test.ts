import { strict as assert } from "node:assert";
import test from "node:test";
import { acceptVersionedSnapshot } from "./versioned-snapshot";

function finalSnapshot(responses: Array<{ version?: number; value: string }>): string | null {
    let version = 0;
    let value: string | null = null;
    for (const response of responses) {
        const decision = acceptVersionedSnapshot(version, response.version);
        version = decision.latestVersion;
        if (decision.accepted) value = response.value;
    }
    return value;
}

test("the newest character wins regardless of concurrent response order", () => {
    assert.equal(finalSnapshot([
        { version: 5, value: "physical-outcome" },
        { version: 6, value: "queued-claim" },
    ]), "queued-claim");
    assert.equal(finalSnapshot([
        { version: 6, value: "queued-claim" },
        { version: 5, value: "physical-outcome" },
    ]), "queued-claim");
});

test("unversioned legacy snapshots cannot replace established versioned state", () => {
    assert.equal(finalSnapshot([{ value: "legacy-first" }]), "legacy-first");
    assert.equal(finalSnapshot([
        { version: 9, value: "current" },
        { value: "legacy-late" },
    ]), "current");
});
