import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    CombatApPanel,
    CombatBattleLogPanel,
    CombatBoardStage,
    CombatCommandBar,
    CombatEnvironmentStrip,
    CombatHudHeader,
    CombatHudLayout,
    CombatHudMain,
    PlainCombatBattleLog,
} from "./CombatHudLayout";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("shared combat HUD primitives preserve the shell class contract", () => {
    const html = renderToStaticMarkup(
        React.createElement(
            CombatHudLayout,
            { hasActionNotice: true, className: "mode-layout" },
            React.createElement(
                CombatHudMain,
                { activeTab: "log", className: "mode-main" },
                React.createElement(CombatHudHeader, { title: "Central Meadow", subtitle: "Round 2" }),
                React.createElement(CombatEnvironmentStrip, null, "Clear Skies"),
                React.createElement(CombatApPanel, null, "100 AP"),
                React.createElement(CombatBoardStage, null, "Board"),
                React.createElement(CombatCommandBar, null, "Commands"),
                React.createElement(CombatBattleLogPanel, { turnLabel: "Your Turn" }, "Events"),
            ),
        ),
    );

    for (const className of [
        "combat-layout has-action-notice mode-layout",
        "combat-main-area bt-log mode-main",
        "arena-top-panel",
        "arena-title-panel",
        "twp-strip",
        "dual-ap-panel",
        "combat-board-stage",
        "basic-action-bar shinobi-command-bar",
        "combat-text-log",
    ]) {
        assert.match(html, new RegExp(`class="${className}"`));
    }
    assert.match(html, /<h2>Central Meadow<\/h2><p>Round 2<\/p>/);
    assert.match(html, /role="log" aria-live="polite" aria-label="Battle log"/);
});

test("plain combat log keeps every line, renders newest-first, and marks rounds", () => {
    const html = renderToStaticMarkup(React.createElement(PlainCombatBattleLog, {
        lines: ["Battle started.", "First action", "--- Round 2 ---", "Newest action"],
        turnLabel: "Your Turn",
    }));

    assert.match(html, /class="combat-text-log plain-combat-battle-log"/);
    assert.match(html, /role="log"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-label="Battle log"/);
    assert.equal((html.match(/plain-combat-log-line/g) ?? []).length, 4);
    assert.match(html, /plain-combat-log-line plain-combat-log-round/);
    assert.ok(html.indexOf("Newest action") < html.indexOf("--- Round 2 ---"));
    assert.ok(html.indexOf("--- Round 2 ---") < html.indexOf("First action"));
    assert.ok(html.indexOf("First action") < html.indexOf("Battle started."));
});

test("plain combat log exposes an accessible empty state", () => {
    const html = renderToStaticMarkup(React.createElement(PlainCombatBattleLog, {
        lines: [],
        turnLabel: "Waiting",
        emptyMessage: "Nothing recorded.",
    }));

    assert.match(html, /class="plain-combat-log-empty">Nothing recorded\.<\/p>/);
    assert.doesNotMatch(html, /plain-combat-log-line/);
});
