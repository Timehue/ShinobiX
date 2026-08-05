import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PvpBattleScreen.tsx", import.meta.url), "utf8");

test("the opponent's turn does not replace the PvP jutsu or battle-log area", () => {
    assert.doesNotMatch(source, /is taking their turn/, "the redundant opponent-turn panel must stay removed");
    assert.doesNotMatch(source, /Claim Win \(Opponent AFK\)/, "AFK handling must not reintroduce a large manual panel");

    assert.match(
        source,
        /className="basic-action-bar shinobi-command-bar" style=\{isMyTurn \? undefined : \{ opacity: 0\.55, pointerEvents: "none" \}\}/,
        "basic actions should remain visible but non-interactive while waiting",
    );
    assert.match(
        source,
        /<div style=\{isMyTurn \? \{ display: "contents" \} : \{ opacity: 0\.6, pointerEvents: "none" \}\}>/,
        "the equipped jutsu and item grid should remain visible while waiting",
    );
    assert.match(source, /<BattleTabBar tab=\{battleTabs\.tab\}/, "the battle-log tab must remain available");

    // The removed panel also exposed a manual AFK-claim button. PvP already
    // owns the same behavior in a background effect, so timeout resolution must
    // remain present without occupying combat-layout space.
    assert.match(
        source,
        /submitAction\("claim-afk-win"[\s\S]*?\{ allowWhenNotMyTurn: true \}\)/,
        "valid AFK forfeits should still resolve automatically",
    );
});
