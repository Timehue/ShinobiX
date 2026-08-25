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
    assert.match(source, /selfName=\{me\.name\}/);
    assert.match(source, /oppName=\{opp\.name\}/);
    assert.doesNotMatch(source, /<BattleActionBlock/);
    assert.doesNotMatch(source, /timeline-round-toggle/);

    const panelRule = battleSkinCss.match(/\.plain-combat-battle-log\s*\{([^}]*)\}/s)?.[1] ?? "";
    assert.match(panelRule, /overflow-y:\s*auto\s*!important/, "the complete log must scroll vertically");

    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log \.timeline-entry-head\s*\{[^}]*font:\s*650 clamp\(14px, 0\.95cqw, 16px\) \/ 1\.45/s,
        "shared action headlines must remain large and readable",
    );
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log \.timeline-entry,[\s\S]{0,300}?padding:\s*10px 14px\s*!important/,
        "action groups need readable spacing",
    );
    assert.match(
        battleSkinCss,
        /\.plain-combat-battle-log\.is-expanded\s*\{[^}]*position:\s*fixed\s*!important/s,
        "the log must offer a full-size reading mode",
    );
    for (const category of ["heal", "damage", "dmgmod", "shield", "control", "prevent", "tempo", "system", "effect"]) {
        assert.match(
            battleSkinCss,
            new RegExp(`\\.plain-combat-battle-log \\.battle-log-${category}\\s*\\{[^}]*color:[^;]+!important`, "s"),
            `${category} effects must outrank the legacy neutral paragraph color`,
        );
    }
});
