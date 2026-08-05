import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const adaptiveShellCss = readFileSync(new URL("../styles/layout/adaptive-shell.css", import.meta.url), "utf8");

test("the casual Battle Arena lobby never auto-starts a pending AI encounter", () => {
    const autoStartEffect = arenaSource.match(
        /useEffect\(\(\) => \{\s*\/\/ A pending AI[\s\S]*?startPrefight\(enemyMaxHp,[\s\S]*?\}, \[directCombat, pendingAiProfile\?\.id, battleStarted\]\);/,
    );

    assert.ok(autoStartEffect, "could not find the pending-AI auto-start effect");
    assert.match(
        autoStartEffect[0],
        /if \(!directCombat\) return;/,
        "pending AI profiles may auto-start only on the dedicated direct-combat route",
    );
});

test("the shared mobile shell gives the Battle Arena lobby a vertical touch scroller", () => {
    assert.match(adaptiveShellCss, /@media \(max-width: 979px\)/);
    assert.match(
        adaptiveShellCss,
        /\.app-shell\[data-shell="adaptive"\] > \.center-game\.screen-battleArena[\s\S]*?overflow-y:\s*auto !important;[\s\S]*?touch-action:\s*pan-y;/,
        "the xs/sm shell must keep Battle Arena scrollable above the fixed mobile nav",
    );
});
