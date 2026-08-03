import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { onAiFightRequest, requestAiFight, type AiFightRequest } from "./ai-fight-request";

function makeRequest(overrides: Partial<AiFightRequest> = {}): { request: AiFightRequest; localRuns: () => number } {
    let localRuns = 0;
    const request: AiFightRequest = {
        opponentId: "ai-bandit",
        opponentLevel: 12,
        battleKind: "raidAi",
        playLocally: () => { localRuns += 1; },
        ...overrides,
    };
    return { request, localRuns: () => localRuns };
}

test("with no host mounted, a request falls back to the local fight instead of dropping it", () => {
    const { request, localRuns } = makeRequest();
    assert.equal(requestAiFight(request), false, "no host → the bus reports it did not route");
    assert.equal(localRuns(), 1, "the caller's local Arena launch must still run");
});

test("with a host mounted, the request is delivered and the local path is NOT run", () => {
    const seen: AiFightRequest[] = [];
    const unsubscribe = onAiFightRequest((r) => seen.push(r));
    try {
        const { request, localRuns } = makeRequest({ opponentId: "ai-hunt-beast", sector: 41 });
        assert.equal(requestAiFight(request), true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].opponentId, "ai-hunt-beast");
        assert.equal(seen[0].sector, 41, "the sector must ride along — the raid side effects key off it");
        assert.equal(localRuns(), 0, "the host decides the screen; the local path must not also run");
    } finally {
        unsubscribe();
    }
});

test("unsubscribing restores the no-host fallback (an unmounted host never strands a fight)", () => {
    const unsubscribe = onAiFightRequest(() => { throw new Error("must not be called after unsubscribe"); });
    unsubscribe();
    const { request, localRuns } = makeRequest();
    assert.equal(requestAiFight(request), false);
    assert.equal(localRuns(), 1);
});

// ── Source guards ────────────────────────────────────────────────────────────
const host = readFileSync(new URL("../components/AiFightHost.tsx", import.meta.url), "utf8");

test("AiFightHost renders the server arena shell, code-split, and not the tower rail", () => {
    assert.match(host, /<MissionArenaFight/, "the host must render MissionArenaFight");
    assert.match(host, /import\(["']\.\.\/screens\/MissionArenaFight["']\)/, "the host must code-split MissionArenaFight");
    assert.doesNotMatch(host, /<BattleTowerFight|screens\/BattleTowerFight/, "the host must not use the Battle Tower shell");
});

test("AiFightHost falls back to the local fight when no encounter was sealed", () => {
    // The designed degrade for an unsealable opponent or a failed seal. Losing
    // this branch would silently swallow every fight the server cannot build.
    assert.match(host, /request\.playLocally\(\)/, "a runId-less start must run the caller's local path");
    assert.match(host, /started\.runId && started\.session/, "both runId AND session are required to mount the shell");
});

test("every routed launch site supplies a local fallback", () => {
    const sources = ["../screens/WorldMap.tsx", "../screens/Missions.tsx", "../screens/Logbook.tsx", "../screens/HunterBoard.tsx"];
    for (const relative of sources) {
        const text = readFileSync(new URL(relative, import.meta.url), "utf8");
        const calls = text.split("requestAiFight({").length - 1;
        if (calls === 0) continue;
        const fallbacks = text.split("playLocally:").length - 1;
        assert.equal(fallbacks, calls, `${relative}: every requestAiFight call must carry a playLocally fallback`);
    }
});

test("a defeat and an abandoned fight both reach the server", () => {
    // Two separate holes, one consequence: if either is lost, a server AI fight
    // becomes free to lose and free to retry, and the whole risk side of hunts
    // and raids disappears. The forfeit RULE is behaviour-tested in
    // ai-fight-settle.test.ts (shouldSettleOnClose); this only pins that the host
    // still asks it.
    assert.match(host, /settleOnAnyDone/, "losses must settle, not just wins");
    assert.match(host, /shouldSettleOnClose\(/, "closing an unsettled fight must consult the forfeit rule");
});

test("the Apex fight registers as a hunt, or its kill receipt is never written", () => {
    // report-ai-fight is the ONLY writer of the apex kill receipt, and it is only
    // reached for a non-practice fight. Without raidAi the purse is unclaimable.
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    const faceApex = board.slice(board.indexOf("function faceApex"), board.indexOf("function faceApex") + 1400);
    assert.match(faceApex, /battleKind: "raidAi"/, "the sealed Apex fight must be a hunt");
    assert.match(faceApex, /setRaidBattleKind\("raidAi"\)/, "the local Apex fallback must be a hunt too");
});

test("the tracked hunt beast is NOT routed — Hunt Quality is applied client-side", () => {
    // applyHuntOpening (cornered/enraged) is what makes tracking well matter, and
    // the server builds the encounter from the catalog profile. Routing this
    // fight would silently delete Hunt Quality from the Hunter Guild loop.
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const launch = worldMap.slice(worldMap.indexOf("function launchHuntBeastFight"), worldMap.indexOf("function launchHuntBeastFight") + 2200);
    assert.match(launch, /applyHuntOpening\(/, "the hunt opening must still be applied");
    assert.doesNotMatch(launch, /requestAiFight\(/, "do not route the tracked hunt until the SERVER owns hunt quality");
});
