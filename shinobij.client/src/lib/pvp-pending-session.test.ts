import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    PVP_BROWSER_RECOVERY_TTL_MS,
    decidePvpCreateRecovery,
    readPvpBrowserBreadcrumb,
} from "./pvp-pending-session";
// The network half moved to pvp-pending-fetch so the startup graph stops
// carrying PvP recovery; the breadcrumb reader above stays on the boot path.
import {
    contextFromPendingPvpSession,
    fetchPendingPvpRecovery,
    fetchPendingPvpRecoveryWithRetry,
} from "./pvp-pending-fetch";
import { createPvpSessionWithRecovery } from "./pvp-session-create";
import type { PvpSessionState } from "../types/pvp-ui";

function session(overrides: Partial<PvpSessionState> = {}): PvpSessionState {
    return {
        battleId: "pvp-recover",
        stateRevision: 4,
        p1: { name: "Alice", hp: 1, maxHp: 1, chakra: 1, maxChakra: 1, stamina: 1, maxStamina: 1, shield: 0, statuses: [], character: {}, pos: 0 },
        p2: { name: "Bob", hp: 0, maxHp: 1, chakra: 1, maxChakra: 1, stamina: 1, maxStamina: 1, shield: 0, statuses: [], character: {}, pos: 1 },
        round: 2,
        activePlayer: "p1",
        ap: { p1: 0, p2: 0 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        status: "done",
        winner: "p1",
        ...overrides,
    };
}

describe("pending PvP browser recovery", () => {
    it("keeps lost create responses routed and adopts a published pending pointer", () => {
        const pending = {
            battleId: "pvp-published",
            role: "p1" as const,
            session: session({ battleId: "pvp-published" }),
            context: { mode: "standard" as const },
        };
        assert.deepEqual(decidePvpCreateRecovery({
            pending,
            createRejected: true,
            recoveryChecked: true,
            stableBattleId: "pvp-stable",
        }), { kind: "pending", pending });
        assert.deepEqual(decidePvpCreateRecovery({
            pending: null,
            createRejected: false,
            recoveryChecked: false,
            stableBattleId: " pvp-stable ",
        }), { kind: "stable-id", battleId: "pvp-stable" });
        assert.deepEqual(decidePvpCreateRecovery({
            pending: null,
            createRejected: true,
            recoveryChecked: true,
            stableBattleId: "pvp-rejected",
        }), { kind: "clear" });
    });

    it("retains a matching breadcrumb for the full server recovery horizon", () => {
        const now = 1_000_000_000;
        let removed = false;
        const storage = {
            getItem: () => JSON.stringify({ owner: "alice", pvpBattleId: "pvp-x", pvpRole: "p1", savedAt: now - PVP_BROWSER_RECOVERY_TTL_MS + 1 }),
            removeItem: () => { removed = true; },
        };
        assert.equal(readPvpBrowserBreadcrumb(storage, "pvp", "alice", now)?.pvpBattleId, "pvp-x");
        assert.equal(removed, false);
    });

    it("fails closed without depending on writable browser storage", () => {
        const storage = {
            getItem: () => { throw new Error("private mode"); },
            removeItem: () => { throw new Error("private mode"); },
        };
        assert.equal(readPvpBrowserBreadcrumb(storage, "pvp", "alice"), null);
    });

    it("derives world attacker role and clan/ranked modes only from the sealed session", () => {
        assert.deepEqual(contextFromPendingPvpSession(session({
            rewardAuthority: "world",
            worldAttacker: { side: "p1", name: "Alice" },
            rewardSector: 44,
        }), "p2"), {
            mode: "standard",
            sectorAttack: true,
            raidKind: "defense",
            sector: 44,
        });
        assert.equal(contextFromPendingPvpSession(session({ clanWarChallengeId: "cw-1" }), "p1").mode, "clanWar1v1");
        assert.equal(contextFromPendingPvpSession(session({ ranked: true }), "p1").mode, "ranked");
    });

    it("recovers from the authenticated server pointer when local storage is absent", async () => {
        const sealed = session();
        const fetchFn = (async () => new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 })) as typeof fetch;
        const recovered = await fetchPendingPvpRecovery(fetchFn, "Alice");
        assert.equal(recovered?.battleId, sealed.battleId);
        assert.equal(recovered?.role, "p1");
    });

    it("routes the recovered body through the same structural parser as live frames", async () => {
        const malformed = { ...session(), p1: { name: "Alice" } };
        const fetchFn = (async () => new Response(JSON.stringify({
            battleId: malformed.battleId,
            role: "p1",
            session: malformed,
        }), { status: 200 })) as typeof fetch;
        await assert.rejects(
            fetchPendingPvpRecovery(fetchFn, "Alice"),
            /malformed authority/,
        );
    });

    it("reuses one stable create body across retry and adopts the authoritative response", async () => {
        const sealed = session({ battleId: "pvp-stable" });
        const bodies: string[] = [];
        let calls = 0;
        const fetchFn = (async (input, init) => {
            assert.equal(String(input), "/api/pvp/session");
            bodies.push(String(init?.body ?? ""));
            calls += 1;
            if (calls === 1) return new Response(JSON.stringify({ error: "publication pending" }), { status: 503 });
            return new Response(JSON.stringify({ battleId: sealed.battleId, session: sealed }), { status: 200 });
        }) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Alice",
            JSON.stringify({ battleId: sealed.battleId, p1Character: { name: "Alice" }, p2Character: { name: "Bob" } }),
            { wait: async () => {} },
        );
        assert.equal(result.kind, "created");
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0], bodies[1]);
    });

    it("adopts the authenticated pending pointer after a lost create acknowledgement", async () => {
        const sealed = session({ battleId: "pvp-lost-ack" });
        let calls = 0;
        const fetchFn = (async (input) => {
            calls += 1;
            if (String(input) === "/api/pvp/session") throw new TypeError("network reset");
            return new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 });
        }) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Alice",
            JSON.stringify({ battleId: sealed.battleId }),
            { attempts: 1 },
        );
        assert.equal(result.kind, "created");
        assert.equal(calls, 2);
    });

    it("converges two Clan War creators onto an explicitly authenticated canonical battle", async () => {
        const canonical = session({
            battleId: "pvp-canonical",
            rewardAuthority: "clan-war",
            clanWarId: "war-1",
            clanWarChallengeId: "challenge-1",
        });
        const fetchFn = (async () => new Response(JSON.stringify({
            battleId: canonical.battleId,
            session: canonical,
            canonicalResume: true,
        }), { status: 200 })) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Bob",
            JSON.stringify({
                battleId: "pvp-local-loser",
                clanWarId: "war-1",
                clanWarChallengeId: "challenge-1",
                p1Character: { name: "Alice" },
                p2Character: { name: "Bob" },
            }),
        );
        assert.equal(result.kind, "created");
        if (result.kind === "created") {
            assert.equal(result.battleId, canonical.battleId);
            assert.equal(result.canonicalResume, true);
        }
    });

    it("rejects a different battle id without exact Clan War canonical-resume authority", async () => {
        const unrelated = session({ battleId: "pvp-unrelated", rewardAuthority: "challenge" });
        const fetchFn = (async (input) => String(input) === "/api/pvp/session"
            ? new Response(JSON.stringify({
                battleId: unrelated.battleId,
                session: unrelated,
                canonicalResume: true,
            }), { status: 200 })
            : new Response(null, { status: 404 })) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Bob",
            JSON.stringify({
                battleId: "pvp-local",
                clanWarId: "war-1",
                clanWarChallengeId: "challenge-1",
                p1Character: { name: "Alice" },
                p2Character: { name: "Bob" },
            }),
            { attempts: 1 },
        );
        assert.equal(result.kind, "ambiguous");
    });

    it("treats a post-commit request timeout as ambiguous and recovers with a fresh signal", async () => {
        const sealed = session({ battleId: "pvp-timeout-ack" });
        let createCalls = 0;
        const fetchFn = (async (input, init) => {
            if (String(input) !== "/api/pvp/session") {
                return new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 });
            }
            createCalls += 1;
            // The module under test times out via `AbortSignal.timeout()`, whose timer is
            // UNREF'd and so cannot hold the event loop open by itself. This promise settles
            // ONLY on that abort, so without a ref'd timer the loop can drain first and the
            // promise never settles — node:test then reports "Promise resolution is still
            // pending but the event loop has already resolved" and cancels the rest of the
            // suite. That is a race, not a rule: it passed on Node 24 and cancelled 7 tests
            // on CI's Node 22. The interval only keeps the loop alive; the abort still comes
            // from the real timeout, so what this test asserts is unchanged.
            const keepLoopAlive = setInterval(() => {}, 1_000);
            return await new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    clearInterval(keepLoopAlive);
                    reject(new DOMException("timed out", "AbortError"));
                }, { once: true });
            });
        }) as typeof fetch;
        // AbortSignal.timeout() timers are UNREF'D: they do not hold the event
        // loop open. This request settles only when that abort fires, so without
        // a ref'd handle the loop can drain first and the whole FILE reports
        // 'Promise resolution is still pending' — which is how this suite has been
        // cancelling tests in CI while the job still reported green. Same pattern as
        // save-conflict-restore.test.ts; the interval is what the abort races.
        const keepLoopAlive = setInterval(() => {}, 1_000);
        let result;
        try {
            result = await createPvpSessionWithRecovery(
                fetchFn,
                "Alice",
                JSON.stringify({ battleId: sealed.battleId }),
                { attempts: 1, requestTimeoutMs: 10 },
            );
        } finally {
            clearInterval(keepLoopAlive);
        }
        assert.equal(result.kind, "created");
        assert.equal(createCalls, 1);
    });

    it("treats a 500 after publication as ambiguous and adopts the same pointer", async () => {
        const sealed = session({ battleId: "pvp-proxy-500" });
        const fetchFn = (async (input) => String(input) === "/api/pvp/session"
            ? new Response(JSON.stringify({ error: "proxy failure" }), { status: 500 })
            : new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 })) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Alice",
            JSON.stringify({ battleId: sealed.battleId }),
            { attempts: 1 },
        );
        assert.equal(result.kind, "created");
    });

    it("keeps an ambiguous stable id when both create acknowledgement and pending lookup are offline", async () => {
        const fetchFn = (async () => { throw new TypeError("offline"); }) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Alice",
            JSON.stringify({ battleId: "pvp-offline" }),
            { attempts: 1 },
        );
        assert.deepEqual(result, { kind: "ambiguous", battleId: "pvp-offline", error: "offline" });
    });

    it("rejects a conclusive invalid request only after pending discovery proves no obligation", async () => {
        const fetchFn = (async (input) => String(input) === "/api/pvp/session"
            ? new Response(JSON.stringify({ error: "invalid fighters" }), { status: 400 })
            : new Response(null, { status: 404 })) as typeof fetch;
        const result = await createPvpSessionWithRecovery(
            fetchFn,
            "Alice",
            JSON.stringify({ battleId: "pvp-rejected" }),
        );
        assert.deepEqual(result, { kind: "rejected", error: "invalid fighters" });
    });

    it("drops a delayed response after a same-name account epoch replacement", async () => {
        const sealed = session({ battleId: "pvp-old-epoch" });
        let currentEpoch = true;
        const fetchFn = (async () => {
            currentEpoch = false;
            return new Response(JSON.stringify({ battleId: sealed.battleId, session: sealed }), { status: 200 });
        }) as typeof fetch;
        await assert.rejects(
            createPvpSessionWithRecovery(
                fetchFn,
                "Alice",
                JSON.stringify({ battleId: sealed.battleId }),
                { isCurrent: () => currentEpoch },
            ),
            (error: unknown) => error instanceof DOMException && error.name === "AbortError",
        );
    });

    it("retries private-mode boot discovery until a delayed pointer is published", async () => {
        const sealed = session({ battleId: "pvp-delayed-pointer" });
        let calls = 0;
        const fetchFn = (async () => {
            calls += 1;
            if (calls < 3) return new Response(null, { status: calls === 1 ? 503 : 404 });
            return new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 });
        }) as typeof fetch;
        const recovered = await fetchPendingPvpRecoveryWithRetry(fetchFn, "Alice", {
            wait: async () => {},
        });
        assert.equal(recovered?.battleId, sealed.battleId);
        assert.equal(calls, 3);
    });

    it("times out one hung boot lookup and continues with a fresh attempt", async () => {
        const sealed = session({ battleId: "pvp-after-hang" });
        let calls = 0;
        const fetchFn = (async (_input, init) => {
            calls += 1;
            if (calls === 1) {
                // Ref'd keepalive for the same reason as the create-timeout test above:
                // `AbortSignal.timeout()` is UNREF'd and cannot hold the loop open, and this
                // promise settles only on its abort.
                const keepLoopAlive = setInterval(() => {}, 1_000);
                return await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        clearInterval(keepLoopAlive);
                        reject(new DOMException("timed out", "AbortError"));
                    }, { once: true });
                });
            }
            return new Response(JSON.stringify({ battleId: sealed.battleId, role: "p1", session: sealed }), { status: 200 });
        }) as typeof fetch;
        // AbortSignal.timeout() timers are UNREF'D: they do not hold the event
        // loop open. This request settles only when that abort fires, so without
        // a ref'd handle the loop can drain first and the whole FILE reports
        // 'Promise resolution is still pending' — which is how this suite has been
        // cancelling tests in CI while the job still reported green. Same pattern as
        // save-conflict-restore.test.ts; the interval is what the abort races.
        const keepLoopAlive = setInterval(() => {}, 1_000);
        let recovered;
        try {
            recovered = await fetchPendingPvpRecoveryWithRetry(fetchFn, "Alice", {
                wait: async () => {}, requestTimeoutMs: 10,
            });
        } finally {
            clearInterval(keepLoopAlive);
        }
        assert.equal(recovered?.battleId, sealed.battleId);
        assert.equal(calls, 2);
    });
});
