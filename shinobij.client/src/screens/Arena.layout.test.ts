import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const battleSkinCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");

test("rookie combat tip reserves a row without displacing the hex battlefield", () => {
    assert.match(
        arenaSource,
        /combat-layout\$\{showRookieCombatTip \? " has-rookie-tip" : ""\}/,
        "Arena must mark the combat grid whenever the First Fight Plan is rendered",
    );

    const rookieRowRules = battleSkinCss.match(
        /\.combat-layout\.has-rookie-tip(?: \.combat-main-area)?\s*\{[^}]*grid-template-rows:[^}]*\}/g,
    ) ?? [];

    assert.ok(rookieRowRules.length >= 3, "desktop, mobile, and short-mobile layouts must reserve the tip row");
    for (const rule of rookieRowRules) {
        assert.match(
            rule,
            /grid-template-rows:\s*auto auto auto minmax\(/,
            "the tip, AP panel, and terrain strip must each precede the battlefield row",
        );
    }

    assert.match(
        battleSkinCss,
        /\.combat-layout\.has-rookie-tip \.rookie-combat-tip\s*\{[^}]*grid-row:\s*2\s*!important;/s,
        "mobile must place the rookie tip immediately below the fighter HUD row",
    );
    assert.match(
        battleSkinCss,
        /\.combat-layout\.has-rookie-tip \.hex-battlefield\s*\{\s*grid-row:\s*4\s*!important;/,
        "mobile must move the battlefield to the reserved post-tip row",
    );
});
