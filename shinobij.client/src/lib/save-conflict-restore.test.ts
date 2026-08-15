import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
    createSaveConflictDraftStore,
    createSaveConflictRevision,
    latestSaveConflictRevision,
    loadSaveOwnershipClassifier,
    type SaveConflictDraft,
    type SaveConflictRevision,
    type SaveConflictStorage,
} from "./save-conflict";
import { restoreSaveConflictRevision } from "./save-conflict-restore";
import type { SaveSnapshot } from "./save-persistence";

type Payload = {
    character: { name: string; level: number };
    currentBiome: string;
};

class MemoryStorage implements SaveConflictStorage {
    readonly values = new Map<string, string>();

    get length(): number { return this.values.size; }
    key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
    removeItem(key: string): void { this.values.delete(key); }
}

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
    // restoreSaveConflictRevision awaits the code-split ownership chunk. Warm it
    // once here so a COLD dynamic import never lands inside a timing-sensitive
    // test — on CI that shifted when the loop had ref'd work and stranded the
    // unref'd AbortSignal.timeout below, cancelling the suite.
    before(async () => { await loadSaveOwnershipClassifier(); });

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

    it("completes the restore when an external write lands between POST and verification GET", async () => {
        // A version PAST the acknowledgement is the normal case, not a failure:
        // the settle-on-read and every server credit endpoint bump it. A later
        // server-owned level is allowed to differ; every recoverable field from
        // our draft is still present, so the revision can be released.
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return jsonResponse(200, {
                character: { name: "Kaya", level: 12 },
                currentBiome: "central",
                _saveVersion: 7,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        const result = await h.restore();
        assert.deepEqual(result.declined, [], "the restored state is live, so nothing was declined");
        assert.equal(calls, 2);
        assert.equal(h.latestVersion.current, 7, "authority must advance to the newest served version");
        assert.deepEqual(h.applied.map((snapshot) => snapshot._saveVersion), [7]);
        assert.deepEqual(h.applied.map((snapshot) => snapshot.character.level), [12]);
        assert.deepEqual(h.discarded.map((revision) => revision.id), [h.selected.id]);
    });

    it("retains the draft when a higher-version interleaving write changes recoverable progress", async () => {
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            // Version 7 could have landed AFTER the restore at version 6. Its
            // client-owned biome no longer matches the selected draft, so version
            // ordering alone cannot prove that the restored progress is live.
            return jsonResponse(200, {
                character: { name: "Kaya", level: 12 },
                currentBiome: "coast",
                _saveVersion: 7,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        await assert.rejects(h.restore(), /newer server save changed recoverable progress/i);
        assert.equal(calls, 2);
        assert.equal(h.latestVersion.current, 7, "the newest authority is still adopted before recovery is offered");
        assert.deepEqual(h.applied.map((snapshot) => snapshot.currentBiome), ["coast"]);
        assert.equal(h.discarded.length, 0, "the selected client-owned revision must remain recoverable");
    });

    it("retains the draft when the read-back is BEHIND the acknowledged version", async () => {
        // The only genuine verification failure: the save being served is older
        // than the write we were just handed, so the restore is not live.
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 9 });
            return jsonResponse(200, {
                character: { name: "Kaya", level: 10 },
                currentBiome: "central",
                _saveVersion: 8,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        await assert.rejects(h.restore(), /could not confirm the restored draft is live/i);
        assert.equal(calls, 2);
        assert.equal(h.discarded.length, 0, "an unconfirmed restore must keep its revision");
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

    it("reports what the server declined instead of failing the restore", async () => {
        let calls = 0;
        const request = (async (_input, init) => {
            calls += 1;
            if (init?.method === "POST") return jsonResponse(200, { persisted: true, _saveVersion: 6 });
            return jsonResponse(200, {
                character: { name: "Kaya", level: 12 },
                currentBiome: "coast",
                _saveVersion: 6,
            });
        }) as typeof fetch;
        const h = createHarness({ request });

        // `level` is server-owned, so it is not reported — the server was always
        // going to keep its own. `currentBiome` is client-owned and did NOT come
        // back as the draft had it, so the player is told about that one.
        const result = await h.restore();
        assert.deepEqual(result.declined, ["Travel & world position"]);
        assert.equal(calls, 2);
        assert.equal(h.latestVersion.current, 6);
        assert.deepEqual(h.applied.map((snapshot) => snapshot.character.level), [12]);
        assert.deepEqual(h.discarded.map((revision) => revision.id), [h.selected.id], "a durable restore is one-shot, never re-offered");
    });

    it("does not resurrect a declined revision when App rehydrates during authoritative apply", async () => {
        const storage = new MemoryStorage();
        let visible: SaveConflictDraft | null = null;
        const store = createSaveConflictDraftStore({
            storage,
            activeAccountKey: () => "kaya",
            onVisibleDraft: (draft) => { visible = draft; },
            reportStorageFailure: assert.fail,
        });
        const draft = store.capture("Kaya", {
            character: { name: "Kaya", level: 10 },
            currentBiome: "central",
        });
        const latestVersion = { current: 5 };
        let rehydrate: Promise<SaveConflictDraft | null> | null = null;
        const request = (async (_input, init) => init?.method === "POST"
            ? jsonResponse(200, { persisted: true, _saveVersion: 6 })
            : jsonResponse(200, {
                character: { name: "Kaya", level: 10 },
                currentBiome: "coast",
                _saveVersion: 6,
            })) as typeof fetch;

        const result = await restoreSaveConflictRevision<Payload>({
            visibleDraft: draft,
            sessionEpoch: 3,
            runExclusive: async <T>(work: () => Promise<T>) => work(),
            isCurrentSession: (accountKey, epoch) => accountKey === "kaya" && epoch === 3,
            loadDraft: store.load,
            latestVersion,
            currentSnapshot: () => ({
                name: "Kaya",
                payload: { character: { name: "Kaya", level: 5 }, currentBiome: "coast" },
                revision: 1,
            }),
            captureConflict: store.capture,
            applySnapshot: (snapshot) => {
                latestVersion.current = snapshot._saveVersion ?? latestVersion.current;
                // Mirrors App.applyServerSnapshot: rehydrate is intentionally
                // fire-and-forget while the restore transaction continues to its
                // confirmed-revision discard.
                rehydrate = store.rehydrate("Kaya", snapshot);
                return true;
            },
            discardRevision: store.discard,
            request,
        });

        assert.deepEqual(result.declined, ["Travel & world position"]);
        assert.ok(rehydrate, "authoritative apply must start conflict rehydration");
        await rehydrate;
        assert.equal(store.load("Kaya"), null, "the confirmed revision must remain one-shot");
        assert.equal(visible, null, "the recovery banner must stay cleared");
        assert.equal(storage.length, 0, "rehydration must not recreate the discarded storage entry");
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

        // AbortSignal.timeout() timers are UNREF'D: they do not hold the event
        // loop open. The verification request here settles only when that abort
        // fires, so without a ref'd handle the loop can drain first and the test
        // hangs as "Promise resolution is still pending". Hold one across the
        // assertion — this is what the abort is racing, not a sleep.
        const keepLoopAlive = setInterval(() => {}, 1_000);
        try {
            await assert.rejects(h.restore(), /timeout/i);
        } finally {
            clearInterval(keepLoopAlive);
        }
        assert.equal(calls, 2);
        assert.equal(signals.length, 2);
        assert.equal(signals[1].aborted, true);
        assert.equal(h.discarded.length, 0);
    });
});
