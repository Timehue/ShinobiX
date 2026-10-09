import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Character } from "../types/character";
import {
    __resetSettledWarClaimsForTest,
    activeVillageWarsFor,
    claimServerWarCrates,
    hydrateSharedWorldState,
    loadVillageWar,
    villageWarHpMax,
    VILLAGE_WAR_HP_MAX,
    type VillageWar,
} from "./world-state";
import { __setVillageWarMissionRetryMsForTest, applyVillageWarMissionDamage } from "./village-war-mission-damage";

const MOON = "Moonshadow Village";
const STORM = "Stormveil Village";
const originalFetch = globalThis.fetch;

beforeEach(() => {
    __resetSettledWarClaimsForTest();
    __setVillageWarMissionRetryMsForTest(1);
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    hydrateSharedWorldState({ wars: [] });
});

function liveWar(overrides: Partial<VillageWar> = {}): Partial<VillageWar> & { villages: [string, string] } {
    return {
        id: "moonshadowvillage-vs-stormveilvillage",
        declarationGeneration: 2,
        villages: [MOON, STORM],
        hp: { [MOON]: 4_000, [STORM]: 3_000 },
        warGroundSector: 40,
        warGroundHp: 700,
        startedAt: Date.now() - 86_400_000,
        updatedAt: Date.now() - 60_000,
        warCrateId: "war-crate-moonshadowvillage-vs-stormveilvillage-g2",
        contributions: {},
        ...overrides,
    };
}

function respondWith(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Sent = { url: string; method?: string; body: Record<string, unknown> };
function recordFetch(reply: (sent: Sent, call: number) => Response | Promise<Response>): Sent[] {
    const sent: Sent[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const entry = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
        sent.push(entry);
        return reply(entry, sent.length);
    }) as typeof fetch;
    return sent;
}

const kaya = { name: "Kaya", village: MOON, clan: "", claimedWarCrateIds: [] } as unknown as Character;

describe("village-war rows keep the server's Ramparts max, peace offers and pre-war window", () => {
    it("does not clamp a village's war HP to 5,000 when Ramparts raised its max", () => {
        hydrateSharedWorldState({ wars: [liveWar({ hp: { [MOON]: 5_600, [STORM]: 5_000 }, hpMax: { [MOON]: 5_750 } })] });
        const war = loadVillageWar(MOON, STORM)!;
        assert.equal(war.hp[MOON], 5_600);
        assert.equal(war.hp[STORM], 5_000);
        assert.deepEqual(war.hpMax, { [MOON]: 5_750 });
        assert.equal(villageWarHpMax(war, MOON), 5_750);
        assert.equal(villageWarHpMax(war, STORM), VILLAGE_WAR_HP_MAX, "a village without Ramparts keeps the 5,000 base");
    });

    it("still clamps to the village's own max, and a missing HP means full HP", () => {
        hydrateSharedWorldState({ wars: [liveWar({ hp: { [MOON]: 9_999 } as Record<string, number>, hpMax: { [MOON]: 5_300, [STORM]: 5_150 } })] });
        const war = loadVillageWar(MOON, STORM)!;
        assert.equal(war.hp[MOON], 5_300);
        assert.equal(war.hp[STORM], 5_150);
    });

    it("keeps peace proposals and the pre-war window instead of dropping them", () => {
        const pendingUntil = Date.now() + 30 * 60_000;
        hydrateSharedWorldState({ wars: [liveWar({ peaceProposals: { [STORM]: 1_700_000_000_000 }, pendingUntil })] });
        const war = loadVillageWar(MOON, STORM)!;
        assert.deepEqual(war.peaceProposals, { [STORM]: 1_700_000_000_000 });
        assert.equal(war.pendingUntil, pendingUntil);
    });
});

describe("war mission damage is a server command the client waits for", () => {
    it("posts the token with the cached row, never a winner, end time or capture, and adopts the server's row", async () => {
        // A stale capture flag on the cached row must not reach the server as a
        // client capture, and an HP that would hit 0 must not name a winner.
        hydrateSharedWorldState({ wars: [liveWar({ hp: { [MOON]: 4_000, [STORM]: 20 }, capturedBy: STORM, capturedAt: 5 })] });
        const serverRow = { ...liveWar({ hp: { [MOON]: 4_000, [STORM]: 0 } }), endedAt: Date.now(), winnerVillage: MOON, updatedAt: Date.now() };
        const sent = recordFetch(() => respondWith(200, { war: serverRow }));

        const result = await applyVillageWarMissionDamage(kaya, "mission-token-1");

        assert.equal(sent.length, 1);
        assert.equal(sent[0].url, "/api/world-state");
        assert.equal(sent[0].method, "POST");
        assert.equal(sent[0].body.kind, "war");
        assert.equal(sent[0].body.warMissionToken, "mission-token-1");
        const war = sent[0].body.war as Record<string, unknown>;
        for (const field of ["winnerVillage", "endedAt", "capturedBy", "capturedAt", "warCrateId"]) {
            assert.equal(field in war, false, `${field} is the server's to stamp`);
        }
        assert.deepEqual(war.villages, [MOON, STORM]);
        assert.equal(result.ok, true);
        assert.match(result.note, /Stormveil Village HP -30\./);
        assert.match(result.note, /won the war/, "the server ended it with our village as winner");
        assert.equal(loadVillageWar(MOON, STORM)?.winnerVillage, MOON, "the server's row is adopted into the shared cache");
        assert.equal(activeVillageWarsFor(MOON).length, 0);
    });

    it("adopts the server's HP rather than a locally computed one", async () => {
        hydrateSharedWorldState({ wars: [liveWar()] });
        recordFetch(() => respondWith(200, { war: { ...liveWar({ hp: { [MOON]: 3_900, [STORM]: 2_810 } }), updatedAt: Date.now() } }));
        const result = await applyVillageWarMissionDamage(kaya, "mission-token-2");
        assert.equal(result.ok, true);
        assert.doesNotMatch(result.note, /won the war/);
        assert.equal(loadVillageWar(MOON, STORM)?.hp[STORM], 2_810);
    });

    it("does not announce damage the server refused, and does not retry a refusal", async () => {
        hydrateSharedWorldState({ wars: [liveWar()] });
        const sent = recordFetch(() => respondWith(403, { error: "War damage must reference the battle that produced it." }));
        const result = await applyVillageWarMissionDamage(kaya, "mission-token-3");
        assert.equal(result.ok, false);
        assert.doesNotMatch(result.note, /HP -30/);
        assert.match(result.note, /War damage must reference the battle that produced it\./);
        assert.equal(sent.length, 1);
        assert.equal(loadVillageWar(MOON, STORM)?.hp[STORM], 3_000, "nothing is subtracted locally");
    });

    it("retries an outage or a settling row with the same single-use token", async () => {
        hydrateSharedWorldState({ wars: [liveWar()] });
        const sent = recordFetch((_entry, call) => call === 1
            ? respondWith(503, { error: "Village-war state changed; retry settlement." })
            : respondWith(200, { war: { ...liveWar({ hp: { [MOON]: 4_000, [STORM]: 2_970 } }), updatedAt: Date.now() } }));
        const result = await applyVillageWarMissionDamage(kaya, "mission-token-4");
        assert.equal(result.ok, true);
        assert.deepEqual(sent.map(entry => entry.body.warMissionToken), ["mission-token-4", "mission-token-4"]);
    });

    it("reports a server it never reached", async () => {
        hydrateSharedWorldState({ wars: [liveWar()] });
        let calls = 0;
        globalThis.fetch = (async () => { calls += 1; throw new TypeError("Failed to fetch"); }) as typeof fetch;
        const result = await applyVillageWarMissionDamage(kaya, "mission-token-5");
        assert.equal(result.ok, false);
        assert.match(result.note, /could not be reached/);
        assert.equal(calls, 3);
    });

    it("sends nothing without a token or a war", async () => {
        let calls = 0;
        globalThis.fetch = (async () => { calls += 1; return respondWith(200, {}); }) as typeof fetch;
        hydrateSharedWorldState({ wars: [liveWar()] });
        assert.equal((await applyVillageWarMissionDamage(kaya, undefined)).ok, false);
        hydrateSharedWorldState({ wars: [] });
        assert.equal((await applyVillageWarMissionDamage(kaya, "mission-token-6")).ok, false);
        assert.equal(calls, 0);
    });
});

describe("the winner's-crate sweep only asks for crates the player earned", () => {
    const ended = (contributions: VillageWar["contributions"]) => liveWar({
        endedAt: Date.now() - 60_000,
        winnerVillage: MOON,
        hp: { [MOON]: 1_000, [STORM]: 0 },
        contributions,
    });

    it("skips a winner who never fought", async () => {
        hydrateSharedWorldState({ wars: [ended({})] });
        const sent = recordFetch(() => respondWith(200, { ok: true, granted: false, reason: "not-a-fighter" }));
        const crates = await claimServerWarCrates(kaya);
        assert.deepEqual(crates.ids, []);
        assert.equal(sent.length, 0);
    });

    it("asks for a fighter's crate under the server-stamped id", async () => {
        hydrateSharedWorldState({ wars: [ended({ kaya: { damage: 30, raids: 1, pvpKills: 0, side: MOON, name: "Kaya" } })] });
        const sent = recordFetch(() => respondWith(200, { ok: true, granted: true, character: { name: "Kaya" }, _saveVersion: 9 }));
        const crates = await claimServerWarCrates(kaya);
        assert.deepEqual(crates.ids, ["war-crate-moonshadowvillage-vs-stormveilvillage-g2"]);
        assert.deepEqual(sent.map(entry => entry.body.warCrateId), ["war-crate-moonshadowvillage-vs-stormveilvillage-g2"]);
    });
});
