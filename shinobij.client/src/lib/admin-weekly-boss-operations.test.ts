import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createAdminWeeklyBossResetState,
    createAdminWeeklyBossOperationFence,
    persistAdminWeeklyBossOverride,
    spawnAdminWeeklyBoss,
    type AdminWeeklyBossFetch,
} from "./admin-weekly-boss-operations";

const RESET_B = "11111111-1111-4111-8111-111111111111";
const RESET_C = "22222222-2222-4222-8222-222222222222";

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
            if (init?.method === "GET") {
                return fakeResponse(200, { boss: { spawnId: "current-spawn", bossName: "Moonshadow Oni" } });
            }
            return fakeResponse(200, { boss: { spawnId: RESET_B, bossName: "Ashen Dragon", aiId: "ashen-dragon" } });
        };
        const success = await spawnAdminWeeklyBoss(fetcher, "full-secret", createAdminWeeklyBossResetState(null), () => RESET_B);
        assert.equal(success.ok, true);
        assert.equal(calls[0]?.input, "/api/weekly-boss");
        assert.equal(new Headers(calls[0]?.init?.headers).get("x-admin-password"), "full-secret");
        assert.equal(calls[0]?.init?.method, "GET");
        assert.equal(calls[0]?.init?.cache, "no-store");
        assert.equal(calls[1]?.input, "/api/weekly-boss");
        assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
            kind: "reset",
            expectedSpawnId: "current-spawn",
            requestedSpawnId: RESET_B,
        });

        assert.deepEqual(
            await spawnAdminWeeklyBoss(async (_input, init) => (
                init?.method === "GET"
                    ? fakeResponse(200, { boss: { spawnId: "current-spawn" } })
                    : fakeResponse(403, { error: "Full admin only." })
            ), "content-secret", createAdminWeeklyBossResetState(null), () => RESET_B),
            { ok: false, error: "Full admin only." },
        );
        assert.deepEqual(
            await spawnAdminWeeklyBoss(async () => { throw new Error("offline"); }, "full-secret"),
            { ok: false, error: "offline" },
        );
    });

    it("uses an exact null expectation for first spawn and refuses malformed generation snapshots", async () => {
        const firstSpawnBodies: unknown[] = [];
        const firstSpawn = await spawnAdminWeeklyBoss(async (_input, init) => {
            if (init?.method === "GET") return fakeResponse(200, { boss: null });
            firstSpawnBodies.push(JSON.parse(String(init?.body)));
            return fakeResponse(200, { boss: { spawnId: RESET_B } });
        }, "full-secret", createAdminWeeklyBossResetState(null), () => RESET_B);
        assert.equal(firstSpawn.ok, true);
        assert.deepEqual(firstSpawnBodies, [{ kind: "reset", expectedSpawnId: null, requestedSpawnId: RESET_B }]);

        let postCount = 0;
        const malformed = await spawnAdminWeeklyBoss(async (_input, init) => {
            if (init?.method === "GET") return fakeResponse(200, { boss: { aiId: "legacy-without-public-identity" } });
            postCount += 1;
            return fakeResponse(200, {});
        }, "full-secret", createAdminWeeklyBossResetState(null), () => RESET_B);
        assert.deepEqual(malformed, { ok: false, error: "Weekly Boss spawn identity was missing." });
        assert.equal(postCount, 0, "a reset must never guess the generation when the snapshot is malformed");
    });

    it("persists and replays one reset intent after a lost response before allowing a new spawn", async () => {
        const storageValues = new Map<string, string>();
        const resetState = createAdminWeeklyBossResetState({
            getItem: (key) => storageValues.get(key) ?? null,
            setItem: (key, value) => { storageValues.set(key, value); },
            removeItem: (key) => { storageValues.delete(key); },
        });
        const minted = [RESET_B, RESET_C];
        let currentSpawnId = "spawn-a";
        let loseFirstResponse = true;
        const bodies: Array<Record<string, unknown>> = [];
        let getCount = 0;
        const fetcher: AdminWeeklyBossFetch = async (_input, init) => {
            if (init?.method === "GET") {
                getCount += 1;
                return fakeResponse(200, { boss: { spawnId: currentSpawnId } });
            }
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            bodies.push(body);
            if (body.expectedSpawnId !== currentSpawnId && body.requestedSpawnId !== currentSpawnId) {
                return fakeResponse(409, { error: "stale generation" });
            }
            if (body.requestedSpawnId !== currentSpawnId) currentSpawnId = String(body.requestedSpawnId);
            if (loseFirstResponse) {
                loseFirstResponse = false;
                throw new Error("response lost");
            }
            return fakeResponse(200, { boss: { spawnId: currentSpawnId, bossName: "Recovered Boss" } });
        };
        const mint = () => minted.shift() ?? "";

        const lost = await spawnAdminWeeklyBoss(fetcher, "full-secret", resetState, mint);
        assert.equal(lost.ok, false);
        assert.match(lost.ok ? "" : lost.error, /recover this same reset request/);
        assert.equal(currentSpawnId, RESET_B, "the server committed the first intent");
        assert.equal(getCount, 1);
        assert.equal(storageValues.size, 1, "the uncertain intent survives for retry/reload");

        const replayed = await spawnAdminWeeklyBoss(fetcher, "full-secret", resetState, mint);
        assert.equal(replayed.ok, true);
        assert.equal(currentSpawnId, RESET_B, "the retry must not mint another boss");
        assert.equal(getCount, 1, "an uncertain retry must not fetch a new predecessor");
        assert.deepEqual(bodies[1], bodies[0], "the exact reset payload is replayed");
        assert.equal(storageValues.size, 0);

        const next = await spawnAdminWeeklyBoss(fetcher, "full-secret", resetState, mint);
        assert.equal(next.ok, true);
        assert.equal(currentSpawnId, RESET_C, "a conclusive prior intent permits a deliberate new reset");
        assert.equal(getCount, 2);
        assert.equal(bodies[2]?.expectedSpawnId, RESET_B);
        assert.equal(bodies[2]?.requestedSpawnId, RESET_C);
    });

    it("retains an exact intent across reset-lock contention and retries without a new GET", async () => {
        const storageValues = new Map<string, string>();
        const resetState = createAdminWeeklyBossResetState({
            getItem: (key) => storageValues.get(key) ?? null,
            setItem: (key, value) => { storageValues.set(key, value); },
            removeItem: (key) => { storageValues.delete(key); },
        });
        resetState.retain({ expectedSpawnId: "spawn-a", requestedSpawnId: RESET_B });
        const bodies: unknown[] = [];
        let attempt = 0;
        const fetcher: AdminWeeklyBossFetch = async (_input, init) => {
            assert.equal(init?.method, "POST", "a retained intent must bypass expectation discovery");
            bodies.push(JSON.parse(String(init?.body)));
            attempt += 1;
            return attempt === 1
                ? fakeResponse(409, {
                    error: "Another Weekly Boss reset is already in progress.",
                    code: "weekly-boss-reset-in-progress",
                })
                : fakeResponse(200, { boss: { spawnId: RESET_B, bossName: "Recovered Boss" } });
        };

        const contended = await spawnAdminWeeklyBoss(fetcher, "full-secret", resetState, () => RESET_C);
        assert.equal(contended.ok, false);
        assert.match(contended.ok ? "" : contended.error, /recover this same reset request/);
        assert.equal(storageValues.size, 1, "lock contention cannot retire an uncertain durable intent");

        const replayed = await spawnAdminWeeklyBoss(fetcher, "full-secret", resetState, () => RESET_C);
        assert.equal(replayed.ok, true);
        assert.deepEqual(bodies[1], bodies[0]);
        assert.equal(storageValues.size, 0);
    });
});
