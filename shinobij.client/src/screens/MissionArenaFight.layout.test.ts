import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const missionSource = readFileSync(new URL("./MissionArenaFight.tsx", import.meta.url), "utf8");
const missionCss = readFileSync(new URL("../styles/mission-arena-fight.css", import.meta.url), "utf8");
const battleSkinCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const towerTacticalCss = readFileSync(new URL("../styles/tower-tactical.css", import.meta.url), "utf8");
const combatRestoreCss = readFileSync(new URL("../styles/index/24-combat-mobile-restore.css", import.meta.url), "utf8");
const territoryCss = readFileSync(new URL("../styles/index/15-territory-panels.css", import.meta.url), "utf8");
const combatInstanceSource = readFileSync(new URL("../components/CombatInstance.tsx", import.meta.url), "utf8");
const combatDetailPortalSource = readFileSync(new URL("../components/CombatDetailPortal.tsx", import.meta.url), "utf8");
const shinobiCombatShellSource = readFileSync(new URL("../components/ShinobiCombatShell.tsx", import.meta.url), "utf8");
const combatHudSource = readFileSync(new URL("../components/CombatHudLayout.tsx", import.meta.url), "utf8");
const pvpSource = readFileSync(new URL("./PvpBattleScreen.tsx", import.meta.url), "utf8");
const towerSource = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");

// The combat shell places its bands in a FIXED-track grid — `.combat-main-area`
// on desktop, `.combat-layout` on mobile (where `.combat-main-area` flattens to
// `display: contents`) — and orders them with `order` / explicit `grid-row`.
// A conditional extra child with the default `order: 0` sorts ahead of every
// band and takes row 1, pushing them all down one track: the terrain strip
// inherits the board's minmax(300px, 1fr) row and the hex board collapses into
// the command bar's `auto` row. Measured on this screen: 362px -> 30px, i.e. the
// board vanished the moment a jutsu was armed. `has-action-notice` is the class
// that reserves the extra track on every tier.
test("mission fight reserves a row for its action notice instead of displacing the board", () => {
    assert.match(
        missionSource,
        /<CombatHudLayout hasActionNotice>/,
        "the combat grid must always reserve the persistent action-notice row",
    );
    assert.match(
        combatHudSource,
        /combat-layout\$\{hasActionNotice \? " has-action-notice" : ""\}/,
        "the shared layout must map the notice flag to the reserved-grid class",
    );

    // Every transient message lives inside one persistent fixed-height wrapper.
    const wrapper = missionSource.match(
        /<div className="combat-action-notice">([\s\S]*?)<\/div>\s*<CombatCommandBar>/,
    );
    assert.ok(wrapper, "the notices must be wrapped in a single .combat-action-notice grid child");
    assert.match(wrapper![1], /className=\{`combat-targeting-hint/, "the targeting hint belongs in the wrapper");
    assert.match(wrapper![1], /actionNotice \|\| "\\u00a0"/, "the idle row must remain mounted");

    // Nothing may render either notice as a direct child of .combat-main-area.
    assert.equal(
        (missionSource.match(/className=\{`combat-targeting-hint/g) ?? []).length,
        1,
        "exactly one targeting-hint element, and it must be the wrapped one",
    );

    // Mobile flattens .combat-main-area with display:contents and pins every band
    // to an explicit outer-grid row, so the wrapper needs its own pin there.
    assert.match(
        missionCss,
        /\.combat-layout\.has-action-notice \.combat-action-notice\s*\{[^}]*grid-row:\s*2\s*!important;/,
        "mobile must pin the notice to the reserved row below the fighter HUDs",
    );

    // ...and that pin must be gated on the SAME breakpoint as the sibling pins it
    // sits alongside. battle-skin's block was widened 800 -> 1023 to close the
    // responsive dead band; a stale bound here would silently leave the notice
    // unpinned in exactly that range, which is how this drifted the first time.
    const siblingPinBound = (() => {
        // Anchored on the BOARD's pin, which is the load-bearing one: reserving
        // the notice row only helps if the battlefield actually moves down into
        // the row after it. (This used to anchor on `.rookie-combat-tip`, an
        // element only the retired browser PvE reducer ever rendered.)
        const anchor = battleSkinCss.indexOf(".combat-layout.has-action-notice .hex-battlefield");
        assert.ok(anchor > 0, "battle-skin must still pin the battlefield below the reserved notice row");
        const bounds = [...battleSkinCss.slice(0, anchor).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
        return bounds.length ? bounds[bounds.length - 1][1] : null;
    })();
    assert.ok(siblingPinBound, "could not read the sibling pins' breakpoint out of battle-skin.css");
    const noticeBound = (() => {
        const anchor = missionCss.indexOf(".combat-layout.has-action-notice .combat-action-notice");
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

    assert.match(
        missionCss,
        /@media \(max-width:\s*800px\) and \(max-height:\s*740px\)[\s\S]*?\.mission-arena-fight \.combat-layout > \.combat-side-hud\s*\{[^}]*padding-block:\s*0\s*!important;[\s\S]*?\.mission-arena-fight \.combat-side-hud \.resource-line--hp\s*\{[^}]*display:\s*none\s*!important;[\s\S]*?\.mission-arena-fight \.combat-side-hud \.resource-line\s*\{[^}]*row-gap:\s*0\s*!important;[\s\S]*?\.mission-arena-fight \.combat-side-hud \.hud-bar\s*\{[^}]*height:\s*4px\s*!important;[\s\S]*?\.mission-arena-fight \.combat-mobile-effects\s*\{[^}]*max-height:\s*12px\s*!important;/,
        "short mission viewports must keep non-duplicate resources and effects inside the compact fighter dossier",
    );
    assert.match(
        missionCss,
        /@media \(min-width:\s*801px\) and \(max-width:\s*1023px\) and \(max-height:\s*650px\)[\s\S]*?\.mission-arena-fight \.combat-layout > \.combat-side-hud\s*\{[^}]*padding-block:\s*0\s*!important;[^}]*row-gap:\s*0\s*!important;[\s\S]*?\.mission-arena-fight \.combat-side-hud \.hud-bar\s*\{[^}]*height:\s*4px\s*!important;[\s\S]*?\.mission-arena-fight \.combat-mobile-effects\s*\{[^}]*max-height:\s*12px\s*!important;[^}]*margin-block:\s*0\s*!important;[^}]*padding-top:\s*0\s*!important;[\s\S]*?\.mission-arena-fight \.shinobi-command-bar\s*\{[^}]*grid-template-columns:\s*repeat\(8, minmax\(0, 1fr\)\)\s*!important;[\s\S]*?\.mission-arena-fight \.shinobi-command-bar button\s*\{[^}]*min-height:\s*44px\s*!important;[\s\S]*?\.mission-arena-fight \.combat-jutsu-card-wrap\s*\{[^}]*aspect-ratio:\s*1\.05 \/ 1\s*!important;/,
        "zoom-equivalent mission viewports must retain resources and contain their effects strip",
    );
    assert.match(
        missionCss,
        /@media \(max-width:\s*360px\) and \(max-height:\s*600px\)[\s\S]*?\.mission-arena-fight \.combat-layout\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(184px, 34dvh\) auto auto minmax\(88px, 1fr\)\s*!important;[\s\S]*?\.mission-arena-fight \.combat-layout\.has-action-notice\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(184px, 34dvh\) auto auto minmax\(88px, 1fr\)\s*!important;[\s\S]*?\.mission-arena-fight \.combat-jutsu-card-wrap\s*\{[^}]*aspect-ratio:\s*1\.05 \/ 1\s*!important;/,
        "the smallest mission tier must keep the first jutsu card centre tappable without collapsing the board",
    );
    assert.match(
        missionCss,
        /@media \(min-width:\s*480px\) and \(max-width:\s*932px\) and \(max-height:\s*500px\)[\s\S]*?grid-template-rows:\s*60px auto minmax\(90px, 25dvh\)[\s\S]*?grid-template-rows:\s*32px 10px 8px\s*!important;[\s\S]*?row-gap:\s*1px\s*!important;[\s\S]*?\.mission-arena-fight \.combat-side-hud \.resource-line--hp\s*\{[^}]*display:\s*none\s*!important;[\s\S]*?\.mission-arena-fight \.combat-mobile-effects\s*\{[^}]*max-height:\s*8px\s*!important;[\s\S]*?grid-template-columns:\s*repeat\(8, minmax\(0, 1fr\)\)\s*!important;[\s\S]*?\.mission-arena-fight \.combat-jutsu-card-wrap\s*\{[^}]*aspect-ratio:\s*1\.05 \/ 1\s*!important;/,
        "short landscape mission combat must use its width for compact dossiers and a one-row command deck",
    );

    // The fix is load-bearing on that class still reserving a track.
    assert.ok(
        (battleSkinCss.match(/\.combat-layout\.has-action-notice(?: \.combat-main-area)?\s*\{[^}]*grid-template-rows:[^}]*\}/g) ?? []).length >= 3,
        "battle-skin must still reserve the extra tip row on desktop, mobile, and short-mobile",
    );
    // Reserving the track is only half of it: the board itself has to MOVE into
    // the post-notice row, or it re-collapses under the notice on the flattened
    // mobile grid. (Inherited from the retired Arena.layout test — this screen is
    // now the one rendering .hex-battlefield under .has-action-notice.)
    assert.match(
        battleSkinCss,
        /\.combat-layout\.has-action-notice \.hex-battlefield\s*\{\s*grid-row:\s*4\s*!important;/,
        "mobile must move the battlefield to the reserved post-notice row",
    );
});

// The player is a map-pin marker that fits inside its orb anchor, so a flat -16
// lift puts its HP bar just above the token. The AI is full-body sprite art that
// overflows the SAME anchor upward, so that same -16 landed the bar on the
// enemy's face. The badge has to clear whatever art the actor actually renders.
test("the enemy HP badge clears the AI's full-body sprite instead of its face", () => {
    const enemyBadge = missionSource.match(/key="enemy-hp"[\s\S]*?\/>/);
    assert.ok(enemyBadge, "mission combat must still render an on-board enemy HP badge");
    assert.match(
        enemyBadge![0],
        /top=\{top \+ HEX_H \* 0\.85 - ORB - 16 - headroom\}/,
        "the enemy badge must lift by the sprite's headroom on top of the marker offset",
    );
    assert.match(
        missionSource,
        /const headroom = battlefieldSpriteHeadroom\(ORB, enemyBattleSprite\)/,
        "the clearance must be derived from the sprite the actor is actually given",
    );

    // The player/pet badges are marker-anchored and must NOT be lifted, or their
    // bars float away from tokens that never overflowed in the first place.
    for (const key of ["player-hp", "pet-hp"]) {
        const badge = missionSource.match(new RegExp(`key="${key}"[\\s\\S]*?/>`));
        assert.ok(badge, `mission combat must still render the ${key} badge`);
        assert.doesNotMatch(badge![0], /headroom/, `${key} renders a marker, so it needs no sprite clearance`);
    }
});

// PvE lost its whole targeting telegraph when the browser reducer was retired:
// the CSS survived but no screen applied it, so an armed AOE showed nothing and
// the enemy hex was the only in-range tile with no fill. Both halves are easy to
// drop again silently — the classes are strings and the CSS is an !important
// ladder — so pin them.
test("PvE telegraphs where a tile-targeted cast lands and what it catches", () => {
    assert.match(
        missionSource,
        /isFootprintTile \? "ground-affected-tile" : ""/,
        "the hovered cast must paint the tiles it would damage",
    );
    assert.match(
        missionSource,
        /isHittingTarget \? "jutsu-aoe-tile" : ""/,
        "legal centres whose blast reaches the enemy must be marked — touch never hovers",
    );
    // The preview must be derived from the shared impact helper, which
    // jutsu-impact-preview.contract.test.ts pins against the server planner.
    // Reimplementing the footprint locally is how a telegraph starts lying.
    assert.match(missionSource, /jutsuImpactPreviewTiles\(/, "the footprint must come from the shared helper");
    assert.doesNotMatch(
        missionSource,
        /const hittingTargets[\s\S]{0,400}?towerNeighbors\(enemyPos/,
        "the hit test must go through the helper, not a hand-rolled neighbour check",
    );
    // Hover is scoped to legal centres so mousing over the board can't re-render it.
    assert.match(missionSource, /onMouseEnter=\{tileTargets\.has\(i\) \?/);
    assert.match(missionSource, /onFocus=\{tileTargets\.has\(i\) \?/, "keyboard aiming must reach the same preview");
    assert.match(
        missionSource,
        /function resetTargeting\(\)[^}]*setHoverTile\(null\)/,
        "disarming must clear the preview or a stale ring outlives its jutsu",
    );

    // The enemy hex: battle-skin withholds the blue range wash from it, so the
    // target rule has to supply a fill of its own or it renders like an
    // unhighlighted tile. Measured before the fix: rgba(51,65,85,0.35), the
    // no-highlight default, while every other in-range tile was solid blue.
    const targetRule = territoryCss.match(/body \.arena-fullscreen \.hex-tile\.jutsu-target-tile\s*\{([^}]*)\}/);
    assert.ok(targetRule, "the target-tile rule must survive");
    assert.match(targetRule![1], /background:\s*rgba\([^)]*\)\s*!important/, "the target hex needs a fill, not just a ring");
    assert.match(targetRule![1], /outline:\s*3px solid var\(--gold\)\s*!important/, "…and must keep its gold ring");

    // The "this landing catches them" marker shares tiles with .dash-target-tile /
    // .ground-target-tile, which set outline with !important at equal specificity.
    // CSS resolves that by source order, so the marker MUST come after them or it
    // is inert — exactly how .dash-target-tile itself was once invisible.
    const dashAnchor = battleSkinCss.lastIndexOf(".arena-fullscreen .hex-tile:is(.hex-enemy, .hex-player).dash-target-tile");
    const hitAnchor = battleSkinCss.indexOf(".arena-fullscreen .hex-tile:is(.dash-target-tile, .ground-target-tile).jutsu-aoe-tile");
    assert.ok(dashAnchor > 0, "the dash-target rules must still exist");
    assert.ok(hitAnchor > 0, "the blast-connects marker must be styled over landing tiles");
    assert.ok(
        hitAnchor > dashAnchor,
        "the .jutsu-aoe-tile marker must be declared AFTER the dash/ground rules it shares !important specificity with, or it never paints",
    );
    assert.match(
        battleSkinCss.slice(hitAnchor, battleSkinCss.indexOf("}", hitAnchor)),
        /outline:\s*3px solid rgba\(250, 204, 21[^)]*\)\s*!important/,
        "the connects-marker must override the landing tile's own outline",
    );
    assert.match(
        battleSkinCss,
        /\.arena-fullscreen \.hex-tile\.ground-affected-tile\s*\{[^}]*background:\s*rgba\([^)]*\)\s*!important/,
        "the blast footprint needs a fill to read over the painted arena art",
    );
});

test("soft action rejections retain Solo and Tower targeting selection", () => {
    const missionSend = missionSource.slice(
        missionSource.indexOf("async function send("),
        missionSource.indexOf("function onTileClick", missionSource.indexOf("async function send(")),
    );
    assert.match(missionSend, /if \(!res\.applied\)[\s\S]*?setReject\([\s\S]*?\}\s*else\s*\{\s*resetTargeting\(\);/);

    const towerSend = towerSource.slice(
        towerSource.indexOf("async function send("),
        towerSource.indexOf("function onTileClick", towerSource.indexOf("async function send(")),
    );
    assert.match(towerSend, /if \(res\.applied\) \{[\s\S]*?clearTargeting\(\);[\s\S]*?\} else \{[\s\S]*?phase: "error"/);

    for (const [name, sendSource] of [["mission", missionSend], ["tower", towerSend]] as const) {
        const finallyBlock = sendSource.match(/finally\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
        assert.doesNotMatch(finallyBlock, /setMode\("idle"\)|setSelJutsu\(null\)|setSelWeaponId\(""\)/,
            `${name} finally block must not discard a softly rejected action`);
    }
});

test("Solo and Tower mirror PvP's legacy self-buff targeting classifier", () => {
    for (const source of [missionSource, towerSource]) {
        assert.match(source, /!isMoveJutsu\(j\)/);
        assert.match(source, /target !== "EMPTY_GROUND"/);
        assert.match(source, /!pvpAffectsOpponent/);
    }
});

test("Solo and Tower submit highlighted movement-jutsu tiles through the jutsu path", () => {
    for (const [name, source, rangeSet] of [
        ["mission", missionSource, "rangeTiles"],
        ["tower", towerSource, "jutsuRangeTiles"],
    ] as const) {
        const moveNeedle = `if (mode === "jutsu" && selJutsu?.id && isMoveJutsu(selJutsu) && ${rangeSet}.has(tile))`;
        const moveBranch = source.indexOf(moveNeedle);
        const groundBranch = source.indexOf('if (mode === "jutsu" && selJutsu?.id && selJutsu.target === "EMPTY_GROUND"');
        assert.ok(moveBranch >= 0, `${name} must submit a highlighted movement-jutsu destination`);
        assert.ok(groundBranch > moveBranch, `${name} must classify movement before generic ground targeting`);
        assert.match(
            source.slice(moveBranch, groundBranch),
            /send\(\{ type: "jutsu", jutsuId: selJutsu\.id, tile \}\)/,
            `${name} movement must retain its jutsu id and destination tile`,
        );
    }
});

test("Tower keeps target guidance geometry stable and disables off-turn actions semantically", () => {
    assert.match(towerSource, /id="tower-action-guidance" className=\{`tower-action-state/, "Tower must render one persistent guidance row");
    assert.match(towerSource, /: "Choose an action"/, "the idle guidance row must remain mounted");
    assert.match(
        towerTacticalCss,
        /\.tower-action-state\s*\{[^}]*height:\s*58px;[^}]*min-height:\s*58px;[^}]*max-height:\s*58px;/,
        "Tower guidance must reserve one fixed track so arming cannot resize the board",
    );
    assert.match(towerSource, /function armJutsuCard[\s\S]*?if \(busy \|\| !myTurn\) return;/,
        "Tower's handler must reject keyboard/programmatic off-turn arming");
    assert.ok((towerSource.match(/disabled=\{!myTurn \|\|/g) ?? []).length >= 9,
        "Tower action buttons must be natively disabled off turn");
    assert.ok((towerSource.match(/aria-pressed=\{/g) ?? []).length >= 6,
        "Tower toggle actions must expose their armed state");
    assert.match(towerSource, /const adjustedActionAp = \(base: number\) => adjustedCombatApCost/,
        "Tower cards and commands must mirror canonical Lag/Overclock costs");
    assert.doesNotMatch(towerSource, /session\.activeAp < (?:30|40|60)/,
        "Tower controls must not gate paid actions with raw AP constants");
    assert.match(towerSource, /isElementallySealedForDisplay/,
        "Tower jutsu affordance must mirror the canonical Elemental Seal gate");
});

test("combat detail focus never scrolls the contained action tray", () => {
    const focusCalls = combatDetailPortalSource.match(/\.focus\(([^)]*)\)/g) ?? [];
    assert.ok(focusCalls.length >= 4, "the portal must still manage open, trap, and return focus");
    for (const call of focusCalls) {
        assert.match(call, /preventScroll:\s*true/, `${call} must opt out of browser scroll restoration`);
    }
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

test("every live shinobi fight uses the shared viewport-level combat instance", () => {
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
        const anchor = battleSkinCss.indexOf(".combat-layout.has-action-notice .hex-battlefield");
        assert.ok(anchor > 0, "battle-skin must still pin the battlefield on the flattened mobile grid");
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
