import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * "If you leave a game mode it counts as a loss."
 *
 * One screen hosts every live PvP card duel — Clan War showdowns, Sector War
 * tables and Free Play (ClanWarTileCardDuel's CardClashDuelScreen). Its Leave
 * button used to walk away and leave the match running: the opponent had to sit
 * through a 60-second turn clock per absent turn, and if both left, the match
 * expired two hours later with no result. Leaving a LIVE match now forfeits it
 * through the same server action as the board's own Forfeit control.
 */
test("leaving a live card duel forfeits it before the screen changes", () => {
    const source = readFileSync(new URL("./ClanWarTileCardDuel.tsx", import.meta.url), "utf8");
    const start = source.indexOf("async function leaveTable()");
    const leave = source.slice(start, source.indexOf("if (!stash)", start));
    assert.ok(start >= 0 && leave.length > 0, "the scan still finds leaveTable");
    assert.match(leave, /if \(view\?\.status === "active"\)/, "only a live match is forfeited; a table still waiting for its opponent is simply left");
    assert.match(leave, /await post\("forfeit"\)/, "the forfeit goes to the server, the only authority on the result");
    assert.ok(leave.indexOf('post("forfeit")') < leave.indexOf("setScreen(config.backScreen)"), "and lands before the player leaves");
    assert.doesNotMatch(leave, /turn clock will keep running/, "leaving is no longer offered as a free pause");
    // Both exits go through it: the header button and the board's own exit.
    assert.equal(source.match(/void leaveTable\(\)/g)?.length, 2);
});
