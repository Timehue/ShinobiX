import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PvpBattleScreen.tsx", import.meta.url), "utf8");
const battleSkinCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");
const combatHudSource = readFileSync(new URL("../components/CombatHudLayout.tsx", import.meta.url), "utf8");

test("the opponent's turn does not replace the PvP jutsu or battle-log area", () => {
    assert.doesNotMatch(source, /is taking their turn/, "the redundant opponent-turn panel must stay removed");
    assert.doesNotMatch(source, /Claim Win \(Opponent AFK\)/, "AFK handling must not reintroduce a large manual panel");

    assert.match(
        source,
        /<CombatCommandBar style=\{isMyTurn \? undefined : \{ opacity: 0\.55 \}\}/,
        "basic actions should remain visible while waiting",
    );
    assert.match(
        source,
        /<div style=\{isMyTurn \? \{ display: "contents" \} : \{ opacity: 0\.6 \}\}>/,
        "the equipped jutsu and item grid should remain visible while waiting",
    );
    assert.doesNotMatch(source, /opacity: 0\.(?:55|6), pointerEvents: "none"/,
        "waiting-state containers must not block usable inspect/help controls");
    const commandBar = source.slice(source.indexOf("<CombatCommandBar style="), source.indexOf("</CombatCommandBar>"));
    assert.equal((commandBar.match(/disabled=\{!isMyTurn \|\|/g) ?? []).length, 7,
        "all seven command actions must expose a real opponent-turn disabled state");
    const actionGrid = source.slice(source.indexOf('<div style={isMyTurn ? { display: "contents" }'), source.indexOf("{inspectedWeaponId &&"));
    assert.equal((actionGrid.match(/disabled=\{!isMyTurn \|\|/g) ?? []).length, 4,
        "jutsu, weapon, thrown, and consumable action buttons must be disabled while waiting");
    assert.doesNotMatch(actionGrid, /className="combat-jutsu-help"[\s\S]{0,500}?disabled=/,
        "detail/help buttons must remain available for planning on the opponent's turn");
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

test("the PvP battle log uses the scrollable, round-grouped semantic feed", () => {
    // The feed is still session-owned; battleLogLines is session.log plus a
    // transient move-feedback line, so assert both the wiring and its derivation
    // rather than the old inline lines={session.log}.
    assert.match(source, /<PlainCombatBattleLog[\s\S]*?lines=\{battleLogLines\}/);
    assert.match(source, /const battleLogLines = session && moveFeedback\s*\?\s*\[\.\.\.session\.log, `⚠️ \$\{moveFeedback\}`\]\s*:\s*\(session\?\.log \?\? \[\]\)/,
        "the PvP log must stay fed by the authoritative session log");
    assert.match(source, /from "\.\.\/components\/CombatHudLayout"/);
    assert.match(combatHudSource, /className=\{classNames\("combat-text-log", className\)\}/);
    assert.match(
        combatHudSource,
        /<CombatBattleLogPanel[\s\S]*?className=\{classNames\(`plain-combat-battle-log/,
    );
    assert.match(combatHudSource, /groupPlainCombatLog\(lines, selfName, oppName\)/);
    assert.match(combatHudSource, /<BattleActionBlock/);
    assert.match(combatHudSource, /<BattleLogLine/);
    assert.match(combatHudSource, /className="timeline-round-header timeline-round-toggle"/);
    assert.match(combatHudSource, /className="combat-log-expand"/);
    assert.match(combatHudSource, /className="combat-log-scroll-region" tabIndex=\{0\}/,
        "the feed needs a dedicated keyboard-scrollable region below its fixed header");
    assert.match(source, /selfName=\{me\.name\}/);
    assert.match(source, /oppName=\{opp\.name\}/);
    assert.doesNotMatch(source, /<BattleActionBlock/);
    assert.doesNotMatch(source, /timeline-round-toggle/);

    const panelRule = battleSkinCss.match(/\.plain-combat-battle-log\s*\{([^}]*)\}/s)?.[1] ?? "";
    assert.match(panelRule, /overflow-y:\s*auto\s*!important/, "the legacy panel rule must retain its scroll fallback");
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log > \.combat-log-scroll-region\s*\{[^}]*overflow-y:\s*auto\s*!important/s,
        "the complete log must scroll inside a dedicated region without clipping the header",
    );
    assert.match(
        battleSkinCss,
        /\.combat-main-area\.bt-actions \.combat-text-log\s*\{\s*display:\s*none\s*!important;/,
        "the scrollable log must stay hidden behind the mobile Actions tab",
    );
    assert.match(
        battleSkinCss,
        /\.combat-main-area\.bt-log \.combat-text-log\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-direction:\s*column\s*!important;/s,
        "the mobile Battle Log tab must own the fixed-header scroll layout",
    );

    // The fixed-header contract is deliberately late in battle-skin.css. Its
    // broad #combat rules may define flex structure, but must not also choose
    // visibility: doing so repaints the log over compact action cards and steals
    // their hit targets (most visibly in Firefox). Visibility belongs to the
    // active tab and to the separate desktop command-center media contract.
    const fixedHeaderContract = battleSkinCss.indexOf("/* Keep combat-log chrome outside the scrolling surface.");
    assert.ok(fixedHeaderContract >= 0, "the late fixed-header log contract must remain identifiable");

    const readRule = (selectorAnchor: string) => {
        const start = battleSkinCss.indexOf(selectorAnchor, fixedHeaderContract);
        assert.ok(start >= fixedHeaderContract, `missing fixed-header rule beginning ${selectorAnchor}`);
        const open = battleSkinCss.indexOf("{", start);
        const close = battleSkinCss.indexOf("}", open);
        assert.ok(open > start && close > open, `malformed fixed-header rule beginning ${selectorAnchor}`);
        return {
            start,
            close,
            selectors: battleSkinCss.slice(start, open),
            declarations: battleSkinCss.slice(open + 1, close),
        };
    };
    const broadChrome = readRule("#combat .plain-combat-battle-log,");
    const idChrome = readRule("html body > #combat.arena-fullscreen.shinobi-combat-shell .plain-combat-battle-log,");
    for (const rule of [broadChrome, idChrome]) {
        assert.match(rule.declarations, /flex-direction:\s*column\s*!important/);
        assert.doesNotMatch(
            rule.declarations,
            /\bdisplay\s*:/,
            "broad fixed-header chrome must not override Actions/Battle Log tab visibility",
        );
    }

    const activeLog = readRule("#combat .combat-main-area.bt-log .plain-combat-battle-log,");
    assert.ok(
        activeLog.start > broadChrome.close && activeLog.start > idChrome.close,
        "the active-log visibility rule must follow both broad fixed-header chrome rules",
    );
    assert.match(activeLog.selectors, /\.combat-main-area\.bt-log \.plain-combat-battle-log/);
    assert.match(activeLog.selectors, /\.plain-combat-battle-log\.is-expanded/);
    assert.match(
        activeLog.declarations,
        /display:\s*flex\s*!important/,
        "only the active Battle Log tab or expanded reader should restore the fixed-header flex panel",
    );

    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log \.timeline-entry-head\s*\{[^}]*font:\s*650 clamp\(13px, 0\.88cqw, 15px\) \/ 1\.35/s,
        "shared action headlines must remain readable without dominating the feed",
    );
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log \.timeline-entry,[\s\S]{0,300}?padding:\s*8px 11px\s*!important/,
        "action groups need compact but readable spacing",
    );
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log > \.combat-log-header\s*\{[^}]*min-height:\s*46px;[^}]*padding:\s*5px 9px 5px 13px\s*!important/s,
        "the log header should preserve vertical space for combat history",
    );
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log\.is-expanded\s*\{[^}]*position:\s*fixed\s*!important/s,
        "the log must offer a full-size reading mode",
    );
    for (const category of ["heal", "damage", "dmgmod", "shield", "control", "prevent", "tempo", "system", "effect"]) {
        assert.match(
            battleSkinCss,
            new RegExp(`\\.battle-log-${category}\\s*\\{[^}]*--battle-log-rgb:`, "s"),
            `${category} effects need their own semantic color token`,
        );
    }
    assert.match(
        battleSkinCss,
        /\.shinobi-combat-shell \.timeline-fx\.battle-log-line\s*\{[^}]*color:\s*rgb\(var\(--battle-log-rgb\)\)\s*!important/s,
        "semantic battle-log colors must outrank the legacy neutral paragraph color",
    );
    assert.match(
        battleSkinCss,
        /\.shinobi-combat-shell \.timeline-fx\.battle-log-line > span\s*\{[^}]*color:\s*inherit\s*!important/s,
        "nested log text must preserve the semantic effect color",
    );
});

test("collapsing desktop chat widens the log without borrowing mobile tab state", () => {
    assert.match(source, /<CombatHudLayout className=\{battleChatVisible \? undefined : "combat-log-wide combat-chat-collapsed"\}>/);
    assert.match(source, /className=\{`battle-chat-panel battle-chat-col\$\{battleChatVisible \? "" : " battle-chat-hidden"\}`\}/);
    assert.match(source, /aria-controls=\{battleChatVisible \? "battle-chat-feed" : undefined\}/,
        "collapsed chat must not retain an IDREF to an unmounted feed");
    assert.match(source, /\[battleChatMessages, battleChatVisible\]/, "reopening chat must restore the feed at its newest message");
    assert.match(
        battleSkinCss,
        /@media \(min-width: 1280px\) and \(min-height: 700px\)[\s\S]*?#combat \.combat-layout\.combat-log-wide \.combat-text-log\s*\{[^}]*grid-column: 3 \/ 6 !important/s,
    );
    assert.match(
        battleSkinCss,
        /#combat \.combat-layout\.combat-chat-collapsed > \.battle-chat-col\.battle-chat-hidden\s*\{[^}]*position: absolute !important;[^}]*height: 46px !important/s,
    );
    const desktopExpansion = battleSkinCss.slice(battleSkinCss.indexOf("Desktop-only command center"));
    assert.doesNotMatch(desktopExpansion, /\.bt-log[^}]*grid-column: 3 \/ 6/);
    assert.doesNotMatch(desktopExpansion, /\.is-expanded[^}]*grid-column: 3 \/ 6/);
});

test("combat cards use consistent art crops and separated overlay metadata", () => {
    assert.match(
        battleSkinCss,
        /html body > \.arena-fullscreen\.shinobi-combat-shell \.combat-jutsu-button\s*\{[^}]*position:\s*relative\s*!important;[^}]*display:\s*block\s*!important;[^}]*padding:\s*0\s*!important;/s,
        "the late shared-shell contract must not turn the card back into a compressed metadata grid",
    );
    assert.match(
        battleSkinCss,
        /html\[data-vp\] body > \.arena-fullscreen\.shinobi-combat-shell \.combat-jutsu-thumb\s*\{[^}]*position:\s*absolute\s*!important;[^}]*inset:\s*0\s*!important;[^}]*height:\s*100%\s*!important;[^}]*max-height:\s*none\s*!important;/s,
        "jutsu artwork should fill the card instead of collapsing to a 28–44px strip",
    );
    assert.match(
        battleSkinCss,
        /#combat \.combat-jutsu-thumb > img\s*\{[^}]*object-fit: cover !important;[^}]*object-position: center 42% !important/s,
        "desktop jutsu, weapon, and item art must share one stable edge-to-edge crop",
    );
    assert.match(source, /localJutsuArtById\[jutsu\.id\][\s\S]*?localItemArtById\[item\.id\]/,
        "the local equipped catalogs must restore art stripped from the sealed PvP payload");
    assert.ok((source.match(/className="combat-jutsu-fallback-icon" aria-hidden="true"/g) ?? []).length >= 4,
        "every combat card category needs a decorative fallback behind failed artwork");
    assert.match(
        battleSkinCss,
        /#combat \.battle-chat-messages\s*\{[^}]*max-height:\s*none\s*!important/s,
        "tall desktop chat should use the full mode-panel height",
    );
    assert.match(
        battleSkinCss,
        /html\[data-vp\] body > \.arena-fullscreen\.shinobi-combat-shell \.combat-jutsu-name\s*\{[^}]*position:\s*absolute\s*!important;[^}]*inset:\s*auto 0 17px\s*!important;[^}]*-webkit-line-clamp:\s*2\s*!important;[^}]*background:\s*linear-gradient/s,
        "the jutsu name needs its own readable bottom nameplate",
    );
    assert.match(
        battleSkinCss,
        /\.combat-jutsu-method-target\s*\{\s*top:\s*5px\s*!important;[^}]*\}[\s\S]*?\.combat-jutsu-resources\s*\{\s*top:\s*23px\s*!important;/,
        "method/target and resource badges must occupy separate overlay rows",
    );
});
