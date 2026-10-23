import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rememberEntryHollowGateSeal, takeFreshHollowGateSeal } from "./hollow-gate-event-api";

// An entry seals its first floor, then the shrine screen mounts and seals the
// floor again to read a pending ambush. Straight after an entry that second
// request was identical and took the run lock while the player's first steps
// queued behind it. The entry now hands its reply over, once.
const sealed = { ok: true, position: { x: 3, y: 4 }, pendingAmbush: { nodeId: "floor:1:ambush:threat-v25", kind: "ambush" as const } };

test("the shrine screen takes the entry's seal of the same floor once", () => {
    rememberEntryHollowGateSeal("token-a", 1, sealed);
    assert.deepEqual(takeFreshHollowGateSeal("token-a", 1), sealed);
    assert.equal(takeFreshHollowGateSeal("token-a", 1), null, "a later visit to the screen must ask the server again");
});

test("another run, another floor, an old seal or a failed seal is never handed over", () => {
    rememberEntryHollowGateSeal("token-a", 1, sealed);
    assert.equal(takeFreshHollowGateSeal("token-b", 1), null);
    rememberEntryHollowGateSeal("token-a", 1, sealed);
    assert.equal(takeFreshHollowGateSeal("token-a", 2), null);
    rememberEntryHollowGateSeal("token-a", 1, sealed);
    assert.equal(takeFreshHollowGateSeal("token-a", 1, -1), null, "a seal older than the window is stale");
    rememberEntryHollowGateSeal("token-a", 1, { ok: false, error: "The Hollow Gate floor seal is unreachable." });
    assert.equal(takeFreshHollowGateSeal("token-a", 1), null, "a failed entry seal is retried on mount");
});

test("only the entry hands its seal over; the screen still seals every other route in", () => {
    const root = join(process.cwd(), "shinobij.client", "src");
    const entry = readFileSync(join(root, "lib", "hollow-gate-entry.ts"), "utf8");
    const app = readFileSync(join(root, "App.tsx"), "utf8");
    assert.match(entry, /await sealHollowGateFloor\(character!\.name, start\.token!, run\);[\s\S]{0,120}rememberEntryHollowGateSeal\(start\.token!, run\.floor, floorSeal\)/);
    assert.match(app, /takeFreshHollowGateSeal\(token, floor\) \?\? sealHollowGateFloor\(playerName, token, hollowGateRun\)/);
});
