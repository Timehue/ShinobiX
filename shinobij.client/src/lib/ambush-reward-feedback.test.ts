import assert from "node:assert/strict";
import test from "node:test";
import { ambushRewardFailureMessage } from "./ambush-reward-feedback";

test("ambush refusals distinguish a saved daily-cap reward from missing combat evidence", () => {
    const capped = ambushRewardFailureMessage({ reason: "daily-cap" }, 200);
    assert.match(capped, /Daily ambush reward limit/);
    assert.match(capped, /midnight UTC/);
    assert.match(capped, /pending reward/);
    const incomplete = ambushRewardFailureMessage({ reason: "incomplete" }, 200);
    assert.match(incomplete, /all four ambush victories/);
    assert.doesNotMatch(incomplete, /syncing|warlord is down/i);
    assert.equal(ambushRewardFailureMessage({ reason: "none" }, 200), "No unclaimed ambush reward was found.");
});

test("ambush auth and server failures retain their actual explanation", () => {
    assert.match(ambushRewardFailureMessage({ error: "Authentication required." }, 401), /Sign in again/);
    const error = "The reward is safe, but its Legacy record is pending.";
    assert.equal(ambushRewardFailureMessage({ error }, 503), error);
    assert.match(ambushRewardFailureMessage(null, 200), /could not be confirmed/);
    assert.match(ambushRewardFailureMessage(), /Reopen the World Map to retry/);
});
