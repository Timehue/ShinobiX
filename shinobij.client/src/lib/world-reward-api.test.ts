import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { openAncientChest, recordSectorExplore, worldRewardFailureMessage } from "./world-reward-api";

/*
 * Regression guard: world-map rewards must be settled by the server.
 *
 * Everything an explored tile can pay is server-owned in `sanitizeCharacterSave`
 * (api/save/[name].ts): tile cards are rejected outright, every entry in
 * CURRENCY_CAPS is 0, inventory is clamped to one net-new item per save, and
 * `totalTilesExplored` has a per-save delta of 0. Computing any of it in the
 * browser and leaning on the autosave means the player watches the reward land
 * and then lose it on the next reload.
 *
 * The endpoints (/api/world/explore, /api/world/open-chest,
 * /api/village/war-mission) are the only paths that can actually pay out.
 */

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("world-map reward settlement", () => {

    test("concurrent exploration and chest recovery share requests only for identical player receipts", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        globalThis.fetch = (async (url, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            calls.push({ url: String(url), body });
            await waiting;
            return new Response(JSON.stringify({ character: { name: body.playerName }, loot: { xp: 0, ryo: 80 } }));
        }) as typeof fetch;
        try {
            const explore = () => recordSectorExplore("Rill", 61, "tile", "singleflight123", { resolveOutcome: true });
            const chest = () => openAncientChest("Rill", 61, "singlechest123", "singleflight123");
            const requests = [explore(), explore(), chest(), chest(),
                recordSectorExplore("Sora", 61, "tile", "singleflight123", { resolveOutcome: true }),
                openAncientChest("Sora", 61, "singlechest123", "singleflight123")];
            await Promise.resolve();
            assert.equal(calls.length, 4, "one exploration and one chest per player; duplicate UI recovery shares them");
            release();
            const results = await Promise.all(requests);
            assert.deepEqual(results[0], results[1]);
            assert.deepEqual(results[2], results[3]);
            assert.equal(results[4].character?.name, "Sora");
            await Promise.all([explore(), chest()]);
            assert.equal(calls.length, 6, "completed snapshots must never be cached across later save versions");
        } finally {
            release();
            globalThis.fetch = realFetch;
        }
    });

    test("lost exploration and chest acknowledgements recover with exactly the same proofs", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const calls = new Map<string, Record<string, unknown>[]>();
        globalThis.fetch = (async (url, init) => {
            const path = String(url);
            const bodies = calls.get(path) ?? [];
            bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            calls.set(path, bodies);
            if (bodies.length === 1) throw new TypeError("Response lost after committing");
            if (bodies.length === 2) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
            return new Response(JSON.stringify({ character: { name: "Rill" }, _saveVersion: 4,
                replayed: true, outcome: { kind: "external", source: "pet" }, loot: { xp: 0, ryo: 80 } }));
        }) as typeof fetch;
        try {
            const [explored, chest] = await Promise.all([
                recordSectorExplore("Rill", 41, "tile", "lostexplore123", { externalOutcomeProof: { kind: "pet", token: "petproof123" } }),
                openAncientChest("Rill", 61, "lostchest123", "chestexplore123"),
            ]);
            assert.equal(explored.replayed, true);
            assert.equal(explored.character?.name, "Rill");
            assert.deepEqual(chest.loot, { xp: 0, ryo: 80 });
            assert.deepEqual(calls.get('/api/world/explore'), Array.from({ length: 3 }, () => ({
                playerName: "Rill", sector: 41, credit: "tile", requestId: "lostexplore123",
                externalOutcomeProof: { kind: "pet", token: "petproof123" },
            })));
            assert.deepEqual(calls.get('/api/world/open-chest'), Array.from({ length: 3 }, () => ({
                playerName: "Rill", sector: 61, requestId: "lostchest123", worldExploreRequestId: "chestexplore123",
            })));
        } finally { globalThis.fetch = realFetch; }
    });

    test("reconnecting presence recovers the same exploration; persistent faults stop after three calls", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return calls === 1
                ? new Response(JSON.stringify({ error: "Reconnect first.", reason: "no-presence" }), { status: 409 })
                : new Response(JSON.stringify({ character: { name: "Rill" }, _saveVersion: 2 }));
        }) as typeof fetch;
        try {
            assert.equal((await recordSectorExplore("Rill", 41, "tile", "presenceproof123")).character?.name, "Rill");
            assert.equal(calls, 2);
            calls = 0;
            globalThis.fetch = (async () => {
                calls++;
                return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
            }) as typeof fetch;
            const failure = await recordSectorExplore("Rill", 41, "tile", "offlineproof123");
            assert.equal(calls, 3, "persistent errors stay parked without an unbounded request loop");
            assert.equal(failure.retryable, true);
            assert.equal(failure.status, 503);
        } finally { globalThis.fetch = realFetch; }
    });

    test("discovered chests survive all refusals without immediately retrying limits or authentication", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const failures = [
            { status: 409, error: "daily-limit" },
            { status: 409, error: "missing-chest-discovery" },
            { status: 410, error: "expired" },
            { status: 401, error: "Authentication required." },
            { status: 403, error: "Not your chest." },
            { status: 429, error: "Too many requests." },
        ];
        let calls = 0;
        try {
            for (const failure of failures) {
                globalThis.fetch = (async () => {
                    calls++;
                    return new Response(JSON.stringify({ error: failure.error }), { status: failure.status });
                }) as typeof fetch;
                const result = await openAncientChest("Rill", 41, "owedchest123", "owedexplore123");
                assert.equal(result.retryable, true, failure.error + " must not discard an owed payout");
                assert.equal(result.error, failure.error);
            }
            assert.equal(calls, failures.length, "daily caps, auth, and throttle refusals need later recovery, not automatic retries");
            globalThis.fetch = (async () => new Response(JSON.stringify({ error: "daily-limit" }), { status: 409 })) as typeof fetch;
            assert.equal((await recordSectorExplore("Rill", 41, "tile", "cappedexplore123")).retryable, false,
                "a refused new exploration has no owed reward and cannot block every sector");
        } finally { globalThis.fetch = realFetch; }
    });

    test("reward failures distinguish limits, reconnects, active encounters, and real expired proofs", () => {
        assert.match(worldRewardFailureMessage({ error: "daily-limit", status: 409 }), /Daily tile exploration limit/);
        assert.match(worldRewardFailureMessage({ error: "daily-limit", status: 409 }, "chest"), /Daily chest limit.*remains saved/);
        assert.match(worldRewardFailureMessage({ error: "no", reason: "no-presence", status: 409, retryable: true }), /reconnecting/);
        assert.match(worldRewardFailureMessage({ error: "hospitalized", status: 409 }), /hospital/);
        assert.match(worldRewardFailureMessage({ error: "battle-active", status: 409 }), /active battle/);
        assert.match(worldRewardFailureMessage({ error: "Not your exploration.", status: 403, retryable: false }), /Not your exploration/);
        assert.doesNotMatch(worldRewardFailureMessage({ error: "Not your exploration.", status: 403, retryable: false }), /expired|syncing/);
        assert.match(worldRewardFailureMessage({ error: "missing-pet-discovery", status: 409, retryable: false }), /no longer available/);
        assert.match(worldRewardFailureMessage({ error: "offline", retryable: true }, "chest"), /remains saved/);
    });
    test("explore and chest requests preserve the exact outcome proof", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const bodies: Record<string, unknown>[] = [];
        globalThis.fetch = (async (_input, init) => {
            bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return new Response(JSON.stringify(bodies.length === 1
                ? { character: { name: "Rill", redeemedSectorExplorations: [] }, _saveVersion: 3, replayed: true, outcome: { kind: "battle" }, reward: { sector: 61, xp: 0, ryo: 0 }, fieldProgress: [{ missionId: "field-61", runId: "runproof123", exploreCount: 2, replayed: true }] }
                : { character: { name: "Rill" }, _saveVersion: 4, loot: { xp: 0, ryo: 80 } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }) as typeof fetch;
        try {
            const explored = await recordSectorExplore("Rill", 61, "tile", "exploreproof123", { resolveOutcome: true });
            assert.equal(explored.outcome?.kind, "battle");
            assert.deepEqual(explored.fieldProgress, [{ missionId: "field-61", runId: "runproof123", exploreCount: 2, replayed: true }],
                "durable proof must project exact field progress even after the character's 150-row receipt window rolls over");
            await openAncientChest("Rill", 61, "chestoperation123", "exploreproof123");
            assert.deepEqual(bodies, [
                { playerName: "Rill", sector: 61, credit: "tile", requestId: "exploreproof123", resolveOutcome: true },
                { playerName: "Rill", sector: 61, requestId: "chestoperation123", worldExploreRequestId: "exploreproof123" },
            ]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("definitive expired proof retires while transport/server failures remain retryable", { concurrency: false }, async () => {
        const realFetch = globalThis.fetch;
        const replies = [
            new Response(JSON.stringify({ error: "missing-pet-discovery" }), { status: 409, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ error: "pending-pet-discovery" }), { status: 409, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }),
            new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "Content-Type": "application/json" } }),
        ];
        globalThis.fetch = (async () => replies.shift()!) as typeof fetch;
        try {
            const expired = await recordSectorExplore("Rill", 41, "tile", "expiredproof123", { externalOutcomeProof: { kind: "pet", token: "petproof123" } });
            const pending = await recordSectorExplore("Rill", 41, "tile", "pendingproof123", { externalOutcomeProof: { kind: "pet", token: "petproof123" } });
            const transient = await openAncientChest("Rill", 41, "chestoperation123", "exploreproof123");
            assert.equal(expired.retryable, false);
            assert.equal(pending.retryable, true);
            assert.equal(transient.retryable, true);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("a sector-depleted chest is parked for tomorrow; a depleted EXPLORE is retired", { concurrency: false }, async () => {
        // The shared per-sector pool resets at midnight UTC, so `sector-depleted`
        // is time-boxed. What it means depends on whether anything is owed.
        //
        // A discovered chest IS owed: the player already spent a daily chest slot
        // on it. Retiring it threw the loot away while the server-side pending
        // mirror kept re-importing the entry, so "This sector has been picked
        // clean for today." looped all day over loot nobody could collect.
        //
        // A refused EXPLORE is owed nothing — no pool slot, no save write, no
        // receipt. Parking it would soft-lock exploring exactly like the bug
        // above: the outbox retries it on the next explore, the sector is still
        // depleted, and every other sector is blocked behind it until midnight.
        const realFetch = globalThis.fetch;
        const depleted = () => new Response(
            JSON.stringify({ error: "sector-depleted", reason: "sector-depleted", sectorPool: { exploresUsed: 1500, exploresCap: 1500, chestsUsed: 225, chestsCap: 225 } }),
            { status: 409, headers: { "Content-Type": "application/json" } },
        );
        globalThis.fetch = (async () => depleted()) as typeof fetch;
        try {
            const explored = await recordSectorExplore("Rill", 66, "full", "depletedproof123", { resolveOutcome: true });
            const chest = await openAncientChest("Rill", 66, "chestoperation456", "depletedproof123");
            assert.equal(explored.error, "sector-depleted");
            assert.equal(explored.retryable, false, "a refused explore owes nothing and must not park");
            assert.equal(chest.error, "sector-depleted");
            assert.equal(chest.retryable, true, "a discovered chest must never be thrown away");
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test("a depleted sector is refused before the discovery probes commit anything", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const gate = worldMap.slice(worldMap.indexOf("async function exploreSector("));
        const body = gate.slice(0, gate.indexOf("await resolveExplore(sector)"));
        assert.match(body, /sectorExploreRefusal\(sector, loadSectorTerritory\(sector\)\.ownerVillage, character\.village\)/,
            "the pool pre-check must sit next to the 150/day check, ahead of the dungeon/pet probes");
        assert.ok(body.indexOf("sectorExploreRefusal(") < body.indexOf("setCurrentSector(sector)"),
            "and it must refuse before the screen commits the player to the sector");
    });

    test("exploring a tile is counted by the server on every branch", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.match(worldMap, /beginWorldDiscoveryOperation\([\s\S]{0,180}character\.level >= hiddenDungeonVnEvent\.levelReq \? "dungeon" : "pet"/,
            "a stable operation must be parked before any discovery probe");
        assert.match(worldMap, /settleExplore\(operation\.sector, \{[\s\S]{0,100}resolveOutcome: true,[\s\S]{0,100}operationId: operation\.id/,
            "the server must roll the final chest/battle/quiet outcome using the same probe receipt");
        assert.match(worldMap, /probeFreeDungeonServer\(character\.name, operation\.sector, operation\.id\)/);
        assert.match(worldMap, /startWildPetEncounter\(character\.name, operation\.sector, operation\.id\)/);
        assert.match(worldMap, /externalOutcomeProof: \{ kind: "dungeon", token: probe\.token \}/);
        assert.match(worldMap, /externalOutcomeProof: \{ kind: "pet", token: petEncounter\.token \}/);
        assert.doesNotMatch(worldMap, /Math\.random\(\) < 0\.15|battleRoll|randomAi/,
            "the client must not choose a profitable exploration outcome or opponent");
        assert.ok(
            !/totalTilesExplored:\s*\(character\.totalTilesExplored/.test(worldMap),
            "the client must not increment totalTilesExplored — the sanitizer freezes it",
        );
    });

    test("the Ancient Chest is rolled and banked by the server", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.ok(
            /openAncientChest\([\s\S]{0,180}chestOperation\.id,[\s\S]{0,80}worldExploreRequestId/.test(worldMap),
            "the chest must bind its payout to the exact server-rolled discovery",
        );
        assert.ok(
            !worldMap.includes("function rollAncientChest("),
            "the client chest roll table must be gone — its loot could never persist",
        );
        // The claim button only dismisses the reveal now. If it starts crediting
        // again, the sanitizer will eat the cards and the premium currency.
        const claim = worldMap.slice(worldMap.indexOf("function claimChest("));
        const body = claim.slice(0, claim.indexOf("\n    }"));
        for (const field of ["fateShards", "boneCharms", "auraStones", "auraDust", "tileCards"]) {
            assert.ok(!body.includes(field), `claimChest must not credit ${field} locally`);
        }
    });

    test("explore and mission progress share one durable operation receipt", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const app = source("../App.tsx");
        assert.match(worldMap, /recordSectorExplore\([\s\S]{0,160}operation\.id/);
        assert.match(worldMap, /await recordMissionExplore\(sector, operation\.id, settled\.fieldProgress\)/);
        assert.match(source("./world-reward-drain.ts"), /await recordMissionExplore\(operation\.sector, operation\.id, result\.fieldProgress\)/,
            "reload recovery must retain the receipt until mission progress ACKs");
        assert.match(worldMap, /battleKind: "explore",[\s\S]{0,180}worldExploreRequestId,/,
            "the server-rolled battle must start from that same receipt");
        assert.match(app, /worldExploreRequestId/);
        assert.match(app, /result\?\.recorded !== true[\s\S]{0,80}return false/);
        assert.match(app, /if \(fieldProgress\)[\s\S]{0,500}setAcceptedMissionIds[\s\S]{0,500}setMissionProgress/,
            "the exact explore replay must hydrate cross-device mission UI without trusting stale accepted ids");
        assert.doesNotMatch(app, /pendingExploreSector|setPendingExploreSector/,
            "field exploration is proven by the tile receipt, not a later local combat callback");
    });

    test("the village-war mission reward is claimed from the server", () => {
        const logbook = source("../screens/Logbook.tsx");
        const call = logbook.indexOf("claimWarMissionServer(character.name, index)");
        assert.notEqual(call, -1, "the war mission must settle through /api/village/war-mission");
        const adopt = logbook.indexOf("onVersionedCharacter(settled.character, settled.saveVersion)", call);
        assert.ok(adopt > call, "the server's character and save version must be adopted atomically");
        assert.equal(logbook.indexOf("updateCharacter(settled.character)", call), -1, "war rewards must not split character adoption from its save version");
        // The war damage runs only after the reward commits — otherwise a
        // refused claim would still chip the enemy village.
        const damage = logbook.indexOf("applyVillageWarMissionDamage(", call);
        assert.ok(damage > adopt,
            "war damage must follow the reward, not precede it");

        const worldState = source("./world-state.ts");
        assert.ok(
            !worldState.includes("claimVillageWarDailyMission"),
            "the inline claim must be gone — it consumed the day's stamp and paid nothing",
        );
        const fn = worldState.slice(worldState.indexOf("export function applyVillageWarMissionDamage"));
        const fnBody = fn.slice(0, fn.indexOf("\n}"));
        assert.ok(
            !fnBody.includes("villageWarMissionsCompleted") && !fnBody.includes("clanMissionContrib"),
            "the war-damage half must not touch the server-owned counters",
        );
        assert.ok(
            !fnBody.includes("LEGENDARY_WAR_CRATE_ID"),
            "the winner crate comes from /api/village/claim-war-crate, not an inline grant",
        );
    });

    test("every endpoint the client depends on is routed", () => {
        const routes = source("../../../server-api-routes.ts");
        for (const path of ["/world/explore", "/world/open-chest", "/village/war-mission"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
