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

    it("guards every force-reload await and mutation boundary", () => {
        const forceReload = heartbeat.indexOf("if (data.forceReload)");
        const adminAck = heartbeat.indexOf("await fetch(`/api/save/", forceReload);
        assert.ok(heartbeat.lastIndexOf("if (!heartbeatIsCurrent()) return", adminAck) > forceReload,
            "the admin acknowledgement must remain account-scoped");

        const saveGet = heartbeat.indexOf("const saveRes = await fetch", adminAck);
        const postGetGuard = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", saveGet);
        const saveBranch = heartbeat.indexOf("if (saveRes.ok)", saveGet);
        assert.ok(saveGet < postGetGuard && postGetGuard < saveBranch);

        const saveJson = heartbeat.indexOf("await saveRes.json()", saveBranch);
        const postSaveJsonGuard = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", saveJson);
        const apply = heartbeat.indexOf("applyServerSnapshot(snap)", saveJson);
        const preAckGuard = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", apply);
        const successAck = heartbeat.indexOf("await fetch(`/api/save/", preAckGuard);
        assert.ok(saveJson < postSaveJsonGuard && postSaveJsonGuard < apply,
            "a save response for the former account must never be painted");
        assert.ok(apply < preAckGuard && preAckGuard < successAck,
            "snapshot application may retire the session and must be rechecked before acknowledgement");

        const deletedBranch = heartbeat.indexOf("} else {", successAck);
        const deleteGuard = heartbeat.indexOf("if (!heartbeatIsCurrent()) return", deletedBranch);
        const deleteAck = heartbeat.indexOf("const ack = fetch", deleteGuard);
        const localDelete = heartbeat.indexOf("delete accounts[lsKey]", deleteAck);
        const logout = heartbeat.indexOf('currentAccountNameRef.current = ""', localDelete);
        assert.ok(deletedBranch < deleteGuard && deleteGuard < deleteAck && deleteAck < localDelete && localDelete < logout,
            "a deleted-save reply must be current before acknowledgement, cache deletion, or logout");
    });

    it("retires in-flight work on every effect cleanup and preserves bounded requests", () => {
        const retire = heartbeat.indexOf("const retireHeartbeat = () => {");
        const deactivate = heartbeat.indexOf("heartbeatEffectActive = false", retire);
        const detachKick = heartbeat.indexOf("heartbeatRef.current = () => {}", deactivate);
        const hiddenCleanup = heartbeat.indexOf("if (!tabVisible) return retireHeartbeat", detachKick);
        const intervalCleanup = heartbeat.indexOf("return () => { retireHeartbeat(); clearInterval(id); }", hiddenCleanup);
        assert.ok(retire >= 0 && retire < deactivate && deactivate < detachKick && detachKick < hiddenCleanup && hiddenCleanup < intervalCleanup);

        assert.equal(
            (heartbeat.match(/\bfetch\(/g) ?? []).length,
            (heartbeat.match(/AbortSignal\.timeout\(12000\)/g) ?? []).length,
            "every heartbeat/force-reload request must retain the 12-second timeout",
        );
    });
});
