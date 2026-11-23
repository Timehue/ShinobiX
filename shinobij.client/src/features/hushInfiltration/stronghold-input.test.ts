import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MOVEMENT_KEYS } from "../../lib/held-movement-keys";

const source = readFileSync(join(import.meta.dirname, "StrongholdExplore.tsx"), "utf8");

test("Anbu Stronghold connects the live gamepad mapper to its tile-movement handler", () => {
    assert.match(source, /<section[^>]*data-gamepad-mode="sector"/,
        "the left stick must send the same WASD movement keys used by this screen");
    assert.match(source, /const k = event\.key\.toLowerCase\(\), delta = MOVEMENT_KEYS\[k\];/,
        "keyboard arrows and WASD go through the shared movement map");
    assert.match(source, /direction\(delta\[0\], delta\[1\], !event\.isTrusted\);/,
        "gamepad-generated WASD and physical keyboard input share the same step action");
    for (const [key, step] of Object.entries({ arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] })) {
        assert.deepEqual(MOVEMENT_KEYS[key], step, key);
    }
    assert.match(source, /Controller: left stick moves; D-pad navigates\./,
        "players can discover the controller mapping in the game");
});
