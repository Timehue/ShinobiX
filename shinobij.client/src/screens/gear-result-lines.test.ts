import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/*
 * The upgrade gear piece a run grants must be named where the winnings are
 * shown. The fight card is rendered in AiFightHost.gear-line.test.tsx; these
 * three live in screens that cannot be rendered by the plain node runner, so
 * the wiring is pinned instead. Each pin names the exact call the screen makes.
 */
const read = (...parts: string[]) => readFileSync(join(import.meta.dirname, "..", ...parts), "utf8").replaceAll("\r\n", "\n");

test("the tower receipt names the piece instead of only saying one was found", () => {
    const tower = read("screens", "BattleTowerFight.tsx");
    assert.match(tower, /const gear = gearDropRewardLine\(result\.gearDrop\?\.itemId\);\n\s+return gear \? `\$\{text\} · \$\{gear\}` : text;/);
    assert.ok(!tower.includes("upgrade gear piece found"), "the vague wording is gone");
});

test("a custom settle such as the Clan Boss shows its piece on the result card", () => {
    const tower = read("screens", "BattleTowerFight.tsx");
    assert.match(tower, /gearLine: gearDropRewardLine\(mutation\.gearDrop\?\.itemId\)/);
    assert.match(tower, /\{settlement\.gearLine && <p className="tower-completion-reward" data-testid="tower-gear-drop">\{settlement\.gearLine\}<\/p>\}/);
});

test("the dungeon cleared alert lists the piece with the relic and the other rewards", () => {
    const app = read("App.tsx");
    assert.match(app, /gearFound = result\.gearDropItemId;/);
    assert.match(app, /Dungeon Legendary Relic\.\$\{gearFound \? `\\n\$\{gearDropRewardLine\(gearFound\) \?\? ""\}` : ""\}`\)/);
});
