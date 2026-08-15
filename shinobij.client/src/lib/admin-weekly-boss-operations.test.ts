import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createAdminWeeklyBossOperationFence,
    persistAdminWeeklyBossOverride,
    spawnAdminWeeklyBoss,
    type AdminWeeklyBossFetch,
} from "./admin-weekly-boss-operations";

function fakeResponse(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

describe("full-admin Weekly Boss operations", () => {
    it("awaits a successful override write before committing the local cache", async () => {
        let release!: (value: ReturnType<typeof fakeResponse>) => void;
        const response = new Promise<ReturnType<typeof fakeResponse>>((resolve) => { release = resolve; });
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const fetcher: AdminWeeklyBossFetch = async (input, init) => {
            calls.push({ input: String(input), init });
            return response;
        };
        const committed: string[] = [];

        const operation = persistAdminWeeklyBossOverride(fetcher, "full-secret", "boss-ai", (aiId) => committed.push(aiId));
        assert.deepEqual(committed, [], "local cache must not move while the server write is pending");
        release(fakeResponse(200, { ok: true }));

        assert.deepEqual(await operation, { ok: true, data: { ok: true } });
        assert.deepEqual(committed, ["boss-ai"]);
        assert.equal(calls[0]?.input, "/api/game-state");
        assert.equal(new Headers(calls[0]?.init?.headers).get("x-admin-password"), "full-secret");
        assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
            kind: "weeklyBossOverride",
            aiId: "boss-ai",
        });
    });

    it("preserves local override state and reports 403/network failures", async () => {
        const committed: string[] = [];
        const forbidden = await persistAdminWeeklyBossOverride(
            async () => fakeResponse(403, { error: "Full admin only." }),
            "content-secret",
            null,
            (aiId) => committed.push(aiId),
        );
        assert.deepEqual(forbidden, { ok: false, error: "Full admin only." });
        assert.deepEqual(committed, []);

        const network = await persistAdminWeeklyBossOverride(
            async () => { throw new Error("connection lost"); },
            "full-secret",
            "replacement-ai",
            (aiId) => committed.push(aiId),
        );
        assert.deepEqual(network, { ok: false, error: "connection lost" });
        assert.deepEqual(committed, []);
    });

    it("retires delayed commits after credential replacement or unmount", async () => {
        const fence = createAdminWeeklyBossOperationFence({
            adminCredential: "full-secret-a",
            adminRole: "full",
        });
        const firstToken = fence.begin();
        assert.ok(firstToken);
        assert.equal(fence.begin(), null, "the mutation fence must be synchronously single-flight");

        let releaseFirst!: (value: ReturnType<typeof fakeResponse>) => void;
        const firstResponse = new Promise<ReturnType<typeof fakeResponse>>((resolve) => { releaseFirst = resolve; });
        const committed: string[] = [];
        const firstOperation = persistAdminWeeklyBossOverride(
            async () => firstResponse,
            firstToken.adminCredential,
            "boss-a",
            (aiId) => {
                if (fence.isCurrent(firstToken)) committed.push(aiId);
            },
        );
        fence.syncContext({ adminCredential: "full-secret-b", adminRole: "full" });
        releaseFirst(fakeResponse(200, { ok: true }));
        assert.equal((await firstOperation).ok, true);
        assert.deepEqual(committed, [], "an old credential's response must not commit into the replacement session");

        const secondToken = fence.begin();
        assert.ok(secondToken);
        let releaseSecond!: (value: ReturnType<typeof fakeResponse>) => void;
        const secondResponse = new Promise<ReturnType<typeof fakeResponse>>((resolve) => { releaseSecond = resolve; });
        const secondOperation = persistAdminWeeklyBossOverride(
            async () => secondResponse,
            secondToken.adminCredential,
            "boss-b",
            (aiId) => {
                if (fence.isCurrent(secondToken)) committed.push(aiId);
            },
        );
        fence.dispose();
        releaseSecond(fakeResponse(200, { ok: true }));
        assert.equal((await secondOperation).ok, true);
        assert.deepEqual(committed, [], "an unmounted panel must not accept a delayed commit");
    });

    it("reports spawn success only for a successful reset response", async () => {
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const fetcher: AdminWeeklyBossFetch = async (input, init) => {
            calls.push({ input: String(input), init });
            return fakeResponse(200, { boss: { bossName: "Ashen Dragon", aiId: "ashen-dragon" } });
        };
        const success = await spawnAdminWeeklyBoss(fetcher, "full-secret");
        assert.equal(success.ok, true);
        assert.equal(calls[0]?.input, "/api/weekly-boss");
        assert.equal(new Headers(calls[0]?.init?.headers).get("x-admin-password"), "full-secret");
        assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { kind: "reset" });

        assert.deepEqual(
            await spawnAdminWeeklyBoss(async () => fakeResponse(403, { error: "Full admin only." }), "content-secret"),
            { ok: false, error: "Full admin only." },
        );
        assert.deepEqual(
            await spawnAdminWeeklyBoss(async () => { throw new Error("offline"); }, "full-secret"),
            { ok: false, error: "offline" },
        );
    });
});
