import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { MOVEMENT_KEYS, onShrineFloor, shrineKeyStep, shrineTileToward } from "./held-movement-keys";
import { KEY_DIRECTIONS } from "../features/hollowGate/use-hollow-gate-walk";

const src = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");

test("WASD and the arrows map to the four tile directions; other keys do not", () => {
    assert.deepEqual(MOVEMENT_KEYS.w, [0, -1]);
    assert.deepEqual(MOVEMENT_KEYS.arrowdown, [0, 1]);
    assert.deepEqual(MOVEMENT_KEYS.a, [-1, 0]);
    assert.deepEqual(MOVEMENT_KEYS.arrowright, [1, 0]);
    for (const other of ["e", "q", "enter", " ", "meta", "shift"]) assert.equal(MOVEMENT_KEYS[other], undefined, other);
});

test("Hollow Gate's eager copy of the key map equals the shared one, and keeps the helper off the startup graph", () => {
    assert.deepEqual(KEY_DIRECTIONS, MOVEMENT_KEYS);
    // App imports the Hollow Gate hook eagerly. Importing the shared module there
    // split it into its own startup chunk (+243 B gzip, 17 startup files instead of 16).
    assert.doesNotMatch(read("features/hollowGate/use-hollow-gate-walk.ts"), /from\s+["'][^"']*held-movement-keys["']/);
});

test("the shrine floor is the 10x10 inside the 12x12 grid, with no row wrap", () => {
    const inside: number[] = [];
    for (let tile = -13; tile < 160; tile++) if (onShrineFloor(tile)) inside.push(tile);
    assert.equal(inside.length, 100);
    assert.ok(inside.every(tile => tile % 12 >= 1 && tile % 12 <= 10 && Math.floor(tile / 12) >= 1 && Math.floor(tile / 12) <= 10));
    for (const edge of [-1, 0, 11, 12, 23, 132, 143]) assert.equal(onShrineFloor(edge), false, `tile ${edge}`);
});

test("a held key walks a shrine one floor tile at a time and stops at the edge", () => {
    assert.equal(shrineTileToward("d", 5 * 12 + 5), 5 * 12 + 6);
    assert.equal(shrineTileToward("w", 5 * 12 + 5), 4 * 12 + 5);
    assert.equal(shrineTileToward("d", 5 * 12 + 10), -1, "east edge");
    assert.equal(shrineTileToward("a", 5 * 12 + 1), -1, "west edge (no wrap to the row above)");
    assert.equal(shrineTileToward("w", 12 + 4), -1, "north edge");
    assert.equal(shrineTileToward("s", 10 * 12 + 4), -1, "south edge");
    assert.equal(shrineTileToward(null, 5 * 12 + 5), -1, "no key held");
});

type FakeKey = { key: string; repeat?: boolean; trusted?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; focus?: "floor" | "tile" | "button" };
function keyEvent({ key, repeat = false, trusted = true, ctrlKey = false, metaKey = false, altKey = false, focus = "floor" }: FakeKey) {
    // The floor is each room's one role=group, and its tiles are buttons inside it. "button"
    // stands for Leave, Fight or a rules toggle.
    const floor = { focused: false, focus() { floor.focused = true; }, closest: (selector: string) => (selector === "[role=group]" ? floor : null) };
    const target = focus === "floor" ? floor
        : { closest: (selector: string) => (selector === "button,summary" || (selector === "[role=group]" && focus === "tile") ? {} : null) };
    const event = { key, repeat, ctrlKey, metaKey, altKey, target, floor, currentTarget: { querySelector: () => floor },
        isTrusted: trusted, prevented: false, preventDefault() { event.prevented = true; } };
    return event as unknown as typeof event & ReactKeyboardEvent;
}

test("in a shrine room WASD walks from any control, but on a button the arrows stay the browser's", () => {
    const held = { current: null as string | null };
    const fromLeave = keyEvent({ key: "d", focus: "button" });
    assert.equal(shrineKeyStep(fromLeave, held, 5 * 12 + 5), 5 * 12 + 6, "WASD from the Leave button");
    assert.equal(fromLeave.floor.focused, true, "walking moves focus to the floor, so Leave disabling mid-step cannot drop it to <body>");
    held.current = null;
    const arrowOnButton = keyEvent({ key: "ArrowRight", focus: "button" });
    assert.equal(shrineKeyStep(arrowOnButton, held, 5 * 12 + 5), -1);
    assert.equal(arrowOnButton.prevented, false, "the browser (or Android's D-pad focus move) keeps the arrow");
    assert.equal(arrowOnButton.floor.focused, false, "and focus stays where the player put it");
    assert.equal(held.current, null, "and no hold starts");
    assert.equal(shrineKeyStep(keyEvent({ key: "ArrowRight" }), held, 5 * 12 + 5), 5 * 12 + 6, "an arrow on the floor walks");
    const onTile = keyEvent({ key: "ArrowDown", focus: "tile" });
    assert.equal(shrineKeyStep(onTile, held, 5 * 12 + 5), 6 * 12 + 5, "an arrow on a clicked tile walks");
    assert.equal(onTile.floor.focused, true, "and focus moves off the tile, which may disable once the player moves");
});

test("a shrine room key press asks for one floor step and starts a hold; its OS repeats ask for nothing", () => {
    const held = { current: null as string | null };
    const press = keyEvent({ key: "D" });
    assert.equal(shrineKeyStep(press, held, 5 * 12 + 5), 5 * 12 + 6, "Shift or Caps Lock still walks");
    assert.equal(press.prevented, true);
    assert.equal(held.current, "d");
    const repeat = keyEvent({ key: "d", repeat: true });
    assert.equal(shrineKeyStep(repeat, held, 5 * 12 + 6), -1, "the walk loop follows the held key instead");
    assert.equal(repeat.prevented, true, "a repeat still must not scroll the page");
    assert.equal(shrineKeyStep(keyEvent({ key: "ArrowUp" }), held, 5 * 12 + 5), 4 * 12 + 5);
    assert.equal(held.current, "arrowup", "a new press takes over the hold, as in the open world");
    assert.equal(shrineKeyStep(keyEvent({ key: "d" }), held, 5 * 12 + 10), -1, "never an off-floor step");
});

test("Cmd/Ctrl/Alt shortcuts are not steps, and controller presses never start a hold", () => {
    const held = { current: null as string | null };
    for (const chord of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
        const event = keyEvent({ key: "s", ...chord });
        assert.equal(shrineKeyStep(event, held, 5 * 12 + 5), -1, JSON.stringify(chord));
        assert.equal(event.prevented, false, `${JSON.stringify(chord)} keeps the browser's own handling`);
    }
    assert.equal(held.current, null, "a Cmd chord never starts a hold (macOS would send no keyup)");
    assert.equal(shrineKeyStep(keyEvent({ key: "s", trusted: false }), held, 5 * 12 + 5), 6 * 12 + 5, "a controller press is one step");
    assert.equal(held.current, null, "and never a hold");
    assert.equal(shrineKeyStep(keyEvent({ key: "e" }), held, 5 * 12 + 5), -1);
});

test("the shared hold is released by a WINDOW keyup (or Cmd's) and on blur", () => {
    const helper = read("lib/held-movement-keys.ts");
    assert.match(helper, /if \(key === held\.current \|\| key === "meta"\) clear\(\);/);
    assert.match(helper, /addEventListener\("keyup", release\);\s*addEventListener\("blur", clear\);/);
});

test("Hollow Gate walks a held key on its own timer, not on the OS key repeat", () => {
    const hollowGate = read("features/hollowGate/use-hollow-gate-walk.ts");
    assert.match(hollowGate, /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\s*\|\| \(e\.target as HTMLElement\)\?\.closest\('input,textarea,select,dialog,/,
        "Cmd/Ctrl/Alt chords are not steps (a Cmd chord sends no keyup on macOS)");
    assert.match(hollowGate, /if \(e\.isTrusted && e\.repeat\) return;/);
    assert.match(hollowGate, /if \(e\.isTrusted\) \{ held = k; clearTimeout\(holdTimer\); holdTimer = setTimeout\(holdStep, HOLLOW_GATE_STEP_MS\); \}/);
    assert.match(hollowGate, /if \(k === held \|\| k === "meta"\) stopHold\(\);/, "its keyup, or Cmd's, ends the hold");
    assert.match(hollowGate, /window\.addEventListener\("keyup", handleKeyUp\);/);
    assert.match(hollowGate, /if \(!document\.hasFocus\(\) \|\| blockedRef\.current \|\| targetRef\.current != null\) return stopHold\(\);/,
        "an overlay, an unfocused window or a click-walk ends the hold (no second driver)");
});

test("the stronghold and both golden shrines walk a held key on their own cadence", () => {
    const stronghold = read("features/anbuInfiltration/StrongholdExplore.tsx");
    assert.match(stronghold, /const held = useHeldMovementKey\(\);/);
    assert.match(stronghold, /if \(event\.isTrusted\) \{ if \(event\.repeat\) return; held\.current = k; \}/);
    assert.match(stronghold, /event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return;/);
    assert.match(stronghold, /const hold = held\.current && MOVEMENT_KEYS\[held\.current\];[\s\S]{0,260}else void stepToward\(hold\[0\], hold\[1\]\);/,
        "continueWalk follows the held key");
    for (const [path, call, from] of [["features/villageWar/VillageWarShrineRoom.tsx", "walkTo", "from"], ["features/clanWar/ClanShrineGateway.tsx", "walk", "next"]]) {
        const source = read(path);
        assert.match(source, /useHeldMovementKey\(\)/, `${path} tracks the held key`);
        assert.match(source, new RegExp(`<section className=['"](?:war|clan)-shrine-room['"][^>]*onKeyDown=\\{event\\s*=>\\s*\\{[^}]*shrineKeyStep\\(event,\\s*held,`), `${path} takes WASD anywhere in the room`);
        assert.match(source, new RegExp(`if\\s*\\(tile\\s*>=\\s*0\\)\\s*void ${call}\\(tile\\)`));
        assert.match(source, new RegExp(`shrineTileToward\\(held\\.current,\\s*${from}\\)`), `${path}'s walk loop follows the held key`);
        assert.doesNotMatch(source, /ArrowUp:\s*-12/, `${path} no longer keeps an arrow-only floor handler`);
    }
});

test("the world map's WASD handler stands down while a stronghold covers the sector", () => {
    const worldMap = read("screens/WorldMap.tsx");
    assert.match(worldMap, /if \(!selectedSector \|\| vaultRaid \|\| selectedSector === FESTIVAL_SECTOR/,
        "a WASD press inside a stronghold must not walk the hidden world avatar or re-render the map");
    assert.match(worldMap, /\[selectedSector, sectorPlayerPos, currentSector, isTraveling, vaultRaid\]/);
});

test("the world stops drawing under the clan golden shrine room, as under the village war shrine", () => {
    const worldMap = read("screens/WorldMap.tsx");
    assert.match(worldMap, /paused=\{warShrine\.open \|\| clanShrineOpen \|\| !!villageRaidDialog\}/);
    assert.match(worldMap, /<ClanShrineGateway[^>]*onRoomOpen=\{setClanShrineOpen\}/);
    const gateway = read("features/clanWar/ClanShrineGateway.tsx");
    assert.match(gateway, /useEffect\(\(\)=>\{if\(!roomOpen\)return;onRoomOpen\(true\);return\(\)=>onRoomOpen\(false\);\},\[roomOpen,onRoomOpen\]\);/,
        "the pause ends when the room closes or the gateway unmounts");
});
