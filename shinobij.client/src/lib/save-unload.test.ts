import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSaveConflictRevision, type SaveConflictDraft, type SaveConflictRevision } from "./save-conflict";
import { protectSaveOnUnload } from "./save-unload";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("save unload protection", () => {
    for (const [label, text] of [["large ASCII", "a".repeat(70_000)], ["multibyte text", "旅".repeat(25_000)]]) {
        it(`preserves the complete ${label} save locally when it exceeds the keepalive byte budget`, () => {
            let captured: unknown;
            let requests = 0;
            const payload = { character: { name: "Kaya", nindo: text } };
            protectSaveOnUnload({
                dirty: true, flightBusy: false, accountKey: "kaya", sessionEpoch: 1, latestVersion: 2,
                unresolved: null, liveSnapshot: { name: "Kaya", revision: 1, payload },
                captureConflict: (accountName, body) => {
                    captured = body;
                    return { accountName, accountKey: "kaya", revisions: [createSaveConflictRevision({ id: "guard", accountName, payload: body })] };
                },
                discardRevision: () => assert.fail("the recovery copy must remain"), isCurrentSession: () => true,
                request: (async () => { requests++; return new Response(); }) as typeof fetch,
            });
            assert.deepEqual(captured, { ...payload, _baseSaveVersion: 2 });
            assert.equal(requests, 0);
        });
    }

    it("checks the exact unresolved wire body before attempting keepalive", () => {
        let captures = 0;
        const body = { character: { name: "Kaya" }, _baseSaveVersion: 2 };
        const revision = createSaveConflictRevision({ id: "guard", accountName: "Kaya", payload: body });
        protectSaveOnUnload({
            dirty: false, flightBusy: true, accountKey: "kaya", sessionEpoch: 1, latestVersion: 3,
            unresolved: { accountName: "Kaya", accountKey: "kaya", sessionEpoch: 1, revision: 2, body, serializedBody: " ".repeat(70_000) + JSON.stringify(body) },
            liveSnapshot: { name: "Kaya", revision: 1, payload: body },
            captureConflict: () => { captures++; return { accountName: "Kaya", accountKey: "kaya", revisions: [revision] }; },
            discardRevision: () => assert.fail("the unresolved recovery copy must remain"), isCurrentSession: () => true,
            request: (() => { assert.fail("oversized wire bodies cannot be sent as keepalive"); }) as typeof fetch,
        });
        assert.equal(captures, 1);
    });

    it("protects and resends the exact unresolved required body over a stale live snapshot", async () => {
        const captures: unknown[] = [];
        const discards: SaveConflictRevision[] = [];
        let sent = "";
        const captureConflict = (accountName: string, payload: unknown): SaveConflictDraft => {
            captures.push(payload);
            const revision = createSaveConflictRevision({ id: "guard", accountName, payload });
            return { accountName, accountKey: revision.accountKey, revisions: [revision] };
        };
        protectSaveOnUnload({
            dirty: false,
            flightBusy: true,
            accountKey: "kaya",
            sessionEpoch: 4,
            latestVersion: 8,
            unresolved: {
                accountName: "Kaya",
                accountKey: "kaya",
                sessionEpoch: 4,
                revision: 12,
                body: { character: { name: "Kaya", level: 12 }, _baseSaveVersion: 8 },
                serializedBody: '{"character":{"name":"Kaya","level":12},"_baseSaveVersion":8}',
            },
            liveSnapshot: { name: "Kaya", revision: 11, payload: { character: { name: "Kaya", level: 11 } } },
            captureConflict,
            discardRevision: (revision) => discards.push(revision),
            isCurrentSession: () => true,
            request: (async (_input, init) => {
                sent = String(init?.body);
                return new Response(JSON.stringify({ persisted: true, _saveVersion: 9 }), { status: 200 });
            }) as typeof fetch,
        });
        assert.equal((captures[0] as { character: { level: number } }).character.level, 12);
        assert.equal(JSON.parse(sent).character.level, 12);
        await tick();
        assert.equal(discards.length, 1);
    });

    it("ignores unresolved work from a retired account epoch", () => {
        let calls = 0;
        protectSaveOnUnload({
            dirty: false,
            flightBusy: false,
            accountKey: "ren",
            sessionEpoch: 5,
            latestVersion: 2,
            unresolved: { accountName: "Kaya", accountKey: "kaya", sessionEpoch: 4, revision: 12, body: {}, serializedBody: "{}" },
            liveSnapshot: null,
            captureConflict: () => { calls += 1; throw new Error("unreachable"); },
            discardRevision: () => undefined,
            isCurrentSession: () => true,
            request: (async () => { calls += 1; return new Response(); }) as typeof fetch,
        });
        assert.equal(calls, 0);
    });

    it("retains the durable guard when a successful HTTP response is unverifiable", async () => {
        let discarded = false;
        const revision = createSaveConflictRevision({ id: "guard", accountName: "Kaya", payload: { character: { name: "Kaya" } } });
        protectSaveOnUnload({
            dirty: true, flightBusy: false, accountKey: "kaya", sessionEpoch: 1, latestVersion: 2,
            unresolved: null, liveSnapshot: { name: "Kaya", revision: 1, payload: { character: { name: "Kaya" } } },
            captureConflict: () => ({ accountName: "Kaya", accountKey: "kaya", revisions: [revision] }),
            discardRevision: () => { discarded = true; }, isCurrentSession: () => true,
            request: (async () => new Response("", { status: 200 })) as typeof fetch,
        });
        await tick();
        assert.equal(discarded, false);
    });

    it("captures a durable local guard but suppresses the network write while mutations are paused", async () => {
        let captures = 0;
        let requests = 0;
        const revision = createSaveConflictRevision({ id: "guard", accountName: "Kaya", payload: { character: { name: "Kaya" } } });
        protectSaveOnUnload({
            dirty: true, flightBusy: false, accountKey: "kaya", sessionEpoch: 1, latestVersion: 2,
            unresolved: null, liveSnapshot: { name: "Kaya", revision: 1, payload: { character: { name: "Kaya" } } },
            captureConflict: () => {
                captures += 1;
                return { accountName: "Kaya", accountKey: "kaya", revisions: [revision] };
            },
            discardRevision: () => undefined,
            isCurrentSession: () => true,
            send: false,
            request: (async () => {
                requests += 1;
                return new Response();
            }) as typeof fetch,
        });
        await tick();
        assert.equal(captures, 1);
        assert.equal(requests, 0);
    });
});
