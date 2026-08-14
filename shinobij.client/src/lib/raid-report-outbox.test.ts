import { strict as assert } from "node:assert";
import test from "node:test";
import {
    enqueueRaidReport,
    flushRaidReportOutbox,
    readRaidReportOutbox,
    RAID_REPORT_OUTBOX_MAX_AGE_MS,
    type RaidReportOutboxStorage,
} from "./raid-report-outbox";

function fakeStorage(): RaidReportOutboxStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => void map.set(key, value),
        removeItem: (key) => void map.delete(key),
    };
}

test("PvP raid reports park by canonical account and exact battle id", () => {
    const storage = fakeStorage();
    enqueueRaidReport("Rill O'Neil!", "pvp-world-001", 44, storage);
    enqueueRaidReport("rilloneil", "pvp-world-001", 44, storage);
    assert.deepEqual(readRaidReportOutbox("RILL O NEIL", storage), [
        { battleId: "pvp-world-001", sector: 44, addedAt: readRaidReportOutbox("Rill O'Neil!", storage)[0].addedAt },
    ]);
});

test("only an exact credited-id ACK drains a parked raid", async () => {
    const storage = fakeStorage();
    enqueueRaidReport("Rill", "pvp-world-retry", 12, storage);
    const retry = await flushRaidReportOutbox("Rill", storage, async () => null);
    assert.deepEqual(retry?.acknowledgements, []);
    assert.equal(readRaidReportOutbox("Rill", storage).length, 1);

    const accepted = await flushRaidReportOutbox("Rill", storage, async (_player, entry) => ({
        entry,
        fetchMissionsCredited: ["fetch-c-1"],
        missionsCompleted: [],
        saveVersion: 41,
        territoryDamage: 250,
        sector: 12,
    }));
    assert.deepEqual(accepted?.acknowledgements[0].fetchMissionsCredited, ["fetch-c-1"]);
    assert.deepEqual(readRaidReportOutbox("Rill", storage), []);
});

test("raid reports survive the server replay window and then prune", () => {
    const storage = fakeStorage();
    const key = "pvpRaidReportOutbox.v1:rill";
    storage.setItem(key, JSON.stringify([
        { battleId: "still-authoritative", sector: 4, addedAt: Date.now() - 24 * 60 * 60 * 1000 },
        { battleId: "expired", sector: 5, addedAt: Date.now() - RAID_REPORT_OUTBOX_MAX_AGE_MS - 1_000 },
    ]));
    assert.deepEqual(readRaidReportOutbox("Rill", storage).map((entry) => entry.battleId), ["still-authoritative"]);
});
