import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createSaveConflictRevision,
    latestSaveConflictRevision,
    type SaveConflictDraft,
    type SaveConflictRevision,
} from "./save-conflict";
import { restoreSaveConflictRevision } from "./save-conflict-restore";
import type { SaveSnapshot } from "./save-persistence";

type Payload = {
    character: { name: string; level: number };
    currentBiome: string;
};

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function draftWithLevels(...levels: number[]): SaveConflictDraft {
    const accountName = "Kaya";
    return {
        accountName,
        accountKey: "kaya",
        revisions: levels.map((level, index) => createSaveConflictRevision({
            id: `revision-${index + 1}`,
            accountName,
            detectedAt: Date.now() + index,
            payload: { character: { name: accountName, level }, currentBiome: "central" },
        })),
    };
}

function createHarness(options?: {
    draft?: SaveConflictDraft;
    request?: typeof fetch;
    timeoutMs?: number;
}) {
    const draft = options?.draft ?? draftWithLevels(10);
    const selected = latestSaveConflictRevision(draft);
    const state = { accountKey: draft.accountKey, epoch: 3 };
    const latestVersion = { current: 5 };
    let current: SaveSnapshot<Payload> | null = {
        name: draft.accountName,
        payload: { character: { name: draft.accountName, level: 5 }, currentBiome: "central" },
        revision: 1,
    };
    const events: string[] = [];
    const captures: Array<{ accountName: string; payload: unknown }> = [];
    const applied: Array<Payload & { _saveVersion?: number }> = [];
    const discarded: SaveConflictRevision[] = [];
    let requestCalls = 0;

    const defaultRequest = (async (_input, init) => {
        requestCalls += 1;
        if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
        return jsonResponse(200, { ...selected.payload, _saveVersion: 6 });
    }) as typeof fetch;

    const restore = () => restoreSaveConflictRevision<Payload>({
        visibleDraft: draft,
        sessionEpoch: 3,
        runExclusive: async <T>(work: () => Promise<T>) => {
            events.push("exclusive");
            return work();
        },
        isCurrentSession: (accountKey, epoch) => state.accountKey === accountKey && state.epoch === epoch,
        loadDraft: () => draft,
        latestVersion,
        currentSnapshot: () => current,
        captureConflict: (accountName, payload) => {
            events.push("capture");
            captures.push({ accountName, payload });
        },
        applySnapshot: (snapshot) => {
            events.push("apply");
            applied.push(snapshot);
            if (typeof snapshot._saveVersion === "number") latestVersion.current = snapshot._saveVersion;
            return true;
        },
        discardRevision: (revision) => {
            events.push("discard");
            discarded.push(revision);
        },
        request: options?.request ?? defaultRequest,
        timeoutMs: options?.timeoutMs,
    });

    return {
        draft,
        selected,
        state,
        latestVersion,
        events,
        captures,
        applied,
        discarded,
        restore,
        requestCalls: () => requestCalls,
        setCurrent: (snapshot: SaveSnapshot<Payload> | null) => { current = snapshot; },
    };
}

function assertNoAuthoritySideEffects(harness: ReturnType<typeof createHarness>) {
    assert.equal(harness.latestVersion.current, 5);
    assert.equal(harness.captures.length, 0);
    assert.equal(harness.applied.length, 0);
    assert.equal(harness.discarded.length, 0);
}

describe("exclusive save-conflict restore", () => {
    it("requires a positive safe-integer acknowledgement version", async () => {
        for (const invalidVersion of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "6"]) {
            let calls = 0;
            const request = (async () => {
                calls += 1;
                return jsonResponse(200, { persisted: true, _saveVersion: invalidVersion });
            }) as typeof fetch;
            const h = createHarness({ request });

            await assert.rejects(h.restore(), /authoritative save version/i, `version ${String(invalidVersion)} must be rejected`);
            assert.equal(calls, 1, "an invalid acknowledgement must not trigger verification");
            assertNoAuthoritySideEffects(h);
        }
    });

    it("retains the selected draft when an external write lands between POST and verification GET", async () => {
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return jsonResponse(200, {
                character: { name: "Kaya", level: 10 },
                currentBiome: "central",
                _saveVersion: 7,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        await assert.rejects(h.restore(), /server changed before the restored draft could be verified/i);
        assert.equal(calls, 2);
        assert.equal(h.latestVersion.current, 7, "the next retry must use the external write's current base version");
        assert.deepEqual(h.applied.map((snapshot) => snapshot._saveVersion), [7]);
        assert.equal(h.discarded.length, 0, "refreshing authority must retain the selected restore revision");
    });

    it("refreshes authority after a POST 409 so the next retry uses the current base", async () => {
        const postedBases: number[] = [];
        const holder: { harness?: ReturnType<typeof createHarness> } = {};
        let attempt = 0;
        const request = (async (_input, init) => {
            if (init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as { _baseSaveVersion?: number };
                postedBases.push(Number(body._baseSaveVersion));
                attempt += 1;
                return attempt === 1
                    ? jsonResponse(409, { error: "save-version-conflict" })
                    : jsonResponse(200, { persisted: true, _saveVersion: 8 });
            }
            if (attempt === 1) {
                holder.harness!.setCurrent({
                    name: "Kaya",
                    payload: { character: { name: "Kaya", level: 99 }, currentBiome: "coast" },
                    revision: 2,
                });
                return jsonResponse(200, {
                    character: { name: "Kaya", level: 6 },
                    currentBiome: "coast",
                    _saveVersion: 7,
                });
            }
            return jsonResponse(200, {
                character: { name: "Kaya", level: 10 },
                currentBiome: "central",
                _saveVersion: 8,
            });
        }) as typeof fetch;
        const h = createHarness({ request });
        holder.harness = h;

        await assert.rejects(h.restore(), /newest save is now active/i);
        assert.equal(h.latestVersion.current, 7);
        assert.deepEqual(h.applied.map((snapshot) => snapshot._saveVersion), [7]);
        assert.deepEqual(h.captures, [{
            accountName: "Kaya",
            payload: {
                character: { name: "Kaya", level: 99 },
                currentBiome: "coast",
                _baseSaveVersion: 5,
            },
        }], "the live edit must be protected before the 409 refresh paints server authority");
        assert.equal(h.discarded.length, 0);

        await h.restore();
        assert.deepEqual(postedBases, [5, 7], "retry must rebuild the restore body from refreshed authority");
        assert.equal(h.latestVersion.current, 8);
        assert.deepEqual(h.discarded.map((revision) => revision.id), [h.selected.id]);
    });

    it("refreshes the verification mismatch while retaining the selected revision", async () => {
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return jsonResponse(200, {
                character: { name: "Kaya", level: 12 },
                currentBiome: "coast",
                _saveVersion: 7,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        await assert.rejects(h.restore(), /server changed before the restored draft could be verified/i);
        assert.equal(calls, 2);
        assert.equal(h.latestVersion.current, 7);
        assert.deepEqual(h.applied.map((snapshot) => snapshot.character.level), [12]);
        assert.equal(h.discarded.length, 0);
    });

    it("does not adopt a POST-409 refresh after the account epoch changes during JSON", async () => {
        const jsonStarted = deferred<void>();
        const refresh = deferred<unknown>();
        const request = (async (_input, init) => {
            if (init?.method === "POST") return jsonResponse(409, { error: "save-version-conflict" });
            return {
                ok: true,
                status: 200,
                json: () => {
                    jsonStarted.resolve();
                    return refresh.promise;
                },
            } as Response;
        }) as typeof fetch;
        const h = createHarness({ request });

        const restoring = h.restore();
        await jsonStarted.promise;
        h.state.epoch += 1;
        refresh.resolve({
            character: { name: "Kaya", level: 6 },
            currentBiome: "coast",
            _saveVersion: 7,
        });

        await assert.rejects(restoring, /active account changed/i);
        assertNoAuthoritySideEffects(h);
    });

    it("has zero authority side effects when the account epoch changes during POST JSON", async () => {
        const jsonStarted = deferred<void>();
        const acknowledgement = deferred<unknown>();
        let calls = 0;
        const request = (async () => {
            calls += 1;
            return {
                ok: true,
                status: 200,
                json: () => {
                    jsonStarted.resolve();
                    return acknowledgement.promise;
                },
            } as Response;
        }) as typeof fetch;
        const h = createHarness({ request });

        const restoring = h.restore();
        await jsonStarted.promise;
        h.state.epoch += 1;
        acknowledgement.resolve({ persisted: true, _saveVersion: 6 });

        await assert.rejects(restoring, /active account changed/i);
        assert.equal(calls, 1);
        assertNoAuthoritySideEffects(h);
    });

    it("has zero authority side effects when the account epoch changes during verification JSON", async () => {
        const jsonStarted = deferred<void>();
        const verification = deferred<unknown>();
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return {
                ok: true,
                status: 200,
                json: () => {
                    jsonStarted.resolve();
                    return verification.promise;
                },
            } as Response;
        }) as typeof fetch;
        const h = createHarness({ request });

        const restoring = h.restore();
        await jsonStarted.promise;
        h.state.epoch += 1;
        verification.resolve({ ...h.selected.payload, _saveVersion: 6 });

        await assert.rejects(restoring, /active account changed/i);
        assert.equal(calls, 2);
        assertNoAuthoritySideEffects(h);
    });

    it("captures a local edit made during restore before applying the server snapshot", async () => {
        const holder: { harness?: ReturnType<typeof createHarness> } = {};
        const request = (async (_input, init) => {
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            holder.harness!.setCurrent({
                name: "Kaya",
                payload: { character: { name: "Kaya", level: 99 }, currentBiome: "coast" },
                revision: 2,
            });
            return jsonResponse(200, { ...holder.harness!.selected.payload, _saveVersion: 6 });
        }) as typeof fetch;
        const h = createHarness({ request });
        holder.harness = h;

        await h.restore();
        assert.deepEqual(h.events, ["exclusive", "capture", "apply", "discard"]);
        assert.deepEqual(h.captures, [{
            accountName: "Kaya",
            payload: {
                character: { name: "Kaya", level: 99 },
                currentBiome: "coast",
                _baseSaveVersion: 5,
            },
        }]);
    });

    it("discards only the selected revision after an exact verified success", async () => {
        const h = createHarness({ draft: draftWithLevels(7, 10) });

        await h.restore();
        assert.equal(h.latestVersion.current, 6);
        assert.deepEqual(h.discarded.map((revision) => revision.id), [h.selected.id]);
        assert.notEqual(h.discarded[0].id, h.draft.revisions[0].id);
    });

    it("applies the configured timeout to POST and verification requests", async () => {
        const signals: AbortSignal[] = [];
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            assert.ok(init?.signal instanceof AbortSignal);
            signals.push(init.signal);
            if (init.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return new Promise<Response>((_resolve, reject) => {
                const signal = init.signal!;
                if (signal.aborted) reject(signal.reason);
                else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
        }) as typeof fetch;
        const h = createHarness({ request, timeoutMs: 10 });

        await assert.rejects(h.restore(), /timeout/i);
        assert.equal(calls, 2);
        assert.equal(signals.length, 2);
        assert.equal(signals[1].aborted, true);
        assert.equal(h.discarded.length, 0);
    });
});
