import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * Owner rule 2026-09-24: leaving a game mode counts as a loss. The Card Hall used
 * to PAUSE a live AI showdown when its player walked away, so leaving a losing
 * match kept the record clean. Every exit from a live showdown now forfeits it
 * (the server records the loss: api/card-clash/ai-move.test.ts), and the next
 * start resolves anything a closed tab left behind (same file).
 */
// LF-normalized: a Windows checkout with autocrlf has CRLF line endings.
const hall = readFileSync(new URL("./CardHall.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function body(name: string): string {
    const start = hall.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    return hall.slice(start, hall.indexOf("\n  }\n", start));
}

test("both exits from the board go through the forfeiting leave", () => {
    assert.match(hall, /onExit=\{\(\) => void leaveShowdown\(\)\}/, "the board's Return to Hall");
    assert.match(hall, /leaveShowdown\(\)\.then\(\(left\) => \{ if \(left\) onBack\(\); \}\)/, "the header Back, only once the player agreed");
    assert.doesNotMatch(hall, /onExit=\{leaveActiveBoard\}/, "no exit may just walk away from a live match");
});

test("a live showdown is confirmed, then forfeited straight to the server", () => {
    const leave = body("leaveShowdown");
    assert.match(leave, /gameConfirm\("Leave the showdown\? Leaving forfeits it and counts as a loss\."\)/);
    // act() returns early while a Keeper replay holds busy, which would drop the forfeit.
    assert.match(leave, /chronicleAiAction\(matchId, \{ action: "forfeit" \}\)/);
    const code = leave.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\bact\(/, "the forfeit must not ride on act()");
    assert.match(leave, /syncResumableMatch\(null\)/, "a showdown that was left is not resumable");
    assert.match(leave, /setScreenFightActive\("shinobiTiles", false\)/, "the menus open before the caller navigates");
});

test("starting over warns that an interrupted showdown will be forfeited", () => {
    const start = body("startFreshShowdown");
    assert.match(start, /resumableMatchId && !\(await gameConfirm\("Start a new showdown\? Your interrupted showdown will be forfeited and count as a loss\."\)\)\) return;/);
    assert.match(hall, /onClick=\{\(\) => void startFreshShowdown\(\)\}/, "the Start button asks first");
});

test("a live showdown locks the menus for as long as it is live", () => {
    assert.match(hall, /const liveShowdown = Boolean\(matchId && duel && duel\.status === "active"\);/);
    assert.match(hall, /setScreenFightActive\("shinobiTiles", liveShowdown\);/);
    assert.match(hall, /return \(\) => setScreenFightActive\("shinobiTiles", false\);/);
});
