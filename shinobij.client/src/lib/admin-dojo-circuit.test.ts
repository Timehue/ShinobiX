import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { persistAdminDojoCircuitEnabled, type AdminDojoCircuitFetch } from "./admin-dojo-circuit";

function response(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

describe("persistAdminDojoCircuitEnabled", () => {
    it("commits only after a full-admin server write succeeds", async () => {
        const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
        let release!: (value: ReturnType<typeof response>) => void;
        const pending = new Promise<ReturnType<typeof response>>((resolve) => { release = resolve; });
        const fetcher: AdminDojoCircuitFetch = async (input, init) => {
            calls.push({ input, init });
            return pending;
        };
        const committed: boolean[] = [];

        const operation = persistAdminDojoCircuitEnabled(fetcher, "full-secret", true, (enabled) => committed.push(enabled));
        assert.deepEqual(committed, []);
        release(response(200, { ok: true, enabled: true }));

        assert.deepEqual(await operation, { ok: true, data: { ok: true, enabled: true } });
        assert.deepEqual(committed, [true]);
        assert.equal(calls[0]?.input, "/api/game-state");
        assert.equal(new Headers(calls[0]?.init?.headers).get("x-admin-password"), "full-secret");
        assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { kind: "dojoCircuitEnabled", enabled: true });
    });

    it("keeps the local state unchanged on a rejected or failed write", async () => {
        const committed: boolean[] = [];
        const forbidden = await persistAdminDojoCircuitEnabled(
            async () => response(403, { error: "Full admin only." }),
            "content-secret",
            false,
            (enabled) => committed.push(enabled),
        );
        assert.deepEqual(forbidden, { ok: false, error: "Full admin only." });

        const unavailable = await persistAdminDojoCircuitEnabled(
            async () => { throw new Error("connection lost"); },
            "full-secret",
            true,
            (enabled) => committed.push(enabled),
        );
        assert.deepEqual(unavailable, { ok: false, error: "connection lost" });
        assert.deepEqual(committed, []);
    });
});
