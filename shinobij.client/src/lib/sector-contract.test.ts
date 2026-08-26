import assert from "node:assert/strict";
import test from "node:test";
import { contractSectorsForDay, utcDayOf } from "../../../shared/sector-contracts";
import {
    __resetSectorContractFeatureState, fetchSectorContract, localSectorContract, sectorHasContract,
} from "./sector-contract";

const POSTED = contractSectorsForDay(utcDayOf(Date.now()))[0];

type FetchFn = typeof globalThis.fetch;
function withFetch(status: number, body: unknown, run: () => Promise<void>): Promise<void> {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    })) as unknown as FetchFn;
    return run().finally(() => { globalThis.fetch = original; });
}

test("a posted sector is known locally, with no request at all", () => {
    __resetSectorContractFeatureState();
    assert.ok(sectorHasContract(POSTED), "today's board should be readable locally");
    assert.equal(localSectorContract(POSTED)?.sector, POSTED);
});

// DISABLE_SECTOR_CONTRACTS makes the route 404. Without latching that, the map
// would keep marking a board the server will not honour, because the board is
// computed locally and nothing local knows the switch was thrown.
test("a 404 latches the feature off so the map stops marking a dead board", async () => {
    __resetSectorContractFeatureState();
    assert.ok(sectorHasContract(POSTED), "precondition: the board is live");

    await withFetch(404, {}, async () => {
        const status = await fetchSectorContract("Kaze", POSTED);
        assert.equal(status?.contract, null, "a disabled server reports no contract");
    });

    assert.equal(sectorHasContract(POSTED), false, "markers must go quiet after the 404");
    assert.equal(localSectorContract(POSTED), null);

    __resetSectorContractFeatureState();
    assert.ok(sectorHasContract(POSTED), "the reset hook restores the live board");
});

test("a transient failure does NOT latch the feature off", async () => {
    __resetSectorContractFeatureState();
    await withFetch(503, {}, async () => {
        assert.equal(await fetchSectorContract("Kaze", POSTED), null, "a 503 means ask again, not 'off'");
    });
    assert.ok(sectorHasContract(POSTED), "a server blip must not silence the board");
});

test("a malformed payload degrades to no contract rather than a half-rendered card", async () => {
    __resetSectorContractFeatureState();
    await withFetch(200, { ok: true, contract: null, progress: 99, claimable: true }, async () => {
        const status = await fetchSectorContract("Kaze", POSTED);
        assert.equal(status?.contract, null);
        assert.equal(status?.claimable, false, "no contract can never be claimable");
    });
});

// The card multiplies by `target` and calls `.toLocaleString()` on `ryo`, so a
// half-formed contract would throw during render rather than look wrong.
test("a half-formed contract is refused instead of reaching the card", async () => {
    __resetSectorContractFeatureState();
    const broken = [
        { sector: 5 },                                        // no target, no ryo, no day
        { sector: 5, target: 10, day: "2026-08-26" },          // no ryo
        { sector: 5, ryo: 100, day: "2026-08-26" },            // no target
        { sector: 5, target: 10, ryo: 100 },                  // no day
        { sector: 5, target: 0, ryo: 100, day: "2026-08-26" }, // an unreachable target
        { sector: 0, target: 10, ryo: 100, day: "2026-08-26" },
        { sector: 5, target: 10, ryo: -1, day: "2026-08-26" },
        { sector: 5, target: 10, ryo: 100, day: "nonsense" },
    ];
    for (const contract of broken) {
        await withFetch(200, { ok: true, contract, progress: 3, claimable: true }, async () => {
            const status = await fetchSectorContract("Kaze", POSTED);
            assert.equal(status?.contract, null, JSON.stringify(contract));
            assert.equal(status?.claimable, false);
        });
    }
});

test("a well-formed contract survives the boundary intact", async () => {
    __resetSectorContractFeatureState();
    const contract = { sector: 5, target: 10, ryo: 260, day: "2026-08-26", nightOnly: true };
    await withFetch(200, { ok: true, contract, progress: 10, claimable: true }, async () => {
        const status = await fetchSectorContract("Kaze", POSTED);
        assert.deepEqual(status?.contract, contract);
        assert.equal(status?.claimable, true);
    });
});