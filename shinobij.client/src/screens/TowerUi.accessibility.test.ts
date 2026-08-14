import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readyRoom = readFileSync(new URL("../components/TowerReadyRoomPanel.tsx", import.meta.url), "utf8");
const pvpPanel = readFileSync(new URL("../components/TowerPvpPanel.tsx", import.meta.url), "utf8");
const fight = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8");
const lobbyCss = readFileSync(new URL("../styles/tower-lobby.css", import.meta.url), "utf8");
const tacticalCss = readFileSync(new URL("../styles/tower-tactical.css", import.meta.url), "utf8");

test("Tower party readiness and novice-recruit limits are announced and operable", () => {
    assert.match(readyRoom, /const readyCount = party\?\.members\.filter\(member => member\.ready\)\.length \?\? 0/);
    assert.match(readyRoom, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(readyRoom, /className="tower-ready-toggle"[\s\S]{0,160}?aria-pressed=\{Boolean\(me\?\.ready\)\}/);
    assert.match(readyRoom, /id="tower-ready-room-ai-description"/);
    assert.match(readyRoom, /aria-describedby="tower-ready-room-ai-description"/);
    assert.match(readyRoom, /<progress value=\{readyCount\} max=\{party\.members\.length\}/);
    assert.match(readyRoom, /aria-label=\{`Squad readiness: \$\{readyCount\} of \$\{party\.members\.length\} members ready`\}/);
    assert.match(readyRoom, /Array\.from\(\{ length: openSlotCount \}/);
});

test("Tower Ready Room protects keyboard focus and destructive team-forming actions", () => {
    assert.match(readyRoom, /className="tower-ready-room-recruit" onSubmit=\{event =>/);
    assert.match(readyRoom, /event\.nativeEvent\.isComposing/);
    assert.match(readyRoom, /requestAnimationFrame\(\(\) => activeRoomHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)\)/);
    assert.match(readyRoom, /requestAnimationFrame\(\(\) => openRoomHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)\)/);
    assert.match(readyRoom, /gameConfirm\(leaveRoomPrompt\(party, isHost\)\)/);
    assert.match(readyRoom, /<details className="tower-ready-room-other-invitations">/);
});

test("Tower lobby controls preserve 44px targets and reduced-motion matchmaking", () => {
    assert.match(lobbyCss, /\.tower-pvp-panel button\s*\{\s*min-height:\s*44px/);
    assert.match(lobbyCss, /\.tower-ready-room button,[\s\S]{0,120}?min-height:\s*44px/);
    assert.match(lobbyCss, /\.tower-ready-room \.tower-ready-room-remove\s*\{[\s\S]{0,100}?min-height:\s*44px/);
    assert.match(lobbyCss, /\.tower-ready-room-pending button\s*\{\s*min-height:\s*44px/);
    assert.match(lobby, /className="back-btn tower-lobby-back"/);
    assert.match(lobbyCss, /\.tower-lobby-back\s*\{\s*min-height:\s*44px/);
    assert.match(lobbyCss, /\.tower-floor-load-error button,[\s\S]{0,100}?min-height:\s*44px/);
    assert.match(lobbyCss, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tower-pvp-search-orb\s*\{\s*animation:\s*none/);
});

test("Story chapters expose a navigable campaign hierarchy on narrow screens", () => {
    assert.match(lobby, /className="tower-story-campaign" aria-labelledby="tower-story-floors-title"/);
    assert.match(lobby, /<section key=\{chapter\.key\}[\s\S]{0,160}?aria-labelledby=\{chapterTitleId\}/);
    assert.match(lobby, /className="tower-story-floor-grid" role="list"/);
    assert.match(lobby, /role="listitem" className="tower-story-floor-item"/);
    assert.match(lobby, /aria-describedby=\{detailsId\}/);
    assert.match(lobby, /aria-label=\{status\}/);
    assert.doesNotMatch(lobby, /disabled=\{locked\}/);
    assert.match(lobbyCss, /\.tower-story-floor-card\s*\{[\s\S]{0,260}?min-height:\s*68px/);
    assert.match(lobbyCss, /@media \(max-width: 430px\)[\s\S]{0,160}?\.tower-story-chapter-head\s*\{\s*flex-direction:\s*column/);
    assert.match(lobbyCss, /\.tower-floor-intel\s*\{[\s\S]{0,120}?grid-template-columns:\s*repeat\(2/);
});

test("Story lobby distinguishes hard hold duration from score pace and starting enemy count", () => {
    assert.match(lobby, /objective === "protect-npc"\) return `Hold \$\{roundBudget\} rounds`/);
    assert.match(lobby, /objective === "survive"\) return `Survive \$\{roundBudget\} rounds`/);
    assert.match(lobby, /return `Par \/ score pace · \$\{roundBudget\} rounds`/);
    assert.match(lobby, /\{selFloor\.enemyCount\} starting combatant/);
    assert.doesNotMatch(lobby, /\$\{selFloor\.roundBudget\} round budget/);
});

test("Team Arena ready checks expire safely and transfer focus between timed states", () => {
    assert.match(pvpPanel, /onExpire:\s*\(deadline: number\) => void/);
    assert.match(pvpPanel, /onExpire\(deadline\)/);
    assert.match(pvpPanel, /readyCheckExpired[\s\S]{0,180}?refreshing match status/);
    assert.match(pvpPanel, /aria-pressed=\{Boolean\(me\?\.ready\)\}[\s\S]{0,100}?readyCheckExpired/);
    assert.match(pvpPanel, /panelRef\.current\?\.contains\(document\.activeElement\)/);
    assert.match(pvpPanel, /requestAnimationFrame\(\(\) => target\.focus/);
    assert.match(pvpPanel, /role="group" aria-label=\{myTeam === teamId \? "Your Team" : "Rival Team"\}/);
});

test("Team PvP presentation keeps live-player art and hides disabled consumable actions", () => {
    assert.match(fight, /isTeamPvp && typeof sealed === "string" && sealed/);
    assert.match(fight, /isTeamPvp && typeof a\.character\?\.avatarImage === "string"/);
    assert.match(fight, /const actionWeapons = isTeamPvp \? myWeapons\.filter\(\(\{ thrown \}\) => !thrown\) : myWeapons/);
    assert.match(fight, /const actionConsumables = isTeamPvp \? \[\] : myConsumables/);
    assert.match(fight, /Team Arena disables consumables and thrown ammunition/);
    assert.match(fight, /aria-label=\{isTeamPvp \? "Your Team" : "Squad"\}/);
    assert.match(fight, /aria-label=\{isTeamPvp \? "Rival Team and battle log" : "Enemies and battle log"\}/);
});

test("mobile Tower combat wraps critical controls and permits page scroll at fit zoom", () => {
    assert.match(fight, /className="tower-fight-header tower-fight-statusbar"[\s\S]{0,120}?flexWrap:\s*"wrap"/,
        "the header must retain both its compact-layout hook and semantic status-bar hook");
    assert.match(fight, /className="tower-fight-turn-pill"[\s\S]{0,160}?maxWidth:\s*"100%"/);
    assert.equal(fight.match(/className="tower-mechanic-chip"/g)?.length, 2);
    assert.match(tacticalCss, /\.tower-mechanic-chip\s*\{[\s\S]{0,140}?overflow-wrap:\s*anywhere[\s\S]{0,80}?white-space:\s*normal/);
    assert.match(tacticalCss, /\.tower-board-area\s*\{[\s\S]{0,100}?touch-action:\s*pan-y/);
    assert.match(tacticalCss, /\.tower-board-area\.is-pannable\s*\{[^}]*touch-action:\s*none/);
    assert.match(tacticalCss, /\.tower-fight-statusbar > button\s*\{\s*min-height:\s*44px/);
    assert.match(tacticalCss, /\.tower-board-controls button\s*\{[\s\S]{0,100}?min-width:\s*44px;[\s\S]{0,80}?min-height:\s*44px/);
    assert.match(tacticalCss, /\.tower-board-controls input\[type="range"\]\s*\{[\s\S]{0,80}?min-height:\s*44px/);
    assert.match(tacticalCss, /\.tower-settlement-status button\s*\{[\s\S]{0,100}?min-height:\s*44px/);
    assert.match(tacticalCss, /@media \(max-width: 1023px\)[\s\S]*?\.screen-battleTowerFight \.tower-action-dock \.basic-action-bar button\s*\{\s*min-height:\s*44px !important/);
});

test("Team Arena announces only the newest battle-log line", () => {
    assert.match(fight, /aria-live=\{isTeamPvp \? "off" : "polite"\}/);
    assert.match(fight, /className="tower-sr-only" role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(fight, /session\.log\[session\.log\.length - 1\]/);
    assert.match(tacticalCss, /\.tower-sr-only\s*\{[\s\S]{0,200}?clip:\s*rect/);
});
