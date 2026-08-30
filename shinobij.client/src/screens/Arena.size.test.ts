import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const arenaSource = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const battleLobbySource = readFileSync(new URL("../features/arena/components/BattleArenaLobby.tsx", import.meta.url), "utf8");
const districtLobbySource = readFileSync(new URL("../features/arena/components/ArenaDistrictLobby.tsx", import.meta.url), "utf8");
const tournamentPanelSource = readFileSync(new URL("../features/arena/components/ArenaTournamentPanel.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../features/arena/types.ts", import.meta.url), "utf8");

const leaves = [
    ["BattleArenaLobby.tsx", battleLobbySource, 180],
    ["ArenaDistrictLobby.tsx", districtLobbySource, 240],
    ["ArenaTournamentPanel.tsx", tournamentPanelSource, 80],
    ["types.ts", typesSource, 10],
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

test("Arena.tsx and its two lobby leaves keep the retirement line-budget ratchet", () => {
    const maxArenaLines = 650;
    assert.ok(
        lineCount(arenaSource) <= maxArenaLines,
        `Arena.tsx grew past ${maxArenaLines} lines; battle execution belongs in its authoritative screen, not the lobby.`,
    );

    for (const [name, source, maxLines] of leaves) {
        assert.ok(
            lineCount(source) <= maxLines,
            `${name} grew past its ${maxLines}-line lobby budget; split a cohesive child instead of recreating a monolith.`,
        );
    }
});

test("Arena lobby leaves stay hook-free and authority-free", () => {
    for (const [name, source] of leaves.filter(([name]) => name.endsWith(".tsx"))) {
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
        // b907ef933 moved this to a functional updater so the accept path cannot
        // drop a challenge that arrived after render. Same ordering contract.
        "setDuelChallenges((current) => current.filter",
        "method: \"DELETE\"",
        "method: \"POST\"",
        "setPendingPetBattleOpponent?.(",
        "setScreen(\"petArena\")",
    ], "clan-pet acceptance order");

    const spectate = sliceBetween(arenaSource, "const spectateFight", "<ArenaDistrictLobby");
    assertOrdered(spectate, [
        "fetch(`/api/pvp/spectate",
        "setPvpBattleId(fight.battleId)",
        "setPvpRole(\"p1\")",
        "setScreen(\"pvpBattle\")",
    ], "spectate join order");

    const ladderStart = arenaSource.indexOf("onOpenPetLadder={(mode) => {");
    assert.ok(ladderStart >= 0, "Arena must wire pet-ladder navigation");
    assertOrdered(arenaSource.slice(ladderStart, ladderStart + 240), [
        "sessionStorage.setItem(\"petLadder.mode\", mode)",
        "setScreen(\"petLadder\")",
    ], "pet-ladder navigation order");
});

test("retired Arena combat leaves have no remaining source owner", () => {
    for (const relative of [
        "../components/ArenaBattlePersister.tsx",
        "../features/arena/components/ArenaCombatBoardStage.tsx",
        "../features/arena/components/ArenaCommandDeck.tsx",
        "../features/arena/components/ArenaBattleTimeline.tsx",
        "../features/arena/domain/arena-ai-policy.ts",
    ]) {
        assert.equal(existsSync(new URL(relative, import.meta.url)), false, `${relative} must stay retired`);
    }
});
