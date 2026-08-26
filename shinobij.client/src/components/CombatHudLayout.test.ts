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
import { groupPlainCombatLog } from "../lib/plain-combat-log";

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
    assert.match(html, /<h2>Central Meadow<\/h2>/);
    assert.match(
        html,
        /class="combat-brand-mark" role="img" aria-label="Shinobi Journey"/,
    );
    assert.match(html, /<p>Round 2<\/p>/);
    assert.match(html, /role="log" aria-live="polite" aria-label="Battle log"/);
});

test("plain combat log opens only the latest round and color-codes its effects", () => {
    const html = renderToStaticMarkup(React.createElement(PlainCombatBattleLog, {
        lines: [
            "Battle started: Rill versus Exam Proctor.",
            "Rill uses Basic Attack:",
            "160 damage to Exam Proctor.",
            "Rill takes 38 reflected damage.",
            "--- Round 2 ---",
            "Exam Proctor uses Palm Mend:",
            "Heal: Exam Proctor restores 40 HP.",
        ],
        turnLabel: "Your Turn",
        selfName: "Rill",
        oppName: "Exam Proctor",
    }));

    assert.match(html, /class="combat-text-log plain-combat-battle-log"/);
    assert.match(html, /role="log"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-label="Battle log"/);
    assert.equal((html.match(/plain-combat-log-round timeline-round/g) ?? []).length, 2);
    assert.ok(html.indexOf("Round 2") < html.indexOf("Round 1"));
    assert.doesNotMatch(html, /--- Round 2 ---/);
    assert.doesNotMatch(html, /bl-actor-player[^>]*>Rill</);
    assert.match(html, /bl-actor-enemy[^>]*>Exam Proctor</);
    assert.equal((html.match(/battle-log-damage/g) ?? []).length, 0);
    assert.match(html, /battle-log-heal/);
    assert.doesNotMatch(html, /class="bl-num">160</);
    assert.match(html, /Round 1[\s\S]*?aria-expanded="false"|aria-expanded="false"[\s\S]*?Round 1/);
    assert.match(html, /aria-label="Expand battle log"/);
    assert.match(html, /2 rounds · 6 events/);
    assert.doesNotMatch(html, /events · scroll/);
    assert.match(html, /combat-log-expand-icon/);
    assert.match(html, /role="log"/);
});

test("plain combat log derives a trimmed pre-marker round and preserves action ownership", () => {
    const rounds = groupPlainCombatLog([
        "Rill uses Basic Attack:",
        "80 damage to Exam Proctor.",
        "--- Round 8 ---",
        "Exam Proctor uses Guard:",
        "Shield: Exam Proctor gains 120 shield.",
    ], "Rill", "Exam Proctor");

    assert.deepEqual(rounds.map((group) => group.round), [7, 8]);
    assert.deepEqual(rounds.map((group) => group.lineCount), [2, 2]);
    assert.equal(rounds[0]?.actions[0]?.role, "player");
    assert.equal(rounds[1]?.actions[0]?.role, "enemy");
    assert.equal(rounds[1]?.actions[0]?.actionNumber, 2);
});

test("plain combat log hides automatic no-action turn housekeeping", () => {
    const rounds = groupPlainCombatLog([
        "Rill uses Meteor Axe Kick:",
        "Exam Proctor loses 80 HP.",
        "Rill has no legal actions remaining and ends the turn automatically.",
    ], "Rill", "Exam Proctor");

    assert.equal(rounds[0]?.lineCount, 2);
    assert.doesNotMatch(JSON.stringify(rounds), /no legal actions remaining/i);
});

test("plain combat log colors and tokenizes effects embedded in action headlines", () => {
    const html = renderToStaticMarkup(React.createElement(PlainCombatBattleLog, {
        lines: ["Rill uses Basic Heal, restoring 240 HP."],
        turnLabel: "Your Turn",
        selfName: "Rill",
        oppName: "Exam Proctor",
    }));

    assert.match(html, /class="bl-head-text battle-log-heal"/);
    assert.match(html, /restoring <\/span><span class="bl-num">240<\/span><span> HP/);
});

test("plain combat log exposes an accessible empty state", () => {
    const html = renderToStaticMarkup(React.createElement(PlainCombatBattleLog, {
        lines: [],
        turnLabel: "Waiting",
        emptyMessage: "Nothing recorded.",
    }));

    assert.match(html, /class="plain-combat-log-empty">Nothing recorded\.<\/p>/);
    assert.doesNotMatch(html, /plain-combat-log-round/);
});
