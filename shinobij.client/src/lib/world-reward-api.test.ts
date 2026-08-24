import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { openAncientChest, recordSectorExplore } from "./world-reward-api";

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
        assert.match(worldMap, /await recordMissionExplore\(operation\.sector, operation\.id, result\.fieldProgress\)/,
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
        const routes = source("../../../server.ts");
        for (const path of ["/world/explore", "/world/open-chest", "/village/war-mission"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
