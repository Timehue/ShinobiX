import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const missionSource = readFileSync(new URL("./MissionArenaFight.tsx", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const battleSkinCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const combatRestoreCss = readFileSync(new URL("../styles/index/24-combat-mobile-restore.css", import.meta.url), "utf8");
const combatInstanceSource = readFileSync(new URL("../components/CombatInstance.tsx", import.meta.url), "utf8");
const shinobiCombatShellSource = readFileSync(new URL("../components/ShinobiCombatShell.tsx", import.meta.url), "utf8");
const combatHudSource = readFileSync(new URL("../components/CombatHudLayout.tsx", import.meta.url), "utf8");
const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const pvpSource = readFileSync(new URL("./PvpBattleScreen.tsx", import.meta.url), "utf8");
const towerSource = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");

// The combat shell places its bands in a FIXED-track grid — `.combat-main-area`
// on desktop, `.combat-layout` on mobile (where `.combat-main-area` flattens to
// `display: contents`) — and orders them with `order` / explicit `grid-row`.
// A conditional extra child with the default `order: 0` sorts ahead of every
// band and takes row 1, pushing them all down one track: the terrain strip
// inherits the board's minmax(300px, 1fr) row and the hex board collapses into
// the command bar's `auto` row. Measured on this screen: 362px -> 30px, i.e. the
// board vanished the moment a jutsu was armed. `has-rookie-tip` is the class
// that reserves the extra track on every tier.
test("mission fight reserves a row for its action notice instead of displacing the board", () => {
    assert.match(
        missionSource,
        /<CombatHudLayout hasActionNotice=\{hasActionNotice\}>/,
        "the combat grid must be marked whenever the action notice is rendered",
    );
    assert.match(
        combatHudSource,
        /combat-layout\$\{hasActionNotice \? " has-rookie-tip" : ""\}/,
        "the shared layout must map the notice flag to the reserved-grid class",
    );

    assert.match(
        missionSource,
        /const hasActionNotice = !!reject \|\| showTargetingHint;/,
        "the marker must track BOTH conditional notices, not just one of them",
    );

    // Both notices must live inside the single wrapper. Two bare children would
    // need two extra tracks, and `has-rookie-tip` only reserves one.
    const wrapper = missionSource.match(
        /<div className="combat-action-notice">([\s\S]*?)<\/div>\s*\)\}/,
    );
    assert.ok(wrapper, "the notices must be wrapped in a single .combat-action-notice grid child");
    assert.match(wrapper![1], /className="rookie-combat-tip"/, "the rejection alert belongs in the wrapper");
    assert.match(wrapper![1], /className="combat-targeting-hint"/, "the targeting hint belongs in the wrapper");

    // Nothing may render either notice as a direct child of .combat-main-area.
    assert.equal(
        (missionSource.match(/className="combat-targeting-hint"/g) ?? []).length,
        1,
        "exactly one targeting-hint element, and it must be the wrapped one",
    );

    // Mobile flattens .combat-main-area with display:contents and pins every band
    // to an explicit outer-grid row, so the wrapper needs its own pin there.
    assert.match(
        missionCss,
        /\.combat-layout\.has-rookie-tip \.combat-action-notice\s*\{[^}]*grid-row:\s*2\s*!important;/,
        "mobile must pin the notice to the reserved row below the fighter HUDs",
    );

    // ...and that pin must be gated on the SAME breakpoint as the sibling pins it
    // sits alongside. battle-skin's block was widened 800 -> 1023 to close the
    // responsive dead band; a stale bound here would silently leave the notice
    // unpinned in exactly that range, which is how this drifted the first time.
    const siblingPinBound = (() => {
        const anchor = battleSkinCss.indexOf(".combat-layout.has-rookie-tip .rookie-combat-tip");
        assert.ok(anchor > 0, "battle-skin must still pin Arena's rookie tip on the flattened grid");
        const bounds = [...battleSkinCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return bounds.length ? bounds[bounds.length - 1][1] : null;
    })();
    assert.ok(siblingPinBound, "could not read the sibling pins' breakpoint out of battle-skin.css");
    const noticeBound = (() => {
        const anchor = missionCss.indexOf(".combat-layout.has-rookie-tip .combat-action-notice");
        const bounds = [...missionCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return bounds.length ? bounds[bounds.length - 1][1] : null;
    })();
    assert.equal(
        noticeBound,
        siblingPinBound,
        `the notice pin is gated at max-width ${noticeBound}px but the sibling band pins it lines up with are gated at ${siblingPinBound}px — they must match`,
    );

    const missionTabRule = missionCss.match(
        /\.arena-fullscreen\.pvp-battle-layout\.mission-arena-fight \.battle-tab\s*\{([^}]*)\}/,
    );
    assert.ok(missionTabRule, "mobile tab sizing must remain scoped to mission combat");
    assert.match(
        missionTabRule![1],
        /min-height:\s*44px\s*!important/,
        "mission mobile tabs must preserve the minimum accessible touch target",
    );
    const missionTabAnchor = missionCss.indexOf(
        ".arena-fullscreen.pvp-battle-layout.mission-arena-fight .battle-tab",
    );
    const missionTabBounds = [
        ...missionCss.slice(0, missionTabAnchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g),
    ];
    assert.equal(
        missionTabBounds.at(-1)?.[1],
        siblingPinBound,
        "the mission touch-target correction must use the shared mobile boundary",
    );

    // The fix is load-bearing on that class still reserving a track.
    assert.ok(
        (battleSkinCss.match(/\.combat-layout\.has-rookie-tip(?: \.combat-main-area)?\s*\{[^}]*grid-template-rows:[^}]*\}/g) ?? []).length >= 3,
        "battle-skin must still reserve the extra tip row on desktop, mobile, and short-mobile",
    );
});

test("mission desktop restores the dossier-board-dossier composition and full-width battlefield", () => {
    assert.match(
        missionSource,
        /<CombatInstance(?:\s|>)/,
        "mission combat must use the viewport boundary without opting into the aspect-locked shared shell",
    );
    assert.doesNotMatch(missionSource, /<ShinobiCombatShell(?:\s|>)/);
    assert.doesNotMatch(missionSource, /<CombatBoardStage(?:\s|>)/);

    assert.match(
        missionCss,
        /html\[data-vp="xl"\][\s\S]*?html\[data-vp="lg"\][\s\S]*?\.combat-side-hud:first-child\s*\{[^}]*display:\s*flex\s*!important;/,
        "the in-grid player dossier must remain visible on wide mission combat",
    );
    assert.match(
        missionCss,
        /grid-template-columns:\s*minmax\(140px, 210px\) minmax\(0, 1fr\) minmax\(140px, 210px\)\s*!important;/,
        "wide mission combat must keep player, battlefield, and enemy columns",
    );

    const desktopBoardRule = battleSkinCss.match(
        /\.arena-fullscreen\.pvp-battle-layout \.hex-battlefield,[\s\S]*?\{([^}]*)\}/,
    );
    assert.ok(desktopBoardRule, "desktop combat must retain its battlefield sizing rule");
    assert.match(desktopBoardRule![1], /height:\s*100%\s*!important/);
    assert.match(desktopBoardRule![1], /width:\s*100%\s*!important/);

    const desktopTabsRule = battleSkinCss.match(
        /\.arena-fullscreen\.pvp-battle-layout \.battle-tabbar\s*\{([^}]*)\}/,
    );
    assert.ok(desktopTabsRule, "desktop combat must retain its tab-bar rule");
    assert.match(desktopTabsRule![1], /display:\s*none\s*!important/);
});

test("every shinobi fight uses the shared viewport-level combat instance", () => {
    assert.match(
        combatInstanceSource,
        /createPortal\(combat, document\.body\)/,
        "the shared fight boundary must mount directly under body, outside every menu and page layout",
    );

    assert.match(
        shinobiCombatShellSource,
        /<CombatInstance(?:\s|>)/,
        "the shared PvP/Solo presentation shell must retain the viewport-level combat boundary",
    );

    assert.match(towerSource, /<CombatInstance(?:\s|>)/, "tower PvE/PvP must render through CombatInstance");
    assert.match(
        arenaSource,
        /<(?:CombatInstance|ShinobiCombatShell)(?:\s|>)/,
        "legacy Arena PvE must retain a viewport-level combat boundary",
    );
    assert.match(missionSource, /<CombatInstance(?:\s|>)/, "mission PvE must render through CombatInstance");
    assert.match(pvpSource, /<ShinobiCombatShell(?:\s|>)/, "session PvP must render through ShinobiCombatShell");

    assert.ok(
        (pvpSource.match(/<(?:CombatInstance|ShinobiCombatShell)(?:\s|>)/g) ?? []).length >= 2,
        "PvP must use the instance boundary while connecting and the shared shell after the session loads",
    );

    const cssWithoutComments = battleSkinCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const rootRule = cssWithoutComments.match(/html body > \.arena-fullscreen\.combat-instance\s*\{([^}]*)\}/);
    assert.ok(rootRule, "the shared combat instance must own a direct-body viewport rule");
    assert.match(rootRule![1], /position:\s*fixed\s*!important/, "responsive arena rules must not put a fight back in document flow");
    assert.match(rootRule![1], /inset:\s*0\s*!important/, "the fight must begin at the visible viewport edge");
    assert.match(rootRule![1], /height:\s*100dvh\s*!important/, "generic desktop height:auto must not make the fight page-sized");
    assert.match(rootRule![1], /max-height:\s*100dvh\s*!important/, "the fight must remain bounded to one viewport");
    assert.match(rootRule![1], /overflow:\s*hidden\s*!important/, "combat bands must stay inside the viewport-owned shell");

    assert.match(
        cssWithoutComments,
        /body:has\(> \.combat-instance\)\s*\{[^}]*overflow:\s*hidden\s*!important/,
        "the covered app page must not scroll underneath any active fight",
    );
});

// The combat mobile/desktop boundary is duplicated across THREE stylesheets. The
// test above only compared two of them, which is how 24-combat-mobile-restore.css
// sat at 800/801 unnoticed while the other two moved to 1023/1024.
//
// A specificity accident masked the drift: battle-skin's compact rules are keyed on
// `.arena-fullscreen.pvp-battle-layout` (two classes) and outrank the plain
// `.arena-fullscreen` selectors in the restore file, so Arena, PvP and mission
// fights — all of which add `pvp-battle-layout` — looked right. Battle Towers
// renders a bare `.arena-fullscreen`, so tower fights alone flipped to the desktop
// 3-column grid at 801px while every other fight stayed compact until 1024px: the
// same window width, two different combat shells.
test("all three combat stylesheets share one mobile/desktop boundary", () => {
    // `.arena-fullscreen .combat-layout` is the grid definition that actually
    // switches shells, so read the bound off the block that contains it.
    const restoreMobileBound = (() => {
        const anchor = combatRestoreCss.indexOf(".arena-fullscreen .combat-layout {");
        assert.ok(anchor > 0, "combat restore must still define the mobile .combat-layout grid");
        const bounds = [...combatRestoreCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        assert.ok(bounds.length, "the mobile .combat-layout grid must live inside a max-width block");
        return Number(bounds[bounds.length - 1][1]);
    })();

    const battleSkinMobileBound = (() => {
        const anchor = battleSkinCss.indexOf(".combat-layout.has-rookie-tip .rookie-combat-tip");
        const bounds = [...battleSkinCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return Number(bounds[bounds.length - 1][1]);
    })();

    assert.equal(
        restoreMobileBound,
        battleSkinMobileBound,
        `24-combat-mobile-restore.css switches the combat grid at max-width ${restoreMobileBound}px but ` +
        `battle-skin.css uses ${battleSkinMobileBound}px — Battle Towers (no .pvp-battle-layout class) would ` +
        `get a different combat shell than Arena at the same window width`,
    );

    // The desktop half must be exactly one pixel above the mobile half, or the
    // boundary either overlaps (both apply) or gaps (neither does).
    const restoreDesktopBound = (() => {
        const opener = /@media \(min-width:\s*(\d+)px\)\s*\{/g;
        const found: number[] = [];
        for (let m = opener.exec(combatRestoreCss); m !== null; m = opener.exec(combatRestoreCss)) {
            found.push(Number(m[1]));
        }
        assert.ok(found.length, "combat restore must still carry a desktop min-width block");
        return Math.max(...found);
    })();

    assert.equal(
        restoreDesktopBound,
        restoreMobileBound + 1,
        `the desktop combat block opens at min-width ${restoreDesktopBound}px but the mobile block ends at ` +
        `${restoreMobileBound}px — they must be adjacent`,
    );
});
