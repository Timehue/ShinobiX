import assert from "node:assert/strict";
import { test } from "node:test";
import { logoutSaveFailure } from "./logout-save-failure";
import { SaveConflictError, SaveRateLimitError } from "./save-persistence";

test("logout recovery rounds the server pause up and offers an explicit way to remain signed in", () => {
    for (const [milliseconds, advice] of [[0, "1 second"], [999, "1 second"], [2501, "3 seconds"]] as const) {
        const failure = logoutSaveFailure(new SaveRateLimitError(milliseconds));
        assert.ok(failure.message.includes(`wait about ${advice}`));
        assert.equal(failure.options.cancelLabel, "Stay logged in");
        assert.equal(failure.options.confirmLabel, "Log out anyway");
        assert.equal(failure.options.danger, true);
    }
    assert.match(logoutSaveFailure(new SaveRateLimitError()).message, /wait a little/);
});

test("network, conflict and other save failures retain the existing logout guard", () => {
    for (const error of [new TypeError("Failed to fetch"), new SaveConflictError(), new Error("Server returned 503"), new Error("Server returned 429"), null]) {
        const failure = logoutSaveFailure(error);
        assert.equal(failure.options.title, "Save Failed");
        assert.match(failure.message, /Log out anyway\?/);
        assert.doesNotMatch(failure.message, /temporarily limiting|wait about/);
    }
});
