import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./Messages.tsx", import.meta.url), "utf8");

test("inbox rows expose an accessible, confirmed delete action", () => {
    assert.match(source, /GiTrashCan/);
    assert.match(source, /aria-label=\{`Delete conversation with \$\{e\.with\}`\}/);
    assert.match(source, /gameConfirm\(/);
    assert.match(source, /danger: true/);
});

test("conversation deletion is persistent and refreshes the unread badge", () => {
    assert.match(source, /method: "DELETE"/);
    assert.match(source, /setInbox\(\(current\) => current\.filter/);
    assert.match(source, /refreshUnreadMail\(\)/);
});
