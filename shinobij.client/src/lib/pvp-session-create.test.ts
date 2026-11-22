import assert from "node:assert/strict";
import { test } from "node:test";
import { PVP_OPPONENT_UNAVAILABLE } from "../../../shared/pvp-cancellation";
import { readFileSync } from "node:fs";
import { createPvpSessionWithRecovery, slimPvpSessionRequestBody } from "./pvp-session-create";

const BODY = JSON.stringify({ battleId: "stable-battle" });

function server(createResponse: () => Response) {
    const creates: number[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") { creates.push(1); return createResponse(); }
        assert.match(String(input), /pending=1/);
        return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { creates, fetchFn };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("a refusal about where the opponent stands is asked once and reported", async () => {
    const { creates, fetchFn } = server(() => json(409, {
        error: "World attacks are disabled in safe zones.", errorCode: PVP_OPPONENT_UNAVAILABLE,
    }));
    const result = await createPvpSessionWithRecovery(fetchFn, "Caius", BODY, { wait: async () => undefined });
    assert.equal(creates.length, 1);
    assert.deepEqual(result, { kind: "rejected", error: "World attacks are disabled in safe zones." });
});

// A developed character as the client holds it: stats, gear and loadout, plus
// the history, ledgers and world model that never reach the fight.
const fighter = (name: string) => ({
    name, stats: { speed: 20 }, maxHp: 900, maxChakra: 400, maxStamina: 400,
    jutsuMastery: [{ jutsuId: "j1", level: 10 }], jutsu: [{ id: "j1" }], pvpItems: [{ id: "w1" }],
    bloodlineMult: 1.2, armorFactor: 0.8, itemShield: 0,
    battleHistory: Array.from({ length: 2_000 }, (_, i) => ({ id: `battle-${i}`, log: "x".repeat(60) })),
    redeemedSectorExplorations: ["s1"], serverSettlementReceipts: [{}], inventory: [{ id: "i" }],
    playerModel: { assetId: "a".repeat(32), version: "b".repeat(64) }, starterWorldModel: "starter-one",
});

test("a sector attack or player challenge names its fighters and lets the server build them from their saves", () => {
    for (const marker of [{ requireWorldCoLocation: true }, { challengeId: "c1" }]) {
        const full = JSON.stringify({ battleId: "stable-battle", ...marker, useCurrentVitals: true, p1Character: fighter("Caius"), p2Character: fighter("Rin") });
        const slim = slimPvpSessionRequestBody(full);
        assert.deepEqual(JSON.parse(slim), { battleId: "stable-battle", ...marker, useCurrentVitals: true, p1Character: { name: "Caius" }, p2Character: { name: "Rin" } });
        assert.ok(full.length > 256 * 1024 && slim.length < 512, `${full.length} → ${slim.length} bytes`);
    }
});

test("any other create is sent unchanged", () => {
    for (const marker of [{}, { challengeId: "  " }, { requireWorldCoLocation: "yes" }]) {
        const full = JSON.stringify({ battleId: "stable-battle", ...marker, p1Character: fighter("Caius"), p2Character: fighter("Bandit") });
        assert.equal(slimPvpSessionRequestBody(full), full);
    }
    // Ranked and clan-war creates already name their fighters.
    const ranked = JSON.stringify({ battleId: "b", ranked: true, rankedKind: "player", p1Character: { name: "Caius" }, p2Character: { name: "Rin" } });
    assert.equal(slimPvpSessionRequestBody(ranked), ranked);
    // Malformed bodies reach the server as they are, for its own 400.
    for (const odd of ["not json", "null", JSON.stringify({ requireWorldCoLocation: true })]) assert.equal(slimPvpSessionRequestBody(odd), odd);
});

test("every retry posts the same slimmed body", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") { bodies.push(String(init.body)); return json(409, { error: "busy" }); }
        return new Response(null, { status: 204 });
    }) as typeof fetch;
    const full = JSON.stringify({ battleId: "stable-battle", requireWorldCoLocation: true, p1Character: fighter("Caius"), p2Character: fighter("Rin") });
    await createPvpSessionWithRecovery(fetchFn, "Caius", full, { wait: async () => undefined });
    assert.equal(bodies.length, 4);
    assert.ok(bodies.every((body) => body === bodies[0]));
    assert.deepEqual(JSON.parse(bodies[0]!).p1Character, { name: "Caius" });
});

test("the name-only condition stays the server's two-save condition", () => {
    // If the server stops refusing these creates without both saves, a missing
    // save would seal a body-supplied fighter, and a name-only body would be wrong.
    const server = readFileSync(new URL("../../../api/pvp/session.ts", import.meta.url), "utf8");
    const rule = /const requiresTwoPlayerSaves = !identity\.admin && \(([\s\S]*?)\);/.exec(server)?.[1] ?? "";
    assert.match(rule, /typeof challengeId === 'string' && challengeId\.trim\(\)\.length > 0/);
    assert.match(rule, /requireWorldCoLocation === true/);
    assert.match(server, /if \(requiresTwoPlayerSaves && \(!p1SaveRaw\?\.character \|\| !p2SaveRaw\?\.character\)\)/);
});

test("a bare 409 is still retried, because the create may have landed", async () => {
    const { creates, fetchFn } = server(() => json(409, { error: "Finish the pending PvP battle settlement." }));
    const result = await createPvpSessionWithRecovery(fetchFn, "Caius", BODY, { wait: async () => undefined });
    assert.equal(creates.length, 4);
    assert.equal(result.kind, "ambiguous");
});
