import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { declineWildPetEncounter, startWildPetEncounter } from "./wild-pet-encounter-api";

/*
 * Regression guard: world-map wild pets must be settled by the server.
 *
 * The explore tile used to roll the encounter locally and append the pet to
 * `character.pets`, relying on the generic save to persist it. It never did —
 * `sanitizeCharacterSave` (api/save/[name].ts) drops any pet id the stored
 * roster doesn't already have, so a befriended pet survived only until the next
 * reload. These assertions pin the fixed shape: the roll comes from
 * /api/pet/encounter-start, the commit from /api/pet/befriend, and the roster
 * the server returns is adopted instead of merged locally.
 */

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("world-map wild-pet encounters", () => {
    test("only an explicit server miss continues normal exploration", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const bodies: Record<string, unknown>[] = [];
        const replies = [
            new Response(JSON.stringify({ ok: true, requestId: "oldermiss123", pet: null, sector: 41, replayed: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ ok: true, requestId: "olderhit123", token: "petproof123", pet: { id: "pet-wolf", name: "Wolf" }, sector: 33, replayed: true, worldExploreRequestId: "exploreproof123" }), { status: 200, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }),
        ];
        globalThis.fetch = (async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
            return replies.shift()!;
        }) as typeof fetch;
        try {
            assert.deepEqual(await startWildPetEncounter("Rill", 61, "newmiss123"), {
                kind: "miss", requestId: "oldermiss123", sector: 41, replayed: true,
            }, "a new device must adopt the server's pending miss id and sector");
            const replay = await startWildPetEncounter("Rill", 61, "newhit123");
            assert.equal(replay.kind, "hit");
            if (replay.kind === "hit") {
                assert.equal(replay.requestId, "olderhit123", "cross-device hits adopt the server's durable request id");
                assert.equal(replay.sector, 33, "recovery must use the token's sealed sector, not the newly clicked one");
                assert.equal(replay.worldExploreRequestId, "exploreproof123");
            }
            assert.equal((await startWildPetEncounter("Rill", 41, "retryable123")).kind, "blocked");
            assert.deepEqual(bodies.map((body) => body.requestId), ["newmiss123", "newhit123", "retryable123"]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("resolved pet receipts cannot be mistaken for a new miss", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            ok: true,
            requestId: "settledpet123",
            pet: null,
            sector: 27,
            replayed: true,
            resolved: true,
            resolution: "declined",
        }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
        try {
            assert.deepEqual(await startWildPetEncounter("Rill", 55, "newpetrequest123"), {
                kind: "resolved", requestId: "settledpet123", sector: 27, replayed: true, resolution: "declined",
            });
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("an expired durable pet choice retires instead of restaging a dead token", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({
            ok: true,
            requestId: "expiredpet123",
            pet: null,
            sector: 27,
            replayed: true,
            resolved: true,
            resolution: "expired",
        }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
        try {
            assert.deepEqual(await startWildPetEncounter("Rill", 55, "cachedpet123"), {
                kind: "resolved", requestId: "expiredpet123", sector: 27, replayed: true, resolution: "expired",
            });
        } finally {
            globalThis.fetch = realFetch;
        }

        const worldMap = source("../screens/WorldMap.tsx");
        const recover = worldMap.slice(
            worldMap.indexOf("async function recoverResolvedPetOperation"),
            worldMap.indexOf("async function recoverPendingExternalDiscovery"),
        );
        assert.match(recover, /encounter\.resolution !== "explored-miss"[\s\S]{0,180}completeWorldRewardOperation\(character\.name, encounter\.requestId\)/,
            "terminal expired/befriended/declined receipts must clear the cached card without ordinary explore");
    });

    test("Leave is an idempotent server choice and remains retryable until ACK", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const replies = [
            new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ ok: true, token: "petproof123", replayed: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
        ];
        globalThis.fetch = (async () => replies.shift()!) as typeof fetch;
        try {
            assert.equal((await declineWildPetEncounter("Rill", "petproof123")).retryable, true);
            assert.deepEqual(await declineWildPetEncounter("Rill", "petproof123"), {
                ok: true, token: "petproof123", replayed: true, retryable: false,
            });
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("the explore tile rolls the encounter server-side", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.ok(
            worldMap.includes("startWildPetEncounter(character.name, operation.sector, operation.id)"),
            "exploring must replay a parked stable id through the server-owned pet roll",
        );
        assert.match(worldMap, /externalOutcomeProof: \{ kind: "pet", token: petEncounter\.token \}/,
            "the tile must bind to the exact server-sealed pet discovery");
        assert.ok(
            !worldMap.includes("rollPetEncounter("),
            "the client must not roll its own wild pet — the server-minted token seals the pet",
        );
    });

    test("befriending commits through the server and adopts its character", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const call = worldMap.indexOf("befriendWildPet(character.name, token)");
        assert.notEqual(call, -1, "befriending must spend the encounter token server-side");

        const adopt = worldMap.indexOf("onVersionedCharacter(result.character, result.saveVersion)", call);
        assert.ok(adopt > call, "the server's character and save version must be adopted atomically after the call");
        assert.equal(worldMap.indexOf("updateCharacter(result.character)", call), -1, "befriending must not split character adoption from its save version");

        assert.ok(
            !/pets:\s*\[\s*\.\.\.character\.pets/.test(worldMap),
            "the world map must not append a pet to the roster locally — the save sanitizer strips it",
        );
        assert.ok(
            !worldMap.includes("rollPetTrait("),
            "the trait is rolled by the server alongside the roster write",
        );
        assert.match(worldMap, /outcome\.source === "pet"[\s\S]{0,360}recoverPendingExternalDiscovery\(operation, "pet"\)/,
            "reload must revalidate a cached external-pet token from the stable request receipt before showing choices");
        assert.match(worldMap, /result\.error === "invalid-or-spent-encounter"[\s\S]{0,300}recoverPendingWorldRewards\(true\)/,
            "a terminal stale token must reconcile its durable receipt instead of trapping the modal");
        const decline = worldMap.indexOf("declineWildPetEncounter(character.name, token)");
        assert.notEqual(decline, -1, "Leave must resolve the durable server pointer");
        assert.ok(worldMap.indexOf("completeWorldRewardOperation(character.name, operationId)", decline) > decline,
            "the recovery operation may clear only after the decline ACK");
    });

    test("both endpoints the client depends on exist and are routed", () => {
        const routes = source("../../../server.ts");
        for (const path of ["/pet/encounter-start", "/pet/befriend", "/pet/encounter-decline"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
