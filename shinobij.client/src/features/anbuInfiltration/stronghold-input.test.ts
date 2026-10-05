import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(import.meta.dirname, "StrongholdExplore.tsx"), "utf8");

test("Anbu Stronghold connects the live gamepad mapper to its tile-movement handler", () => {
    assert.match(source, /<section[^>]*data-gamepad-mode="sector"/,
        "the left stick must send the same WASD movement keys used by this screen");
    assert.match(source, /arrowup:\s*\[0,\s*-1\].*arrowdown:\s*\[0,\s*1\].*arrowleft:\s*\[-1,\s*0\].*arrowright:\s*\[1,\s*0\]/s,
        "keyboard arrows remain mapped to the existing step action");
    assert.match(source, /w:\s*\[0,\s*-1\].*s:\s*\[0,\s*1\].*a:\s*\[-1,\s*0\].*d:\s*\[1,\s*0\]/s,
        "gamepad-generated WASD and physical keyboard input share the same step action");
    assert.match(source, /Controller: left stick moves; D-pad navigates\./,
        "players can discover the controller mapping in the game");
});
