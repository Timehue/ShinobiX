import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const adaptiveShellCss = readFileSync(new URL("../styles/layout/adaptive-shell.css", import.meta.url), "utf8");

test("the casual Battle Arena publishes a sealed practice request without local combat state", () => {
    const start = arenaSource.indexOf("function beginAiBattle");
    const end = arenaSource.indexOf("async function challengePlayer", start);
    assert.ok(start >= 0 && end > start, "could not find the practice-launch boundary");
    const launch = arenaSource.slice(start, end);

    assert.match(launch, /requestAiFight\(/);
    assert.match(launch, /publishedPracticeOpponentForLevel\(aiLevel\)/);
    assert.match(launch, /battleKind: "practice"/);
    assert.match(launch, /returnScreen: "arena"/);
    assert.doesNotMatch(launch, /fetch\(|startPrefight|setBattleStarted|setEnemyHp|updateCharacter/);
    assert.doesNotMatch(arenaSource, /pendingAiProfileId|ArenaBattlePersister|ShinobiCombatShell/);
});

test("the shared mobile shell gives the Battle Arena lobby a vertical touch scroller", () => {
    assert.match(adaptiveShellCss, /@media \(max-width: 979px\)/);
    assert.match(
        adaptiveShellCss,
        /\.app-shell\[data-shell="adaptive"\] > \.center-game\.screen-battleArena[\s\S]*?overflow-y:\s*auto !important;[\s\S]*?touch-action:\s*pan-y;/,
        "the xs/sm shell must keep Battle Arena scrollable above the fixed mobile nav",
    );
});
