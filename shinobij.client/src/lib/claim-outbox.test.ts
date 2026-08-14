import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    enqueueClaim,
    removeClaim,
    readClaimOutbox,
    flushClaimOutbox,
    CLAIM_OUTBOX_MAX_AGE_MS,
    type ClaimOutboxStorage,
} from "./claim-outbox";

function fakeStorage(): ClaimOutboxStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
        removeItem: (key: string) => void map.delete(key),
    };
}

const accepted = (version: number) => ({
    queued: true,
    disposition: "accepted" as const,
    saveVersion: version,
    _saveVersion: version,
    character: { name: "Rill", level: 20, ryo: 100, inventory: [] } as never,
});

describe("run-scoped combat claim outbox", () => {
    it("parks and dedupes by authoritative run", () => {
        const storage = fakeStorage();
        enqueueClaim("Rill", "combat-e-1", "mission-run-0001", storage);
        enqueueClaim("Rill", "combat-e-1", "mission-run-0001", storage);
        enqueueClaim("Rill", "combat-e-1", "mission-run-0002", storage);
        assert.deepEqual(
            readClaimOutbox("Rill", storage).map((entry) => [entry.missionId, entry.runId]),
            [["combat-e-1", "mission-run-0001"], ["combat-e-1", "mission-run-0002"]],
        );
        removeClaim("Rill", "combat-e-1", "mission-run-0001", storage);
        assert.deepEqual(readClaimOutbox("Rill", storage).map((entry) => entry.runId), ["mission-run-0002"]);
    });

    it("quarantines missionId-only v1 entries and prunes expired rows", () => {
        const storage = fakeStorage();
        storage.setItem("combatClaimOutbox.v1:rill", JSON.stringify([{ missionId: "legacy", addedAt: Date.now() }]));
        storage.setItem("combatClaimOutbox.v2:rill", JSON.stringify([
            { missionId: "stale", runId: "mission-run-stale", addedAt: Date.now() - CLAIM_OUTBOX_MAX_AGE_MS - 1_000 },
            { missionId: "fresh", runId: "mission-run-fresh", addedAt: Date.now() },
        ]));
        assert.deepEqual(readClaimOutbox("Rill", storage).map((entry) => entry.missionId), ["fresh"]);
        assert.equal(storage.getItem("combatClaimOutbox.v1:rill"), null);
    });

    it("removes accepted and terminal rows but keeps queued:false retryable outcomes", async () => {
        const storage = fakeStorage();
        enqueueClaim("Rill", "acked", "mission-run-acked", storage);
        enqueueClaim("Rill", "pending", "mission-run-pending", storage);
        enqueueClaim("Rill", "expired", "mission-run-expired", storage);
        const snapshot = await flushClaimOutbox("Rill", storage, async (_player, missionId) => {
            if (missionId === "acked") return accepted(42);
            if (missionId === "expired") return { queued: false, disposition: "terminal" as const, reason: "expired" };
            return { queued: false, disposition: "retryable" as const, reason: "not-complete" };
        });
        assert.equal(snapshot?.saveVersion, 42);
        assert.equal(snapshot?.character.name, "Rill");
        assert.deepEqual(readClaimOutbox("Rill", storage).map((entry) => entry.runId), ["mission-run-pending"]);
    });

    it("tolerates corrupt storage", () => {
        const storage = fakeStorage();
        storage.setItem("combatClaimOutbox.v2:rill", "{not json");
        assert.deepEqual(readClaimOutbox("Rill", storage), []);
        enqueueClaim("Rill", "combat-e-1", "mission-run-0001", storage);
        assert.equal(readClaimOutbox("Rill", storage).length, 1);
    });
});
