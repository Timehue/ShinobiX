import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// The wide-desktop battle skin addresses the board wrapper as
// `.hex-battlefield > div:first-child:has(> .hex-grid-layer)`. The ambient
// weather layer therefore mounts INSIDE that wrapper (before the grid), never
// as a sibling ahead of it: a sibling silently dropped the wide-layout scale
// whenever weather was present, which reduced-motion e2e (no weather) cannot see.
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

for (const screen of ["screens/MissionArenaFight.tsx", "screens/PvpBattleScreen.tsx"]) {
    test(`${screen} mounts CombatWeatherLayer inside the board wrapper, right before the grid`, () => {
        const source = src(screen);
        const layerAt = source.indexOf("<CombatWeatherLayer");
        assert.ok(layerAt > 0, "the weather layer is mounted");
        const gridAt = source.indexOf('<div className="hex-grid-layer"', layerAt);
        assert.ok(gridAt > layerAt, "the grid follows the weather layer");
        const between = source.slice(layerAt, gridAt);
        assert.doesNotMatch(between, /<div style=\{\(\(\) =>/, "no board wrapper opens between the weather layer and the grid, so the layer is already inside it");
        const battlefieldAt = source.lastIndexOf("hex-battlefield hex-", layerAt);
        const wrapperAt = source.indexOf("<div style={(() => {", battlefieldAt);
        assert.ok(wrapperAt > battlefieldAt && wrapperAt < layerAt, "the board wrapper opens before the weather layer");
    });
}

test("the wide-desktop skin still targets the wrapper as the battlefield's first child", () => {
    const css = src("styles/battle-skin.css");
    assert.match(css, /\.hex-battlefield > div:first-child:has\(> \.hex-grid-layer\)/);
});

test("the weather layer CSS is a descendant rule, not a direct-child-of-battlefield rule", () => {
    const css = src("styles/index/37-battlefield-actors.css");
    assert.match(css, /\.arena-fullscreen \.hex-battlefield \.combat-weather-layer \{/);
    assert.doesNotMatch(css, /\.hex-battlefield > \.combat-weather-layer/);
});
