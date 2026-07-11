import { test } from "node:test";
import assert from "node:assert/strict";
import { warCrateServerAuthEnabled, setWarCrateServerAuthEnabled } from "./war-crate-flag.ts";

test("warCrateServerAuth: locked ON and cannot be downgraded by the client", () => {
    assert.equal(warCrateServerAuthEnabled(), true);
    setWarCrateServerAuthEnabled(false);
    assert.equal(warCrateServerAuthEnabled(), true);
    setWarCrateServerAuthEnabled(true);
    assert.equal(warCrateServerAuthEnabled(), true);
});
