import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const heartbeatMarker = appSource.indexOf("let heartbeatEffectActive = true");
const heartbeatStart = appSource.lastIndexOf("useEffect(() => {", heartbeatMarker);
const heartbeatEnd = appSource.indexOf("\n    usePresenceSocket({", heartbeatMarker);
const heartbeat = appSource.slice(heartbeatStart, heartbeatEnd);

describe("heartbeat force-reload account authority", () => {
    it("binds the request to its originating account and epoch before network work", () => {
        const account = heartbeat.indexOf("const heartbeatAccountKey = saveConflictAccountKey(char.name)");
        const epoch = heartbeat.indexOf("const heartbeatSessionEpoch = saveSessionEpochRef.current", account);
        const current = heartbeat.indexOf("heartbeatEffectActive && isCurrentSaveSession(heartbeatAccountKey, heartbeatSessionEpoch)", epoch);
        const preflight = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", current);
        const request = heartbeat.indexOf("await fetch('/api/player/heartbeat'", preflight);
        assert.ok(account >= 0 && account < epoch && epoch < current && current < preflight && preflight < request);

        const heartbeatJson = heartbeat.indexOf("await res.json()", request);
        const postJsonGuard = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", heartbeatJson);
        const firstMutation = heartbeat.indexOf("noteServerTime(data.serverNow)", heartbeatJson);
        assert.ok(heartbeatJson < postJsonGuard && postJsonGuard < firstMutation,
            "retired heartbeat JSON must not mutate the next account's clock or UI");
    });

    it("binds the extracted forced-reload flow to the heartbeat session and draft owner", () => {
        const forceReload = heartbeat.slice(heartbeat.indexOf("if (data.forceReload)"), heartbeat.indexOf("// Live sector-mates"));
        assert.match(forceReload, /reloadSignaledSave/);
        assert.match(forceReload, /accountName: heartbeatAccountKey, admin: adminLoggedIn, isCurrent: heartbeatIsCurrent/);
        assert.match(forceReload, /unresolved\?\.accountKey === heartbeatAccountKey && unresolved.sessionEpoch === heartbeatSessionEpoch/);
        assert.match(forceReload, /protectDraft: \(\) =>/);
        assert.match(forceReload, /applySnapshot: applyServerSnapshot, unwindToLogin: unwindToLoginForm/);
    });
    it("retires in-flight work on every effect cleanup and preserves bounded requests", () => {
        const retire = heartbeat.indexOf("const retireHeartbeat = () => {");
        const deactivate = heartbeat.indexOf("heartbeatEffectActive = false", retire);
        const detachKick = heartbeat.indexOf("heartbeatRef.current = () => {}", deactivate);
        // The beat is armed by lib/heartbeat-cadence's jittered scheduler rather
        // than a bare setInterval, so the cleanup cancels its chain instead of
        // clearing an interval id. What this pins is unchanged: the cleanup must
        // retire the session BEFORE it stops the timer.
        const intervalCleanup = heartbeat.indexOf("return () => { retireHeartbeat(); stopHeartbeat(); }", detachKick);
        assert.ok(retire >= 0 && retire < deactivate && deactivate < detachKick && detachKick < intervalCleanup);

        // The effect must never bail out BEFORE arming the interval — it used to
        // return early on a hidden tab, which silently retired heartbeatRef and
        // left presence:kick calling a no-op. See lib/heartbeat-cadence.ts.
        assert.doesNotMatch(heartbeat, /return retireHeartbeat/u,
            "a hidden tab must keep a (slow) beat, not retire the heartbeat early");

        assert.equal(
            (heartbeat.match(/\bfetch\(/g) ?? []).length,
            (heartbeat.match(/AbortSignal\.timeout\(12000\)/g) ?? []).length,
            "every heartbeat/force-reload request must retain the 12-second timeout",
        );
    });
});
