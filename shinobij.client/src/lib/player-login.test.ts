import { test } from "node:test";
import assert from "node:assert/strict";
import { saveLoadFailure } from "./player-login";

// A save pull can fail three ways and they need three different answers. The
// bug this pins: 401 (the session token expired) was falling into the same
// branch as everything else and telling the player "No save found for that
// name. Check spelling or create a new character." — advice that, followed,
// would have had them abandon a character that was never in any danger.

test("401 and 403 are the credential dying, not the save", () => {
    assert.equal(saveLoadFailure(401), "expired");
    assert.equal(saveLoadFailure(403), "expired");
});

test("404 is the only status that means the save is really gone", () => {
    assert.equal(saveLoadFailure(404), "no-save");
});

test("server-side failures never claim anything about the save", () => {
    for (const status of [500, 502, 503, 429, 413]) {
        assert.equal(saveLoadFailure(status), "unreachable", `status ${status}`);
    }
});
