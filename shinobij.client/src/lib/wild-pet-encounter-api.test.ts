import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { befriendWildPet, declineWildPetEncounter, startWildPetEncounter, wildPetEncounterFailureMessage } from "./wild-pet-encounter-api";

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

function jsonReply(data: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function withEncounterReplies(
    replies: Array<Response | Error>,
    run: (bodies: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply ?? jsonReply({ error: "Unexpected extra encounter request." }, 503);
    }) as typeof fetch;
    try {
        await run(bodies);
    } finally {
        globalThis.fetch = realFetch;
    }
}
describe("world-map wild-pet encounters", () => {
    test("Caravan trails send the server's sealed expedition binding", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        let body: Record<string, unknown> = {};
        globalThis.fetch = (async (_url, init) => {
            body = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ ok: true, requestId: 'caravan_trail123', pet: null, sector: 54 }));
        }) as typeof fetch;
        try {
            assert.equal((await startWildPetEncounter('Rill', 54, 'caravan_trail123', 'expedition-id')).kind, 'miss');
            assert.equal(body.caravanRunId, 'expedition-id');
        } finally { globalThis.fetch = realFetch; }
    });
    test("only an explicit server miss continues normal exploration", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const bodies: Record<string, unknown>[] = [];
        const replies = [
            new Response(JSON.stringify({ ok: true, requestId: "oldermiss123", pet: null, sector: 41, replayed: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ ok: true, requestId: "olderhit123", token: "petproof123", pet: { id: "pet-wolf", name: "Wolf" }, sector: 33, replayed: true, worldExploreRequestId: "exploreproof123" }), { status: 200, headers: { "Content-Type": "application/json" } }),
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
            assert.deepEqual(bodies.map((body) => body.requestId), ["newmiss123", "newhit123"]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("simultaneous recovery and Explore share one request, then release it after completion", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            await waiting;
            return jsonReply({ ok: true, requestId: "concurrent123", pet: null, sector: 41, replayed: true });
        }) as typeof fetch;
        try {
            const recovery = startWildPetEncounter("Rill", 41, "concurrent123");
            const explore = startWildPetEncounter("Rill", 41, "concurrent123");
            assert.equal(calls, 1, "the same attempt must not send competing in-flight requests");
            release();
            const [recovered, explored] = await Promise.all([recovery, explore]);
            assert.deepEqual(recovered, { kind: "miss", requestId: "concurrent123", sector: 41, replayed: true });
            assert.deepEqual(explored, recovered);
            assert.equal(calls, 1);
            assert.deepEqual(await startWildPetEncounter("Rill", 41, "concurrent123"), recovered);
            assert.equal(calls, 2, "a completed response must not become a stale client-side outcome cache");
        } finally {
            release();
            globalThis.fetch = realFetch;
        }
    });

    test("in-flight searches do not cross player accounts", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const players: string[] = [];
        globalThis.fetch = (async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { playerName: string };
            players.push(body.playerName);
            await waiting;
            return jsonReply({ ok: true, requestId: "sameid123", pet: null, sector: 41 });
        }) as typeof fetch;
        try {
            const firstPlayer = startWildPetEncounter("Rill", 41, "sameid123");
            const secondPlayer = startWildPetEncounter("Sora", 41, "sameid123");
            assert.deepEqual(players, ["Rill", "Sora"], "request ids must only be coalesced within the same player account");
            release();
            const results = await Promise.all([firstPlayer, secondPlayer]);
            assert.deepEqual(results.map((result) => result.kind), ["miss", "miss"]);
        } finally {
            release();
            globalThis.fetch = realFetch;
        }
    });
    test("a lost response and temporary outage recover the same sealed miss without rerolling", { concurrency: false }, async () => {
        await withEncounterReplies([
            new TypeError("The response was lost after the server committed."),
            jsonReply({ error: "temporary" }, 503),
            jsonReply({ ok: true, requestId: "retrymiss123", pet: null, sector: 54, replayed: true }),
        ], async (bodies) => {
            assert.deepEqual(await startWildPetEncounter("Rill", 54, "retrymiss123", "expedition-id"), {
                kind: "miss", requestId: "retrymiss123", sector: 54, replayed: true,
            });
            assert.deepEqual(bodies, Array.from({ length: 3 }, () => ({
                playerName: "Rill", sector: 54, requestId: "retrymiss123", caravanRunId: "expedition-id",
            })), "automatic recovery must preserve the request id, sector, and expedition binding on every call");
        });
    });

    test("temporary failure recovers the server's sealed pet and exploration binding", { concurrency: false }, async () => {
        await withEncounterReplies([
            jsonReply({ error: "temporary" }, 503),
            jsonReply({
                ok: true, requestId: "sealedhit123", token: "petproof123", pet: { id: "pet-wolf", name: "Wolf" },
                sector: 33, replayed: true, worldExploreRequestId: "exploreproof123",
            }),
        ], async (bodies) => {
            assert.deepEqual(await startWildPetEncounter("Rill", 61, "retryhit123"), {
                kind: "hit", requestId: "sealedhit123", token: "petproof123", pet: { id: "pet-wolf", name: "Wolf" },
                sector: 33, replayed: true, worldExploreRequestId: "exploreproof123",
            });
            assert.deepEqual(bodies, Array.from({ length: 2 }, () => ({
                playerName: "Rill", sector: 61, requestId: "retryhit123",
            })), "recovery must not mint a new request id even when the server returns an older pending discovery");
        });
    });

    test("persistent transient failures stop after three calls and retain a retryable attempt", { concurrency: false }, async () => {
        await withEncounterReplies(Array.from({ length: 3 }, () => jsonReply({ error: "temporary" }, 503)), async (bodies) => {
            const result = await startWildPetEncounter("Rill", 41, "retryable123");
            assert.deepEqual(result, { kind: "blocked", error: "temporary", status: 503, retryable: true });
            assert.deepEqual(bodies, Array.from({ length: 3 }, () => ({
                playerName: "Rill", sector: 41, requestId: "retryable123",
            })));
            if (result.kind === "blocked") {
                assert.match(wildPetEncounterFailureMessage(result), /temporary.*saved attempt will be reused/);
            }
        });
    });

    test("presence startup is retried before blocking exploration", { concurrency: false }, async () => {
        await withEncounterReplies([
            jsonReply({ error: "Your world presence is not ready — give it a moment and try again.", reason: "no-presence" }, 409),
            jsonReply({ ok: true, requestId: "presence123", pet: null, sector: 41 }),
        ], async (bodies) => {
            assert.deepEqual(await startWildPetEncounter("Rill", 41, "presence123"), {
                kind: "miss", requestId: "presence123", sector: 41, replayed: false,
            });
            assert.deepEqual(bodies, Array.from({ length: 2 }, () => ({
                playerName: "Rill", sector: 41, requestId: "presence123",
            })));
        });
    });

    test("current and legacy daily-limit responses are terminal and explain the UTC reset", { concurrency: false }, async () => {
        for (const error of [
            { error: "Daily wild-pet search limit reached. Searches reset at midnight UTC.", reason: "daily-limit" },
            { error: "Daily exploration limit reached." },
        ]) {
            await withEncounterReplies([jsonReply(error, 429)], async (bodies) => {
                const result = await startWildPetEncounter("Rill", 41, "dailylimit123");
                assert.deepEqual(result, {
                    kind: "blocked", error: error.error, status: 429, retryable: false, reason: "daily-limit",
                });
                assert.equal(bodies.length, 1, "the daily cap cannot recover from an immediate retry");
                if (result.kind === "blocked") {
                    assert.equal(wildPetEncounterFailureMessage(result), "Daily wild-pet search limit reached (150/150). Resets at midnight UTC.");
                }
            });
        }
    });

    test("short-term throttling keeps the attempt retryable without automatically adding requests", { concurrency: false }, async () => {
        await withEncounterReplies([jsonReply({ error: "Too many requests." }, 429)], async (bodies) => {
            const result = await startWildPetEncounter("Rill", 41, "ratelimit123");
            assert.deepEqual(result, { kind: "blocked", error: "Too many requests.", status: 429, retryable: true });
            assert.equal(bodies.length, 1);
            if (result.kind === "blocked") {
                assert.equal(wildPetEncounterFailureMessage(result), "Too many exploration requests. Wait a moment, then try again; your saved attempt will be reused.");
            }
        });
    });

    test("an expired session retains the recovery receipt and asks for reconnection", { concurrency: false }, async () => {
        await withEncounterReplies([jsonReply({ error: "Authentication required." }, 401)], async (bodies) => {
            const result = await startWildPetEncounter("Rill", 41, "authretry123");
            assert.deepEqual(result, { kind: "blocked", error: "Authentication required.", status: 401, retryable: true });
            assert.equal(bodies.length, 1, "authentication must recover through sign-in, not repeated encounter requests");
            if (result.kind === "blocked") {
                assert.equal(wildPetEncounterFailureMessage(result), "Your session needs to reconnect. Sign in again, then explore to recover your saved attempt.");
            }
        });
        const worldMap = source("../screens/WorldMap.tsx");
        assert.match(worldMap, /if \(!petEncounter\.retryable\) completeWorldRewardOperation\(character\.name, operation\.id\)/,
            "retryable authentication failures must keep their durable recovery receipt");
    });

    test("an older dungeon discovery preserves its authoritative request id and sector for recovery", { concurrency: false }, async () => {
        await withEncounterReplies([jsonReply({
            error: "pending-dungeon-discovery", reason: "pending-dungeon-discovery", requestId: "olderdungeon123", sector: 27,
        }, 409)], async (bodies) => {
            assert.deepEqual(await startWildPetEncounter("Rill", 55, "newdiscovery123"), {
                kind: "blocked", error: "pending-dungeon-discovery", status: 409, retryable: true,
                reason: "pending-dungeon-discovery", pendingDungeon: { requestId: "olderdungeon123", sector: 27 },
            });
            assert.equal(bodies.length, 1, "the caller must recover the dungeon before retrying the pet stage");
        });
    });

    test("authorization and sector refusals show the actual server error without automatic retries", { concurrency: false }, async () => {
        for (const failure of [
            { status: 403, data: { error: "Not your encounter." } },
            { status: 409, data: { error: "You are not in that sector.", reason: "sector-mismatch" } },
        ]) {
            await withEncounterReplies([jsonReply(failure.data, failure.status)], async (bodies) => {
                const result = await startWildPetEncounter("Rill", 41, "refused123");
                assert.equal(result.kind, "blocked");
                assert.equal(bodies.length, 1);
                if (result.kind === "blocked") {
                    assert.equal(result.retryable, false);
                    assert.equal(result.status, failure.status);
                    assert.equal(wildPetEncounterFailureMessage(result), failure.data.error);
                }
            });
        }
    });
    test("exploration and receipt recovery present the actual wild-pet refusal", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.match(worldMap, /notifyFailure\(wildPetEncounterFailureMessage\(petEncounter\)\)/,
            "the Explore notice must distinguish the daily limit, authentication, and temporary failures");
        assert.ok(!worldMap.includes("The wild-pet search is still syncing."),
            "a fixed syncing message must not hide a terminal refusal");
        assert.match(source("./world-reward-drain.ts"), /continueWorldDiscovery\(operation, false, \(message\) => \{ discoveryFailure = message; \}\)/,
            "background receipt recovery must retain the specific refusal for an interactive retry");
        assert.match(source("./world-reward-drain.ts"), /message: discoveryFailure \?\? "A previous World reward/,
            "a blocked recovery must show its specific refusal");
        assert.match(source("./world-reward-drain.ts"), /message: discoveryFailure \?\? "An expired World discovery/,
            "retiring a capped attempt must not mislabel the cap as an expired discovery");
    });

    test("new and restored pet searches resume the server's pending dungeon before continuing", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.match(worldMap, /if \(petEncounter\.pendingDungeon\) \{[\s\S]{0,150}await recoverPetBlockedByDungeon\(operation, petEncounter\.pendingDungeon,/,
            "a new Explore click must hand off to the pending dungeon");
        assert.match(worldMap, /encounter\.kind === "blocked" && encounter\.pendingDungeon[\s\S]{0,120}recoverPetBlockedByDungeon\(operation, encounter\.pendingDungeon, reportFailure\)/,
            "a restored pet card must use the same pending dungeon recovery path");
        const handoff = worldMap.slice(
            worldMap.indexOf("async function recoverPetBlockedByDungeon"),
            worldMap.indexOf("async function recoverPendingExternalDiscovery"),
        );
        assert.match(handoff, /beginWorldDiscoveryOperation\(\s*character\.name, pendingDungeon\.sector, "dungeon", undefined, pendingDungeon\.requestId/,
            "the handoff must bind the server's sector and request id");
        assert.match(handoff, /recoverPendingExternalDiscovery\(rebound, "dungeon", reportFailure\)/,
            "the rebound operation must actually resume dungeon recovery");
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

    test("Leave retries a lost or malformed ACK using the same token", { concurrency: false }, async () => {
        await withEncounterReplies([
            new TypeError('Lost after Leave committed'),
            jsonReply({ ok: true, token: 'wrong-token' }),
            jsonReply({ ok: true, token: 'petproof123', replayed: true }),
        ], async (bodies) => {
            assert.deepEqual(await declineWildPetEncounter('Rill', 'petproof123'), {
                ok: true, token: 'petproof123', replayed: true, retryable: false,
            });
            assert.deepEqual(bodies, Array.from({ length: 3 }, () => ({ playerName: 'Rill', token: 'petproof123' })));
        });
    });

    test("pet choices stop after three malformed ACKs and remain retryable", { concurrency: false }, async () => {
        for (const choose of [declineWildPetEncounter, befriendWildPet]) {
            await withEncounterReplies(Array.from({ length: 3 }, () => jsonReply({})), async (bodies) => {
                const result = await choose('Rill', 'petproof123');
                assert.equal(result.retryable, true);
                assert.equal(bodies.length, 3);
            });
        }
    });

    test("pet choice authentication and throttling retain recovery without automatic retries", { concurrency: false }, async () => {
        for (const choose of [declineWildPetEncounter, befriendWildPet]) {
            for (const status of [401, 429]) {
                await withEncounterReplies([jsonReply({ error: 'refused' }, status)], async (bodies) => {
                    const result = await choose('Rill', 'petproof123');
                    assert.equal(result.retryable, true);
                    if (status === 401) assert.match(result.error ?? '', /Sign in again/);
                    assert.equal(bodies.length, 1);
                });
            }
            await withEncounterReplies([jsonReply({ error: 'invalid-or-spent-encounter' }, 409)], async (bodies) => {
                const result = await choose('Rill', 'petproof123');
                assert.equal(result.retryable, false);
                assert.equal(result.error, 'invalid-or-spent-encounter');
                assert.equal(bodies.length, 1);
            });
        }
    });

    test("befriending replays the same token after a committed response is lost", { concurrency: false }, async () => {
        await withEncounterReplies([
            new TypeError('Lost after Befriend committed'),
            jsonReply({ error: 'temporary' }, 503),
            jsonReply({ ok: true, replayed: true, character: { name: 'Rill', pets: [{ id: 'sealed-pet' }] }, _saveVersion: 7 }),
        ], async (bodies) => {
            const result = await befriendWildPet('Rill', 'petproof123');
            assert.equal(result.character?.name, 'Rill');
            assert.equal(result.saveVersion, 7);
            assert.equal(result.character?.pets?.length, 1);
            assert.deepEqual(bodies, Array.from({ length: 3 }, () => ({ playerName: 'Rill', token: 'petproof123' })));
        });
    });

    test("duplicate pet choices share one request and completed choices are not cached", { concurrency: false }, async () => {
        for (const choose of [declineWildPetEncounter, befriendWildPet]) {
            const realFetch = globalThis.fetch;
            let release!: () => void;
            const waiting = new Promise<void>((resolve) => { release = resolve; });
            let calls = 0;
            globalThis.fetch = (async () => {
                calls++;
                await waiting;
                return jsonReply({ ok: true, token: 'petproof123', character: { name: 'Rill' }, _saveVersion: 7 });
            }) as typeof fetch;
            try {
                const first = choose('Rill', 'petproof123');
                const second = choose('Rill', 'petproof123');
                await Promise.resolve();
                assert.equal(calls, 1);
                release();
                const results = await Promise.all([first, second]);
                assert.deepEqual(results[0], results[1]);
                await choose('Rill', 'petproof123');
                assert.equal(calls, 2);
            } finally {
                release();
                globalThis.fetch = realFetch;
            }
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

    test("wild binding commits through the server and adopts its character", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const binding = source("../components/WildPetBinding.tsx");
        assert.ok(worldMap.includes("<WildPetBinding"), "the sealed discovery must enter the battle and binding screen");
        assert.ok(binding.includes("captureWildPet(character.name, token, selectedSeal, stableId)"), "binding must spend a chosen seal on the server");
        assert.ok(binding.includes("onVersionedCharacter(response.character, response._saveVersion)"), "the server's character and save version must be adopted together");

        assert.ok(
            !/pets:\s*\[\s*\.\.\.character\.pets/.test(worldMap),
            "the world map must not append a pet to the roster locally — the save sanitizer strips it",
        );
        assert.ok(
            !worldMap.includes("rollPetTrait("),
            "the trait is rolled by the server alongside the roster write",
        );
        assert.match(source("./world-reward-drain.ts"), /outcome\.source === "pet"[\s\S]{0,360}recoverPendingExternalDiscovery\(operation, "pet",/,
            "reload must revalidate a cached external-pet token from the stable request receipt before showing choices");
        assert.ok(binding.includes("declineWildPetEncounter(character.name, token)"), "Leave must resolve the durable server pointer");
        assert.ok(worldMap.includes("completeWorldRewardOperation(character.name, operationId)"), "resolved binding clears the parked Explore operation");
    });

    test("both endpoints the client depends on exist and are routed", () => {
        const routes = source("../../../server-api-routes.ts");
        for (const path of ["/pet/encounter-start", "/pet/befriend", "/pet/encounter-decline", "/pet/wild-binding"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
