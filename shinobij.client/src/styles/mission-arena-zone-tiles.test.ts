import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// A solo fight paints the server's ground field on every tile it covers, and an
// Instant Effect field covers 61-91 of the 120 tiles for two rounds. The field
// rule has four classes plus `!important`, so it outranks every other tile
// marking in the arena stylesheets (the Hollow Gate hazard rule has three). It
// used to paint over hazard tiles, walls and aiming telegraphs alike, so a
// player could step onto a damaging tile that looked like ordinary field.
//
// These tests pin the field rule's exclusions and fail when MissionArenaFight
// gives a tile a NEW class, so every future marking gets an explicit decision
// here instead of being painted over.
const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "mission-arena-fight.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SCREEN = readFileSync(join(HERE, "..", "screens", "MissionArenaFight.tsx"), "utf8");

/** Markings that must stay visible inside a field. */
const MUST_WIN = [
    "hg-hazard-tile",
    "hg-safe-tile",
    "combat-barrier-tile",
    "combat-blocked-tile",
    "jutsu-range-tile",
    "dash-target-tile",
    "ground-target-tile",
    "ground-affected-tile",
    "jutsu-target-tile",
    "jutsu-aoe-tile",
];

/** Tile classes that are not a competing marking, with the reason. */
const NOT_A_MARKING: Record<string, string> = {
    "hex-tile": "the base tile",
    "hex-player": "occupant; fields cover occupants in PvP too",
    "hex-enemy": "occupant; fields cover occupants in PvP too",
    "jutsu-self-target-tile": "always paired with jutsu-target-tile",
    "mission-ground-preview-tile": "always paired with ground-affected-tile",
    "mission-ground-zone-tile": "the field itself",
};

function fieldRuleExclusions(): string[] {
    const rule = CSS.match(/\.arena-fullscreen\.mission-arena-fight \.hex-tile\.mission-ground-zone-tile([^{]*)\{([^}]*)\}/);
    assert.ok(rule, "the field rule exists in mission-arena-fight.css");
    assert.match(rule[2], /background:\s*var\(--mission-zone-fill\)\s*!important/,
        "the rule found is the one that paints the field fill");
    const excluded = rule[1].match(/^:not\(:is\(([^)]*)\)\)\s*$/);
    assert.ok(excluded, "the field rule excludes tiles that carry another marking");
    return excluded[1].split(",").map((selector) => selector.trim().replace(/^\./, ""));
}

function tileClasses(): string[] {
    const list = SCREEN.match(/const cls = \[\s*([\s\S]*?)\]\.filter\(Boolean\)\.join\(" "\);/);
    assert.ok(list, "MissionArenaFight builds its tile class list in one array");
    const names = new Set<string>();
    for (const literal of list[1].matchAll(/"([^"]*)"|`([^`]*)`/g)) {
        for (const name of (literal[1] ?? literal[2] ?? "").split(/\s+/)) {
            if (/^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
        }
    }
    assert.ok(names.has("hg-hazard-tile") && names.has("mission-ground-zone-tile"),
        "the scan reaches the real tile class list");
    return [...names];
}

test("the solo ground field never paints over hazard, wall or aiming markings", () => {
    const excluded = fieldRuleExclusions();
    for (const marking of MUST_WIN) {
        assert.ok(excluded.includes(marking), `the field fill must not paint over .${marking}`);
    }
});

test("every class MissionArenaFight gives a tile is either excluded from the field or known not to compete", () => {
    const excluded = new Set(fieldRuleExclusions());
    for (const name of tileClasses()) {
        if (/^mission-ground-zone-[a-z]+$/.test(name) || name.startsWith("mission-ground-zone-$")) continue;
        assert.ok(excluded.has(name) || name in NOT_A_MARKING,
            `.${name} is a new tile class: add it to the field rule's :not(:is(...)) list in mission-arena-fight.css if it marks the tile, or to NOT_A_MARKING here with the reason if it does not`);
    }
});
