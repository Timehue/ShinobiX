import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { DECLARE_WAR_WR, discountedWrCost } from "../../../api/_war-economy";
import type { Character } from "../types/character";
import { WAR_CRATE_EXPIRY_MS } from "../constants/game";
import { clearWarMapCache, type WarMapResponse } from "./village-war-map";
import {
    ADOPTED_WAR_ROW_GRACE_MS,
    claimableVillageWarCrates,
    loadWarDeclareQuote,
    mergeAdoptedWarRows,
    postVillageWarCommand,
    VILLAGE_WAR_DECLARE_HONOR_SEALS,
    VILLAGE_WAR_DECLARE_WR,
    villageWarDeclareWrCost,
    villageWarPeaceView,
    warCrateDeclineMessage,
    warDeclareBlockReason,
    warDeclareConfirmText,
    warDeclareCostText,
    warDeclareQuoteFromMap,
    type AdoptedWarRow,
} from "./village-war-hall";
import type { VillageWarRecord } from "./world-state";

const MOON = "Moonshadow Village";
const STORM = "Stormveil Village";
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    clearWarMapCache();
});

function warMap(villages: { village: string; warResources: number; sectorsHeld: number }[]): WarMapResponse {
    return { ok: true, enabled: true, contests: [], villages: villages.map(v => ({ ...v })) } as unknown as WarMapResponse;
}

function respondWith(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("declaration cost: the village pool pays, discounted by held sectors", () => {
    it("mirrors the server's discountedWrCost(DECLARE_WAR_WR, held) for every sector count", () => {
        assert.equal(VILLAGE_WAR_DECLARE_WR, DECLARE_WAR_WR);
        for (let held = 0; held <= 12; held += 1) {
            assert.equal(villageWarDeclareWrCost(held), discountedWrCost(DECLARE_WAR_WR, held), `held=${held}`);
        }
        assert.equal(villageWarDeclareWrCost(0), 0, "a village holding nothing declares for free");
        assert.equal(villageWarDeclareWrCost(2), 400);
        assert.equal(villageWarDeclareWrCost(8), 800);
    });

    it("keeps the switched-off Honor Seal price in step with the server", () => {
        const server = readFileSync(new URL("../../../api/world-state.ts", import.meta.url), "utf8");
        const match = /VILLAGE_WAR_DECLARATION_COST_HONOR_SEALS\s*=\s*(\d+)/.exec(server);
        assert.ok(match, "api/world-state.ts must still name its Honor Seal declaration price");
        assert.equal(VILLAGE_WAR_DECLARE_HONOR_SEALS, Number(match[1]));
    });

    it("prices from the war map's pool and held-sector count for the Kage's village", () => {
        const map = warMap([{ village: STORM, warResources: 90, sectorsHeld: 8 }, { village: MOON, warResources: 1_200, sectorsHeld: 3 }]);
        assert.deepEqual(warDeclareQuoteFromMap(map, MOON), { mode: "war-resources", cost: 600, pool: 1_200, sectorsHeld: 3 });
        assert.deepEqual(warDeclareQuoteFromMap(map, "Unlisted Village"), { mode: "unknown" });
    });

    it("reads the war map, and only a 404 (the war system switched off) falls back to the Kage's Honor Seals", async () => {
        globalThis.fetch = (async () => respondWith(200, warMap([{ village: MOON, warResources: 500, sectorsHeld: 1 }]))) as typeof fetch;
        assert.deepEqual(await loadWarDeclareQuote(MOON), { mode: "war-resources", cost: 200, pool: 500, sectorsHeld: 1 });

        clearWarMapCache();
        globalThis.fetch = (async () => respondWith(404, { error: "Not found." })) as typeof fetch;
        assert.deepEqual(await loadWarDeclareQuote(MOON), { mode: "honor-seals", cost: 500 });

        clearWarMapCache();
        globalThis.fetch = (async () => respondWith(500, { error: "Internal server error." })) as typeof fetch;
        assert.deepEqual(await loadWarDeclareQuote(MOON), { mode: "unknown" }, "an outage is not the switch");

        clearWarMapCache();
        globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
        assert.deepEqual(await loadWarDeclareQuote(MOON), { mode: "unknown" });
    });

    it("gives up on a hung war-map read instead of leaving the button disabled", async () => {
        const quote = await loadWarDeclareQuote(MOON, () => new Promise<WarMapResponse>(() => {}), 10);
        assert.deepEqual(quote, { mode: "unknown" });
    });

    it("gates on the payer: the village pool with the war system on, the Kage's seals only when it is off", () => {
        const pool = { mode: "war-resources", cost: 800, pool: 800, sectorsHeld: 6 } as const;
        assert.equal(warDeclareBlockReason(pool, 0), null, "a Kage with no Honor Seals can still declare from the pool");
        assert.match(warDeclareBlockReason({ ...pool, pool: 799 }, 10_000) ?? "", /800 War Resources.*799/);
        assert.match(warDeclareBlockReason({ mode: "honor-seals", cost: 500 }, 499) ?? "", /500 Honor Seals/);
        assert.equal(warDeclareBlockReason({ mode: "honor-seals", cost: 500 }, 500), null);
        assert.equal(warDeclareBlockReason({ mode: "unknown" }, 0), null, "an unknown price leaves it to the server");
        assert.match(warDeclareBlockReason(null, 10_000) ?? "", /Checking/);
    });

    it("says who pays in the cost line and the confirm", () => {
        const discounted = { mode: "war-resources", cost: 200, pool: 950, sectorsHeld: 1 } as const;
        assert.match(warDeclareCostText(discounted), /200 War Resources from the village pool \(comeback discount: 1 sector held\)/);
        assert.doesNotMatch(warDeclareCostText(discounted), /Honor Seals/);
        assert.match(warDeclareCostText({ ...discounted, cost: 0, sectorsHeld: 0 }), /^Free/);
        assert.match(warDeclareCostText({ mode: "honor-seals", cost: 500 }), /500 of your own Honor Seals/);
        assert.match(warDeclareConfirmText(discounted, STORM), /^Declare war on Stormveil Village\? This spends 200 War Resources from your village's pool\./);
        assert.doesNotMatch(warDeclareConfirmText(discounted, STORM), /Honor Seals/);
        assert.match(warDeclareConfirmText({ mode: "honor-seals", cost: 500 }, STORM), /500 Honor Seals from your own treasury/);
    });
});

describe("peace and surrender controls", () => {
    it("offers Propose, Accept or Withdraw from the war's peace proposals", () => {
        assert.deepEqual(villageWarPeaceView({}, MOON, STORM),
            { ourOfferAt: null, enemyOfferAt: null, peaceCommand: "propose-peace", peaceLabel: "Propose peace" });
        assert.deepEqual(villageWarPeaceView({ peaceProposals: { [STORM]: 1_000 } }, MOON, STORM),
            { ourOfferAt: null, enemyOfferAt: 1_000, peaceCommand: "propose-peace", peaceLabel: "Accept peace" });
        assert.deepEqual(villageWarPeaceView({ peaceProposals: { [MOON]: 2_000 } }, MOON, STORM),
            { ourOfferAt: 2_000, enemyOfferAt: null, peaceCommand: "withdraw-peace", peaceLabel: "Withdraw peace offer" });
        const junk = { peaceProposals: { [MOON]: Number.NaN, [STORM]: -5 } } as unknown as Pick<VillageWarRecord, "peaceProposals">;
        assert.equal(villageWarPeaceView(junk, MOON, STORM).peaceLabel, "Propose peace");
    });

    it("sends the Kage command as kind war-command and reports the server's answer", async () => {
        const sent: unknown[] = [];
        const war = { id: "moonshadowvillage-vs-stormveilvillage", villages: [MOON, STORM], updatedAt: 5 };
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            sent.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
            return respondWith(200, { war });
        }) as typeof fetch;
        assert.deepEqual(await postVillageWarCommand("surrender", MOON, STORM), { ok: true, war });
        assert.deepEqual(sent, [{ url: "/api/world-state", method: "POST", body: { kind: "war-command", command: "surrender", villages: [MOON, STORM] } }]);

        globalThis.fetch = (async () => respondWith(403, { error: "Only the seated Kage can do that." })) as typeof fetch;
        assert.deepEqual(await postVillageWarCommand("propose-peace", MOON, STORM), { ok: false, status: 403, error: "Only the seated Kage can do that." });

        globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
        const offline = await postVillageWarCommand("withdraw-peace", MOON, STORM);
        assert.equal(offline.ok, false);
    });
});

describe("rows adopted from a command survive a stale poll", () => {
    const base = { villages: [MOON, STORM] as [string, string], warGroundSector: 40, warGroundHp: 1_000, startedAt: 1 };
    const polledOld = { ...base, id: "a", updatedAt: 100 } as VillageWarRecord;
    const adoptedNew = { ...base, id: "a", updatedAt: 200, peaceProposals: { [MOON]: 200 } } as VillageWarRecord;

    it("keeps the newer adopted row until the poll catches up", () => {
        const adopted = new Map<string, AdoptedWarRow>([["a", { row: adoptedNew, at: 1_000 }]]);
        const stale = mergeAdoptedWarRows([polledOld], adopted, 1_500);
        assert.equal(stale.wars[0], adoptedNew);
        assert.ok(stale.pending.has("a"));

        const caughtUp = { ...adoptedNew, updatedAt: 200 } as VillageWarRecord;
        const fresh = mergeAdoptedWarRows([caughtUp], stale.pending, 2_000);
        assert.equal(fresh.wars[0], caughtUp, "an equal or newer polled row wins");
        assert.equal(fresh.pending.size, 0);
    });

    it("shows a just-declared war the poll does not carry yet, until its grace runs out", () => {
        const adopted = new Map<string, AdoptedWarRow>([["new", { row: { ...adoptedNew, id: "new" }, at: 1_000 }]]);
        assert.equal(mergeAdoptedWarRows([], adopted, 1_000).wars.length, 1);
        assert.equal(mergeAdoptedWarRows([], adopted, 1_000 + ADOPTED_WAR_ROW_GRACE_MS + 1).wars.length, 0);
    });
});

describe("winner's crate banner: only fighters of the winning side, under the server's crate id", () => {
    const now = 10_000_000_000;
    const won = (overrides: Partial<VillageWarRecord> = {}): VillageWarRecord => ({
        id: "moonshadowvillage-vs-stormveilvillage",
        declarationGeneration: 3,
        villages: [MOON, STORM],
        hp: { [MOON]: 1_200, [STORM]: 0 },
        warGroundSector: 40,
        warGroundHp: 500,
        startedAt: now - 5 * 86_400_000,
        updatedAt: now - 60_000,
        endedAt: now - 60_000,
        winnerVillage: MOON,
        warCrateId: "war-crate-moonshadowvillage-vs-stormveilvillage-g3",
        contributions: {},
        mvpByVillage: { [MOON]: "Hana" },
        ...overrides,
    });
    const kaya = { name: "Kaya Storm", village: MOON, claimedWarCrateIds: [] } as unknown as Character;
    const fought = { kayastorm: { damage: 35, raids: 1, pvpKills: 1, side: MOON, name: "Kaya Storm" } };

    it("offers the crate to a winner who dealt war damage, keyed by the server-stamped id", () => {
        const offered = claimableVillageWarCrates([won({ contributions: fought })], kaya, now);
        assert.deepEqual(offered.map(w => w.warCrateId), ["war-crate-moonshadowvillage-vs-stormveilvillage-g3"]);
    });

    it("does not offer it to a winner who never fought", () => {
        assert.deepEqual(claimableVillageWarCrates([won()], kaya, now), []);
        const zero = { kayastorm: { ...fought.kayastorm, damage: 0 } };
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: zero })], kaya, now), []);
        const otherSide = { kayastorm: { ...fought.kayastorm, side: STORM } };
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: otherSide })], kaya, now), [],
            "damage dealt for the other side does not count");
    });

    it("offers it to the winning side's MVP even without a ledger entry under their slug", () => {
        const hana = { name: "Hana", village: MOON, claimedWarCrateIds: [] } as unknown as Character;
        assert.equal(claimableVillageWarCrates([won()], hana, now).length, 1);
    });

    it("hides claimed, declined, expired and lost wars", () => {
        const id = "war-crate-moonshadowvillage-vs-stormveilvillage-g3";
        const claimed = { ...kaya, claimedWarCrateIds: [id] } as Character;
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: fought })], claimed, now), []);
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: fought })], kaya, now, new Set([id])), []);
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: fought, endedAt: now - WAR_CRATE_EXPIRY_MS - 1 })], kaya, now), []);
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: fought, winnerVillage: STORM })], kaya, now), []);
        assert.deepEqual(claimableVillageWarCrates([won({ contributions: fought, warCrateId: undefined })], kaya, now), [],
            "a row without a server crate id has nothing the server would grant");
    });

    it("is not hidden by the legacy rebuilt id, which never matched a rematch's crate", () => {
        const legacy = { ...kaya, claimedWarCrateIds: ["war-crate-moonshadowvillage-vs-stormveilvillage"] } as Character;
        assert.equal(claimableVillageWarCrates([won({ contributions: fought })], legacy, now).length, 1);
    });

    it("explains a declined claim in words", () => {
        assert.match(warCrateDeclineMessage("already-claimed"), /already claimed/);
        assert.match(warCrateDeclineMessage("expired"), /expired/);
        assert.match(warCrateDeclineMessage("not-winner"), /winning village/);
        assert.match(warCrateDeclineMessage("not-a-fighter"), /fought for the winning village/);
    });
});
