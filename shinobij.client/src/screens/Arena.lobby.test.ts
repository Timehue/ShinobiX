import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const mobileCss = readFileSync(new URL("../styles/index/27-mobile-polish-fixes.css", import.meta.url), "utf8");

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

test("the mobile Battle Arena lobby owns a vertical touch scroller", () => {
    for (const viewport of ["xs", "sm"]) {
        assert.match(
            mobileCss,
            new RegExp(
                `html\\[data-vp="${viewport}"\\] \\.center-game\\.screen-battleArena[\\s\\S]*?` +
                `overflow-y:\\s*auto\\s*!important;[\\s\\S]*?touch-action:\\s*pan-y;`,
            ),
            `${viewport} Battle Arena must remain vertically scrollable above the fixed mobile nav`,
        );
    }
});
