import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The server pushes `save:version` after a travel arrival it settled with no
// request of ours in flight (api/_realtime/travel-lease.ts → notify.ts
// pushSaveVersion). Without adopting it the next autosave took a 409 after every
// trip. The socket must feed the SAME account-scoped, monotonic event that
// authFetch raises for `_saveVersion` bodies, never a side channel.
const source = readFileSync(new URL("./presence-socket.ts", import.meta.url), "utf8");
const serverNotify = readFileSync(new URL("../../../api/_realtime/notify.ts", import.meta.url), "utf8");
const serverLease = readFileSync(new URL("../../../api/_realtime/travel-lease.ts", import.meta.url), "utf8");

test("the presence socket adopts server-pushed save versions through SAVE_VERSION_EVENT", () => {
    const handler = source.slice(source.indexOf("socket.on('save:version'"));
    assert.ok(handler.length > 0, "presence-socket listens for save:version");
    const body = handler.slice(0, handler.indexOf("});") + 3);
    assert.match(body, /Number\.isSafeInteger\(version\) \|\| version <= 0\) return/);
    assert.match(body, /accountName: getSocketAuth\(\)\.name, source: 'mutation'/);
    assert.match(body, /new CustomEvent\(SAVE_VERSION_EVENT, \{ detail \}\)/);
});

test("the server emits the event name the client listens for, only after a committed arrival", () => {
    assert.match(serverNotify, /'save:version', \{ version \}/);
    assert.match(serverLease, /if \(result\.value\) pushSaveVersion\(name, result\._saveVersion\)/);
});
