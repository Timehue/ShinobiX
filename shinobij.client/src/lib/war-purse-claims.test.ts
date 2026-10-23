import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
    claimSectorWarPurses,
    resetSectorPurseClaimSlots,
    SECTOR_PURSE_CLAIM_INTERVAL_MS,
    sectorPurseAlert,
    warRewardAlert,
} from "./war-purse-claims";

// War purses on the client (2026-10 rebalance, framework #7).

describe("war reward alerts", () => {
    it("keeps the crate, MVP and consolation lines and adds the purse", () => {
        assert.equal(warRewardAlert({ crates: 2, mvp: true, consolation: false }), "You received 2 Legendary War Crates from recent war rewards! Check your inventory.");
        assert.equal(warRewardAlert({ crates: 1, mvp: false, consolation: false, purse: 22_500 }),
            "You received 1 Legendary War Crate from recent war rewards! Check your inventory. War purse delivered: +22,500 ryo.");
        assert.equal(warRewardAlert({ crates: 0, mvp: false, consolation: true, purse: 13_500 }),
            "Consolation rewards from a recent war loss have been added to your account. War purse delivered: +13,500 ryo.");
        assert.equal(warRewardAlert({ crates: 0, mvp: false, consolation: false, purse: 4_000 }), "War purse delivered: +4,000 ryo.");
        assert.equal(warRewardAlert({ crates: 0, mvp: false, consolation: false }), null);
        assert.equal(sectorPurseAlert(9_000), "Sector war purse delivered: +9,000 ryo.");
    });
});

describe("the sector purse claim", () => {
    const realFetch = globalThis.fetch;
    let calls: Array<Record<string, unknown>> = [];
    beforeEach(() => {
        resetSectorPurseClaimSlots();
        calls = [];
        globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
            calls.push(JSON.parse(String(init?.body ?? "{}")));
            return new Response(JSON.stringify({ ok: true, granted: true, sectorPurseRyo: 9_000, character: { name: "Raider", ryo: 9_000 }, _saveVersion: 4 }), { status: 200 });
        }) as typeof fetch;
    });
    afterEach(() => { globalThis.fetch = realFetch; });

    it("asks once per interval per player, naming no war", async () => {
        const first = await claimSectorWarPurses({ name: "Raider" }, 1_000);
        assert.equal(first?.ryo, 9_000);
        assert.equal(first?._saveVersion, 4);
        assert.deepEqual(calls, [{ playerName: "Raider", kind: "sector" }]);
        assert.equal(await claimSectorWarPurses({ name: "Raider" }, 1_000 + SECTOR_PURSE_CLAIM_INTERVAL_MS - 1), null, "throttled");
        assert.equal(calls.length, 1);
        assert.ok(await claimSectorWarPurses({ name: "Raider" }, 1_000 + SECTOR_PURSE_CLAIM_INTERVAL_MS));
        assert.equal(calls.length, 2);
    });

    it("adopts nothing when the server paid nothing or refused", async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, granted: false, character: { name: "Raider" } }), { status: 200 })) as typeof fetch;
        assert.equal(await claimSectorWarPurses({ name: "Raider" }, 1), null);
        resetSectorPurseClaimSlots();
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: "slow down" }), { status: 429 })) as typeof fetch;
        assert.equal(await claimSectorWarPurses({ name: "Raider" }, 1), null);
    });
});
