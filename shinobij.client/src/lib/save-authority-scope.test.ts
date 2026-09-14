import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaveAuthorityScope } from "./save-authority-scope";

function fixture() {
    const refs = {
        accountKey: { current: "shinobi" },
        latestVersion: { current: 7 },
        payloadRevision: { current: 3 },
        payloadIdentity: { current: ["draft"] as readonly unknown[] | null },
        failureCount: { current: 2 },
        sessionEpoch: { current: 4 },
        createAbort: { current: new AbortController() },
    };
    const events: string[] = [];
    let active = "shinobi";
    const scope = createSaveAuthorityScope({
        ...refs,
        activeAccountKey: () => active,
        setBlocked: blocked => { events.push(`blocked:${blocked}`); },
        invalidateAuthority: () => { events.push("invalidate"); },
    });
    return { refs, events, scope, setActive: (name: string) => { active = name; } };
}

test("scoping to the same canonical account preserves writes, versions, and admission", () => {
    const f = fixture(), oldController = f.refs.createAbort.current;
    const captured = f.scope.captureCreateScope("Shinobi");
    assert.equal(f.scope.scopeToAccount(" SHINOBI "), 4);
    assert.equal(f.refs.latestVersion.current, 7);
    assert.equal(f.refs.payloadRevision.current, 3);
    assert.deepEqual(f.refs.payloadIdentity.current, ["draft"]);
    assert.equal(f.refs.failureCount.current, 2);
    assert.equal(f.refs.createAbort.current, oldController);
    assert.equal(captured.isCurrent(), true);
    assert.deepEqual(f.events, []);
});

test("switching accounts aborts old admission and resets all save authority refs", () => {
    const f = fixture(), captured = f.scope.captureCreateScope("Shinobi");
    f.setActive("other");
    assert.equal(f.scope.scopeToAccount("Other"), 5);
    assert.equal(captured.signal.aborted, true);
    assert.equal(captured.isCurrent(), false);
    assert.equal(f.refs.accountKey.current, "other");
    assert.equal(f.refs.latestVersion.current, 0);
    assert.equal(f.refs.payloadRevision.current, 0);
    assert.equal(f.refs.payloadIdentity.current, null);
    assert.equal(f.refs.failureCount.current, 0);
    assert.equal(f.scope.isCurrent("other", 5), true);
    assert.deepEqual(f.events, ["blocked:false"]);
});

test("switching away and back cannot revive the original request scope", () => {
    const f = fixture(), captured = f.scope.captureCreateScope("Shinobi");
    f.setActive("other"); f.scope.scopeToAccount("Other");
    f.setActive("shinobi"); f.scope.scopeToAccount("Shinobi");
    assert.equal(f.scope.isCurrent("shinobi", 4), false);
    assert.equal(f.scope.isCurrent("shinobi", 6), true);
    assert.equal(captured.isCurrent(), false);
    assert.equal(f.scope.captureCreateScope("Shinobi").isCurrent(), true);
});

test("logout retires the session even when the scope is already empty", () => {
    const f = fixture();
    f.scope.reset();
    const resetController = f.refs.createAbort.current;
    assert.equal(f.refs.accountKey.current, "");
    assert.equal(f.refs.sessionEpoch.current, 5);
    f.scope.reset();
    assert.equal(resetController.signal.aborted, true);
    assert.equal(f.refs.sessionEpoch.current, 6);
    assert.deepEqual(f.events, ["blocked:false", "blocked:false"]);
});

test("external versions reject foreign and stale responses without invalidating a write", () => {
    const f = fixture();
    assert.equal(f.scope.acceptExternalVersion(99, "Other"), "foreign");
    assert.equal(f.scope.acceptExternalVersion(6, "Shinobi"), "stale");
    assert.equal(f.refs.latestVersion.current, 7);
    assert.deepEqual(f.events, []);
    f.setActive("other");
    assert.equal(f.scope.acceptExternalVersion(99, "Shinobi"), "foreign");
    assert.equal(f.scope.isCurrent("shinobi", 4), false);
    assert.equal(f.refs.latestVersion.current, 7);
});

test("only a newer accepted version invalidates persistence and it updates the original ref", () => {
    const f = fixture();
    assert.equal(f.scope.acceptExternalVersion(7, "Shinobi"), "accepted");
    assert.deepEqual(f.events, []);
    assert.equal(f.scope.acceptExternalVersion(8, "SHINOBI"), "accepted");
    assert.equal(f.refs.latestVersion.current, 8);
    assert.deepEqual(f.events, ["invalidate"]);
    assert.equal(f.scope.acceptExternalVersion(7, "Shinobi"), "stale");
    assert.deepEqual(f.events, ["invalidate"]);
});

test("a cancelled admission controller makes its captured scope stale without changing accounts", () => {
    const f = fixture(), captured = f.scope.captureCreateScope("Shinobi");
    f.refs.createAbort.current.abort();
    assert.equal(captured.isCurrent(), false);
    assert.equal(f.refs.sessionEpoch.current, 4);
});
