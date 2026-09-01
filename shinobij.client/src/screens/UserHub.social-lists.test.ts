import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./UserHub.tsx", import.meta.url), "utf8");

test("User Hub exposes distinct Following, Friends, and Blocked lists", () => {
    assert.match(source, /★ Following/);
    assert.match(source, /♥ Friends/);
    assert.match(source, /⊘ Blocked/);
    assert.match(source, /Add a friend by player name/);
    assert.match(source, /Block a player by name/);
    assert.match(source, /Enter exact player name/);
});

test("Friends and Blocked rows expose reversible list actions", () => {
    assert.match(source, />Remove<\/button>/);
    assert.match(source, />Unblock<\/button>/);
    assert.match(source, /addFriend\(currentName, target\)/);
    assert.match(source, /\/api\/player\/blocks/);
});
