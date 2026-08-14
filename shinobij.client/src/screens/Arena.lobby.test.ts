import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const adaptiveShellCss = readFileSync(new URL("../styles/layout/adaptive-shell.css", import.meta.url), "utf8");

test("the casual Battle Arena retires pending local-AI breadcrumbs instead of starting combat", () => {
    const retirementEffect = arenaSource.match(
        /useEffect\(\(\) => \{[\s\S]{0,220}if \(pendingAiProfileId\) setPendingAiProfileId\(""\);[\s\S]{0,80}\}, \[pendingAiProfileId\]\);/,
    );

    assert.ok(retirementEffect, "could not find the pending-AI retirement effect");
    assert.doesNotMatch(
        retirementEffect[0],
        /startPrefight|setBattleStarted\(true\)/,
        "a legacy catalog id must never arm the retired local Arena reducer",
    );
    assert.doesNotMatch(arenaSource, /\/\/ A pending AI[\s\S]{0,500}startPrefight\(/);
});

test("the shared mobile shell gives the Battle Arena lobby a vertical touch scroller", () => {
    assert.match(adaptiveShellCss, /@media \(max-width: 979px\)/);
    assert.match(
        adaptiveShellCss,
        /\.app-shell\[data-shell="adaptive"\] > \.center-game\.screen-battleArena[\s\S]*?overflow-y:\s*auto !important;[\s\S]*?touch-action:\s*pan-y;/,
        "the xs/sm shell must keep Battle Arena scrollable above the fixed mobile nav",
    );
});
