import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const arena = readFileSync(new URL("./Arena.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const worldMap = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");
const aiHost = readFileSync(new URL("../components/AiFightHost.tsx", import.meta.url), "utf8");
const battleSave = readFileSync(new URL("../lib/battle-save.ts", import.meta.url), "utf8");

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.ok(start >= 0, `missing source-contract start: ${startNeedle}`);
    assert.ok(end > start, `missing source-contract end: ${endNeedle}`);
    return source.slice(start, end);
}

function assertOrdered(source: string, needles: readonly string[], label: string): void {
    let cursor = 0;
    for (const needle of needles) {
        const next = source.indexOf(needle, cursor);
        assert.ok(next >= cursor, `${label}: ${needle} must follow offset ${cursor}`);
        cursor = next + needle.length;
    }
}

test("Arena is reverse-unreachable from every local combat authority", () => {
    assert.doesNotMatch(
        arena,
        /\b(?:startPrefight|setBattleStarted|winBattle|enemyTurn|castJutsu|ArenaBattlePersister|BattleLockKeeper|ShinobiCombatShell|CombatHudLayout|CombatBoardStage|playerHp|enemyHp|activeActor)\b/,
    );
    assert.doesNotMatch(arena, /\/api\/missions\/ai-fight-start|\/api\/pvp\/move|\/api\/pvp\/settle/);
    assert.doesNotMatch(arena, /localStorage\.(?:getItem|setItem)\(/,
        "a lobby must not restore or write combat authority");
});

test("practice admission reaches AiFightHost and MissionArenaFight only through requestAiFight", () => {
    const launch = sliceBetween(arena, "function beginAiBattle", "async function challengePlayer");
    assert.match(launch, /requestAiFight\(\{/);
    assert.match(launch, /opponentId: publishedPracticeOpponentForLevel\(aiLevel\)/);
    assert.match(launch, /battleKind: "practice"/);
    assert.match(launch, /returnScreen: "arena"/);
    assert.doesNotMatch(launch, /fetch\(|setScreen\(|setBattleStarted/);

    assert.match(aiHost, /onAiFightRequest\(/);
    assert.match(aiHost, /<MissionArenaFight/);
    assert.match(aiHost, /runId=\{currentFight\.sessionId\}/);
    assert.match(aiHost, /initialSession=\{soloPveSessionForArena\(currentFight\.session\)\}/);
});

test("PvP acceptance delegates to App and routes with the server battle id", () => {
    const districtAccept = sliceBetween(arena, "const acceptDistrictChallenge", "const spectateFight");
    assert.match(districtAccept, /challenge\.mode !== "clanWarPet"[\s\S]{0,100}onAcceptChallenge\(challenge\)/);
    assert.match(app, /onAcceptChallenge=\{\(challenge\) => \{ void acceptChallengeGlobal\(challenge\); \}\}/);

    const canonicalAccept = sliceBetween(app, "async function acceptChallengeGlobal", "useEffect(() => {");
    // The raw POST and its json() parse moved into lib/pvp-session-create.ts,
    // which owns the ambiguous-commit retry. App still gates, then takes the
    // battle id from that helper's result and routes with it.
    assertOrdered(canonicalAccept, [
        "requireServerSettlement(\"pvpSession\")",
        "createPvpSessionWithRecovery(fetch, acceptingCharacter.name, createBody",
        "const battleId = createResult.battleId",
        "setPvpBattleId(battleId)",
        "setPvpRole(\"p2\")",
        "setScreen(\"pvpBattle\")",
    ], "canonical challenge acceptance");
    assert.doesNotMatch(canonicalAccept, /makeId\(\)[\s\S]{0,120}setPvpBattleId/,
        "a client-generated id must never route a PvP session");

    const spectate = sliceBetween(arena, "const spectateFight", "return (");
    assertOrdered(spectate, [
        "fight.battleId",
        "fetch(`/api/pvp/spectate",
        "setPvpBattleId(fight.battleId)",
        "setPvpRole(\"p1\")",
        "setScreen(\"pvpBattle\")",
    ], "spectator routing");
});

test("the retired pending PvP opponent compatibility sink stays absent", () => {
    for (const [owner, source] of [["Arena", arena], ["WorldMap", worldMap], ["App", app]] as const) {
        assert.doesNotMatch(source, /\b(?:pendingPvpOpponent|setPendingPvpOpponent)\b/,
            `${owner} must not revive the retired local-combat compatibility sink`);
    }
});

test("retired Arena snapshots are rejected and have no writer", () => {
    assert.equal(existsSync(new URL("../components/ArenaBattlePersister.tsx", import.meta.url)), false);
    assert.match(battleSave, /if \(lock\.kind === "arena"\) return false/);
    assert.match(battleSave, /if \(lock\.kind === "arenaStory"\) return false/);
    assert.match(app, /bootLock\.kind === "arena"[\s\S]{0,700}localStorage\.removeItem\(`arena\.battle\.v3\.\$\{normalized\.name\}`\)/);
    assert.doesNotMatch(app, /localStorage\.setItem\(`arena\.battle\.v3/);
    assert.doesNotMatch(arena, /arena\.battle\.v3|arenaStory\.context/);
});
