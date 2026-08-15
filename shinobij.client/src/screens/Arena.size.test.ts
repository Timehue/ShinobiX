import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const battleLobbySource = readFileSync(new URL("../features/arena/components/BattleArenaLobby.tsx", import.meta.url), "utf8");
const districtLobbySource = readFileSync(new URL("../features/arena/components/ArenaDistrictLobby.tsx", import.meta.url), "utf8");
const boardSource = readFileSync(new URL("../features/arena/components/ArenaCombatBoardStage.tsx", import.meta.url), "utf8");
const commandSource = readFileSync(new URL("../features/arena/components/ArenaCommandDeck.tsx", import.meta.url), "utf8");
const timelineSource = readFileSync(new URL("../features/arena/components/ArenaBattleTimeline.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../features/arena/types.ts", import.meta.url), "utf8");
const aiPolicySource = readFileSync(new URL("../features/arena/domain/arena-ai-policy.ts", import.meta.url), "utf8");

const leaves = [
    ["BattleArenaLobby.tsx", battleLobbySource, 180],
    ["ArenaDistrictLobby.tsx", districtLobbySource, 240],
    ["ArenaCombatBoardStage.tsx", boardSource, 225],
    ["ArenaCommandDeck.tsx", commandSource, 400],
    ["ArenaBattleTimeline.tsx", timelineSource, 100],
    ["types.ts", typesSource, 60],
] as const;

function lineCount(source: string): number {
    return source.trimEnd().split(/\r?\n/u).length;
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `Missing source-contract start: ${startNeedle}`);
    assert.ok(end > start, `Missing source-contract end after ${startNeedle}: ${endNeedle}`);
    return source.slice(start, end);
}

function assertOrdered(source: string, needles: readonly string[], contract: string): void {
    let cursor = 0;
    for (const needle of needles) {
        const found = source.indexOf(needle, cursor);
        assert.ok(found >= cursor, `${contract}: expected ${needle} after offset ${cursor}`);
        cursor = found + needle.length;
    }
}

test("Arena.tsx keeps the render-leaf and AI-policy line-budget ratchet", () => {
    const maxArenaLines = 5_595;
    assert.ok(
        lineCount(arenaSource) <= maxArenaLines,
        `Arena.tsx grew past ${maxArenaLines} lines; new render regions belong under features/arena.`,
    );

    for (const [name, source, maxLines] of leaves) {
        assert.ok(
            lineCount(source) <= maxLines,
            `${name} grew past its ${maxLines}-line leaf budget; split a cohesive child instead of creating a new monolith.`,
        );
    }

    assert.ok(
        lineCount(aiPolicySource) <= 300,
        "arena-ai-policy.ts grew past its 300-line domain budget; split execution from selection instead of creating a new engine monolith.",
    );
});

test("Arena delegates pure AI selection without moving live combat execution", () => {
    assert.match(arenaSource, /matchesArenaAiRule\(rule, \{/u);
    assert.match(arenaSource, /pickArenaAiJutsu\(\{/u);
    assert.match(arenaSource, /function estimateAiJutsuDamage\(/u);
    assert.match(arenaSource, /function enemyUseAiJutsu\(/u);
    assert.doesNotMatch(arenaSource, /function (?:activePlayerDotThisTurn|smartExpandedJutsuPool|smartAiJutsuPick)\(/u);
    assert.doesNotMatch(arenaSource, /const applyEasyBurstHold\s*=/u);
});

test("Arena render leaves stay hook-free and authority-free", () => {
    for (const [name, source] of leaves.slice(0, 5)) {
        assert.doesNotMatch(source, /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Memo|Callback|ImperativeHandle)\s*\(/u, `${name} must remain hook-free`);
        assert.doesNotMatch(source, /\bfetch\s*\(/u, `${name} must not own networking`);
        assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b/u, `${name} must not own browser persistence`);
        assert.doesNotMatch(source, /\bDate\.now\s*\(/u, `${name} must receive time-derived values from Arena`);
    }
});

test("Arena keeps controller ordering for pet acceptance, spectating, and ladder navigation", () => {
    const petAcceptance = sliceBetween(arenaSource, "const acceptDistrictChallenge", "const spectateFight");
    assertOrdered(petAcceptance, [
        "if (!challengerPet || !responderPet)",
        "savePendingClanPetBattle({",
        "setDuelChallenges(duelChallenges.filter",
        "method: 'DELETE'",
        "method: 'POST'",
        "setPendingPetBattleOpponent?.(",
        'setScreen("petArena")',
    ], "clan-pet acceptance order");

    const spectate = sliceBetween(arenaSource, "const spectateFight", "<ArenaDistrictLobby");
    assertOrdered(spectate, [
        "fetch(`/api/pvp/spectate",
        "setPvpBattleId(fight.battleId)",
        'setPvpRole("p1")',
        'setScreen("pvpBattle" as Screen)',
    ], "spectate join order");

    const ladderStart = arenaSource.indexOf("onOpenPetLadder={(mode) => {");
    assert.ok(ladderStart >= 0, "Arena must wire pet-ladder navigation");
    assertOrdered(arenaSource.slice(ladderStart, ladderStart + 240), [
        'sessionStorage.setItem("petLadder.mode", mode)',
        'setScreen("petLadder")',
    ], "pet-ladder navigation order");

    assert.match(arenaSource, /arenaTournament\.endsAt - Date\.now\(\)/u);
    assert.match(arenaSource, /arenaTournament\.matchDeadline - Date\.now\(\)/u);
});

test("the extracted combat leaves preserve shell ordering and wrapper-neutral roots", () => {
    const combatShell = sliceBetween(arenaSource, "<ShinobiCombatShell", "</ShinobiCombatShell>");
    assertOrdered(combatShell, [
        "<CombatHudLayout hasActionNotice={showRookieCombatTip}>",
        "<CombatSideHud",
        "<CombatHudMain",
        "<ArenaCombatBoardStage",
        "<ArenaCommandDeck",
        "<ArenaBattleTimeline",
        "</CombatHudMain>",
        "<CombatSideHud",
        "</CombatHudLayout>",
    ], "combat shell direct-child order");

    assert.match(boardSource, /return \(\s*<CombatBoardStage>/u);
    assertOrdered(boardSource, ["<CombatBoardStage>", "hex-battlefield", "hex-grid-layer", "pvp-hit-fx", "arena-combat-vfx-layer", "</CombatBoardStage>"], "board DOM order");
    assert.match(commandSource, /return \(\s*<>\s*<BattleTabBar/u);
    assertOrdered(commandSource, ["<BattleTabBar", "rookie-combat-tip", "<CombatCommandBar>", "jutsu-layout-card combat-jutsu-bar", "solo-combat-detail-trigger-jutsu-", "solo-combat-detail-trigger-item-"], "command DOM order");
    assert.match(timelineSource, /return \(\s*<>\s*<CombatBattleLogPanel/u);
    assertOrdered(timelineSource, ["<CombatBattleLogPanel", "timeline-round-header timeline-round-toggle", "</CombatBattleLogPanel>", "combat-turn-banner"], "timeline DOM order");
});
