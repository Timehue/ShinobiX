import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { onAiFightRequest, requestAiFight, type AiFightRequest } from "./ai-fight-request";

function makeRequest(overrides: Partial<AiFightRequest> = {}): AiFightRequest {
    return { opponentId: "ai-bandit", opponentLevel: 12, battleKind: "raidAi", ...overrides };
}

test("with no host mounted, a request fails closed instead of running local combat", () => {
    assert.equal(requestAiFight(makeRequest()), false);
});

test("with a host mounted, the request is delivered", () => {
    const seen: AiFightRequest[] = [];
    const unsubscribe = onAiFightRequest((request) => seen.push(request));
    try {
        assert.equal(requestAiFight(makeRequest({ opponentId: "ai-hunt-beast", sector: 41 })), true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].opponentId, "ai-hunt-beast");
        assert.equal(seen[0].sector, 41);
    } finally {
        unsubscribe();
    }
});

test("unsubscribing restores the fail-closed no-host state", () => {
    const unsubscribe = onAiFightRequest(() => { throw new Error("must not be called after unsubscribe"); });
    unsubscribe();
    assert.equal(requestAiFight(makeRequest()), false);
});

const host = readFileSync(new URL("../components/AiFightHost.tsx", import.meta.url), "utf8");

test("AiFightHost renders the code-split normal Arena shell", () => {
    assert.match(host, /<MissionArenaFight/);
    assert.match(host, /import\(["']\.\.\/screens\/MissionArenaFight["']\)/);
    assert.doesNotMatch(host, /<BattleTowerFight|screens\/BattleTowerFight/);
});

test("AiFightHost requires standalone solo-PvE and has no local or Tower authority", () => {
    assert.match(host, /soloPveArenaTransport/);
    assert.match(host, /sessionId: started\.sessionId, session: started\.session/);
    assert.doesNotMatch(host, /request\.playLocally|towers-api|TowerSession/);
});

test("routed launch sites contain no rewarding local fallback", () => {
    const sources = ["../screens/WorldMap.tsx", "../screens/Missions.tsx", "../screens/Logbook.tsx", "../screens/HunterBoard.tsx"];
    for (const relative of sources) {
        const source = readFileSync(new URL(relative, import.meta.url), "utf8");
        assert.doesNotMatch(source, /requestAiFight\(\{[\s\S]{0,700}playLocally:/, relative);
    }
});

test("a defeat and an abandoned fight both reach the server", () => {
    assert.match(host, /settleOnAnyDone/);
    assert.match(host, /shouldSettleOnClose\(/);
});

test("the Apex fight registers as a hunt", () => {
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    const faceApex = board.slice(board.indexOf("function faceApex"), board.indexOf("function faceApex") + 1400);
    assert.match(faceApex, /battleKind: "raidAi"/);
});

test("tracked hunt quality still blocks routing until the server owns its opening modifier", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const launch = worldMap.slice(worldMap.indexOf("function launchHuntBeastFight"), worldMap.indexOf("function launchHuntBeastFight") + 2200);
    assert.match(launch, /applyHuntOpening\(/);
    assert.doesNotMatch(launch, /requestAiFight\(/);
});
