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
    const sources = ["../screens/WorldMap.tsx", "../screens/Missions.tsx", "../screens/Logbook.tsx"];
    for (const relative of sources) {
        const text = readFileSync(new URL(relative, import.meta.url), "utf8");
        const calls = text.split("requestAiFight({").length - 1;
        if (calls === 0) continue;
        const fallbacks = text.split("playLocally:").length - 1;
        assert.equal(fallbacks, calls, `${relative}: every requestAiFight call must carry a playLocally fallback`);
    }
});
