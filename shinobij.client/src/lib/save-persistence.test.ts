import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSaveConflictRevision, saveConflictAccountKey, type SaveConflictDraft } from "./save-conflict";
import { SAVE_FAILURE_BANNER_THRESHOLD, createSaveFlightCoordinator, type SaveFlightCoordinator } from "./save-flight";
import { createSavePersistence, SaveConflictError } from "./save-persistence";

type Payload = {
    character: { name: string; level: number };
    currentBiome?: string;
    _saveVersion?: number;
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

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function harness(options?: {
    flight?: SaveFlightCoordinator;
    latestVersion?: number;
    payloadRevision?: number;
    dirty?: boolean;
    failureCount?: number;
}) {
    const latestVersion = { current: options?.latestVersion ?? 5 };
    const latestPayloadRevision = { current: options?.payloadRevision ?? 1 };
    const dirty = { current: options?.dirty ?? false };
    const failureCount = { current: options?.failureCount ?? 0 };
    const state = {
        accountKey: saveConflictAccountKey("Kaya"),
        epoch: 1,
    };
    const events: string[] = [];
    const captured: Array<{ accountName: string; payload: unknown }> = [];
    const applied: Payload[] = [];
    const previews: Array<{ accountName: string; payload: unknown }> = [];
    const blocked: boolean[] = [];
    let allowApply = true;

    const persistence = createSavePersistence<Payload>({
        flight: options?.flight ?? createSaveFlightCoordinator(),
        latestVersion,
        latestPayloadRevision,
        dirty,
        failureCount,
        isCurrentSession: (accountKey, epoch) => accountKey === state.accountKey && epoch === state.epoch,
        currentSessionEpoch: () => state.epoch,
        captureConflict: (accountName, payload): SaveConflictDraft => {
            events.push("capture");
            captured.push({ accountName, payload });
            const revision = createSaveConflictRevision({ id: `revision-${captured.length}`, accountName, payload });
            return { accountName, accountKey: revision.accountKey, revisions: [revision] };
        },
        currentSnapshot: () => options?.payloadRevision === undefined ? null : {
            name: "Kaya",
            payload: { character: { name: "Kaya", level: 41 }, currentBiome: "coast" },
            revision: latestPayloadRevision.current,
        },
        installSnapshot: () => undefined,
        onConflictSnapshot: (snapshot, submittedRevision) => {
            events.push("apply");
            if (latestPayloadRevision.current <= submittedRevision) applied.push(snapshot);
            else dirty.current = true;
            return allowApply;
        },
        writePreview: (accountName, payload) => previews.push({ accountName, payload }),
        setBlocked: (value) => blocked.push(value),
    });

    return {
        persistence,
        latestVersion,
        latestPayloadRevision,
        dirty,
        failureCount,
        state,
        events,
        captured,
        applied,
        previews,
        blocked,
        rejectSnapshots: () => { allowApply = false; },
    };
}

const snapshot = (revision = 1) => ({
    name: "Kaya",
    payload: { character: { name: "Kaya", level: 8 }, currentBiome: "central" } satisfies Payload,
    revision,
});

const requiredSave = (overrides?: Partial<{
    payload: Payload;
    revision: number;
    echoVersion: boolean;
    isStillCurrent: () => boolean;
    onCommitted: () => void;
}>) => ({
    name: "Kaya",
    payload: overrides?.payload ?? ({ character: { name: "Kaya", level: 8 }, currentBiome: "central" } satisfies Payload),
    revision: overrides?.revision ?? 1,
    echoVersion: overrides?.echoVersion ?? true,
    isStillCurrent: overrides?.isStillCurrent ?? (() => true),
    onCommitted: overrides?.onCommitted ?? (() => undefined),
});

describe("extracted save persistence", () => {
    it("captures a 409 body before coalesced authoritative recovery", async () => {
        const h = harness({ latestVersion: 5, payloadRevision: 7 });
        let postedBody: Record<string, unknown> | null = null;
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === "POST") {
                h.events.push("post");
                postedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
                return jsonResponse(409, { error: "save-version-conflict" });
            }
            h.events.push("get");
            return jsonResponse(200, { character: { name: "Kaya", level: 9 }, currentBiome: "coast", _saveVersion: 6 });
        }) as typeof fetch;

        const result = await h.persistence.persistAutosave(snapshot(7));
        assert.deepEqual(result, { status: "completed", value: undefined });
        assert.deepEqual(h.events, ["post", "capture", "get", "apply"]);
        assert.equal(postedBody?._baseSaveVersion, 5);
        assert.deepEqual(h.captured[0].payload, postedBody, "the protected draft is the exact rejected POST body");
        assert.equal(h.latestVersion.current, 6);
        assert.equal(h.applied[0]._saveVersion, 6);
    });

    it("does not repaint or clear a newer local revision when an older autosave gets a 409", async () => {
        const h = harness({
            latestVersion: 5,
            payloadRevision: 40,
            dirty: false,
        });
        const postStarted = deferred<void>();
        const postResponse = deferred<Response>();
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === "POST") {
                postStarted.resolve();
                return postResponse.promise;
            }
            return jsonResponse(200, {
                character: { name: "Kaya", level: 8 },
                currentBiome: "central",
                _saveVersion: 6,
            });
        }) as typeof fetch;

        const olderWrite = h.persistence.persistAutosave(snapshot(40));
        await postStarted.promise;

        // The player changes another full-payload field while revision 40 is in
        // flight. App has already optimistically cleared dirty for that request;
        // the edit re-arms it and advances the canonical payload revision.
        h.latestPayloadRevision.current = 41;
        h.dirty.current = true;
        postResponse.resolve(jsonResponse(409, { error: "save-version-conflict" }));

        await olderWrite;
        assert.equal(h.latestVersion.current, 6, "the retry still needs the newly authoritative base version");
        assert.equal(h.applied.length, 0, "revision 40 recovery must not repaint over live revision 41");
        assert.equal(h.dirty.current, true, "the newer local revision must remain scheduled for persistence");
        assert.equal(
            ((h.captured[0]?.payload as { character?: { level?: number } }).character?.level),
            8,
            "the exact rejected revision remains protected separately",
        );
        assert.ok(h.captured.length >= 2, "the newer local branch is captured again at install time");
        assert.ok(h.captured.slice(1).some(({ payload }) => ((payload as { character?: { level?: number } }).character?.level) === 41));
    });

    it("single-flights concurrent conflict GETs and lets waiters join", async () => {
        const h = harness();
        const responseGate = deferred<Response>();
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            if (calls === 1) return responseGate.promise;
            return jsonResponse(200, { character: { name: "Kaya", level: 10 }, _saveVersion: 7 });
        }) as typeof fetch;

        const first = h.persistence.refetchAfterConflict("Kaya");
        const second = h.persistence.refetchAfterConflict("KAYA");
        let waiterSettled = false;
        const waiter = h.persistence.waitForConflict(saveConflictAccountKey("Kaya"))
            .finally(() => { waiterSettled = true; });
        await Promise.resolve();
        assert.equal(calls, 1);
        assert.equal(waiterSettled, false);

        responseGate.resolve(jsonResponse(200, { character: { name: "Kaya", level: 9 }, _saveVersion: 6 }));
        assert.deepEqual(await Promise.all([first, second]), [true, true]);
        await waiter;
        assert.equal(waiterSettled, true);
        assert.equal(h.applied.length, 1, "joined callers must not paint the snapshot twice");

        assert.equal(await h.persistence.refetchAfterConflict("Kaya"), true);
        assert.equal(calls, 2, "the completed flight is removed so a later conflict can refresh again");
    });

    it("rejects stale authoritative conflict snapshots without repainting", async () => {
        const h = harness({ latestVersion: 9 });
        globalThis.fetch = (async () => jsonResponse(200, {
            character: { name: "Kaya", level: 2 },
            _saveVersion: 8,
        })) as typeof fetch;

        assert.equal(await h.persistence.refetchAfterConflict("Kaya"), false);
        assert.equal(h.latestVersion.current, 9);
        assert.equal(h.applied.length, 0);
    });

    it("does not adopt or paint a conflict response after the account epoch changes", async () => {
        const h = harness({ latestVersion: 5 });
        const jsonGate = deferred<Payload>();
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: () => jsonGate.promise,
        } as Response)) as typeof fetch;

        const recovery = h.persistence.refetchAfterConflict("Kaya");
        await Promise.resolve();
        h.state.accountKey = saveConflictAccountKey("Ren");
        h.state.epoch += 1;
        h.rejectSnapshots();
        jsonGate.resolve({ character: { name: "Kaya", level: 99 }, _saveVersion: 50 });

        assert.equal(await recovery, false);
        assert.equal(h.latestVersion.current, 5, "a former account must not advance the new account's version ref");
        assert.equal(h.applied.length, 0, "a former account must never reach the snapshot painter");
    });

    it("does not adopt an autosave acknowledgement after the account epoch changes during JSON", async () => {
        const h = harness({ latestVersion: 5 });
        const jsonGate = deferred<{ persisted: true; _saveVersion: number }>();
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: () => jsonGate.promise,
        } as Response)) as typeof fetch;

        const write = h.persistence.persistAutosave(snapshot());
        await Promise.resolve();
        h.state.accountKey = saveConflictAccountKey("Ren");
        h.state.epoch += 1;
        jsonGate.resolve({ persisted: true, _saveVersion: 50 });

        assert.deepEqual(await write, { status: "completed", value: undefined });
        assert.equal(h.latestVersion.current, 5);
        assert.equal(h.previews.length, 0);
        assert.equal(h.failureCount.current, 0, "a retired session must not poison the new account's failure streak");
    });

    it("does not adopt a required-save acknowledgement after the account epoch changes during JSON", async () => {
        const h = harness({ latestVersion: 5 });
        const jsonGate = deferred<{ persisted: true; _saveVersion: number }>();
        let committed = 0;
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: () => jsonGate.promise,
        } as Response)) as typeof fetch;

        const write = h.persistence.persistRequired(() => requiredSave({ onCommitted: () => { committed += 1; } }));
        await Promise.resolve();
        h.state.accountKey = saveConflictAccountKey("Ren");
        h.state.epoch += 1;
        jsonGate.resolve({ persisted: true, _saveVersion: 50 });

        await assert.rejects(write, /active save account changed/i);
        assert.equal(h.latestVersion.current, 5);
        assert.equal(committed, 0);
        assert.equal(h.dirty.current, false, "a former account cannot mutate the new account's dirty state");
    });

    it("protects a required-save 409 and does not report durable success", async () => {
        const h = harness({ latestVersion: 5 });
        let postedBody: Record<string, unknown> | null = null;
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === "POST") {
                h.events.push("post");
                postedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
                return jsonResponse(409, { error: "save-version-conflict" });
            }
            h.events.push("get");
            return jsonResponse(200, { character: { name: "Kaya", level: 9 }, _saveVersion: 6 });
        }) as typeof fetch;

        let failure: unknown = null;
        try {
            await h.persistence.persistRequired(() => requiredSave());
        } catch (error) {
            failure = error;
        }
        assert.deepEqual(h.events, ["post", "capture", "get", "apply"]);
        assert.equal(postedBody?._baseSaveVersion, 5);
        assert.deepEqual(h.captured[0].payload, postedBody);
        assert.equal(h.latestVersion.current, 6);
        assert.ok(failure instanceof Error, "a conflicted required save must reject instead of resolving as completed");
    });

    it("required saves clear dirty only when the committed full payload is still current", async () => {
        const h = harness({ latestVersion: 10, payloadRevision: 4, dirty: true });
        const acknowledgements = [8, 11, 12];
        globalThis.fetch = (async () => jsonResponse(200, {
            persisted: true,
            _saveVersion: acknowledgements.shift(),
        })) as typeof fetch;
        let committed = 0;

        await h.persistence.persistRequired(() => requiredSave({
            revision: 4,
            onCommitted: () => { committed += 1; },
        }));
        assert.equal(h.latestVersion.current, 10, "an older acknowledgement cannot move authority backwards");
        assert.equal(h.dirty.current, false);
        assert.equal(committed, 1);

        h.dirty.current = true;
        h.latestPayloadRevision.current = 5;
        await h.persistence.persistRequired(() => requiredSave({
            revision: 4,
            onCommitted: () => { committed += 1; },
        }));
        assert.equal(h.latestVersion.current, 11);
        assert.equal(h.dirty.current, true, "a newer local payload must remain scheduled");
        assert.equal(committed, 1);

        await h.persistence.persistRequired(() => requiredSave({
            revision: 5,
            isStillCurrent: () => false,
            onCommitted: () => { committed += 1; },
        }));
        assert.equal(h.latestVersion.current, 12);
        assert.equal(h.dirty.current, true, "a replaced character object must remain scheduled even at the same revision");
        assert.equal(committed, 1);
    });

    it("prepares a queued required save only when its FIFO turn begins", async () => {
        const flight = createSaveFlightCoordinator();
        const h = harness({ flight, latestVersion: 3 });
        const firstGate = deferred<void>();
        let postedLevel = 0;
        let liveLevel = 4;
        globalThis.fetch = (async (_input, init) => {
            const body = JSON.parse(String(init?.body)) as { character?: { level?: number } };
            postedLevel = Number(body.character?.level ?? 0);
            return jsonResponse(200, { persisted: true, _saveVersion: 4 });
        }) as typeof fetch;

        const first = flight.runRequired(async () => firstGate.promise);
        const queued = h.persistence.persistRequired(() => requiredSave({
            payload: { character: { name: "Kaya", level: liveLevel } },
        }));
        liveLevel = 9;
        firstGate.resolve();

        await first;
        await queued;
        assert.equal(postedLevel, 9, "queued durability boundaries must persist the newest execution-time snapshot");
    });

    it("rejects a queued required save if its account retires before the FIFO turn", async () => {
        const flight = createSaveFlightCoordinator();
        const h = harness({ flight });
        const release = deferred<void>();
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            return jsonResponse(200, { persisted: true, _saveVersion: 6 });
        }) as typeof fetch;

        const blocker = flight.runRequired(async () => release.promise);
        const queued = h.persistence.persistRequired(() => requiredSave());
        h.state.accountKey = saveConflictAccountKey("Ren");
        h.state.epoch += 1;
        release.resolve();

        await blocker;
        await assert.rejects(queued, /active save account changed/i);
        assert.equal(fetchCalls, 0, "retired-account work must be rejected after queue wait and before POST");
    });

    it("retires a queued required payload after a 409 changes authority generation", async () => {
        const flight = createSaveFlightCoordinator();
        const h = harness({ flight, latestVersion: 5, payloadRevision: 1 });
        const firstPostStarted = deferred<void>();
        const firstPostResponse = deferred<Response>();
        const postedBodies: Array<{ character?: { level?: number }; _baseSaveVersion?: number }> = [];
        let liveLevel = 8;
        let prepareCalls = 0;

        globalThis.fetch = (async (_input, init) => {
            if (init?.method === "POST") {
                postedBodies.push(JSON.parse(String(init.body)) as typeof postedBodies[number]);
                if (postedBodies.length === 1) {
                    firstPostStarted.resolve();
                    return firstPostResponse.promise;
                }
                return jsonResponse(200, { persisted: true, _saveVersion: 7 });
            }
            return jsonResponse(200, {
                character: { name: "Kaya", level: 9 },
                currentBiome: "central",
                _saveVersion: 6,
            });
        }) as typeof fetch;

        const conflictedAutosave = h.persistence.persistAutosave(snapshot(1));
        await firstPostStarted.promise;
        const queuedRequired = h.persistence.persistRequired(() => {
            prepareCalls += 1;
            return requiredSave({
                payload: { character: { name: "Kaya", level: liveLevel }, currentBiome: "coast" },
            });
        });
        assert.equal(prepareCalls, 0, "a queued required save must not snapshot before its FIFO turn");

        liveLevel = 12;
        firstPostResponse.resolve(jsonResponse(409, { error: "save-version-conflict" }));
        await conflictedAutosave;
        await assert.rejects(queuedRequired, SaveConflictError);

        assert.equal(prepareCalls, 0, "invalidated work must be rejected before it can snapshot or POST");
        assert.deepEqual(postedBodies.map((body) => ({
            level: body.character?.level,
            base: body._baseSaveVersion,
        })), [
            { level: 8, base: 5 },
        ], "pre-conflict queued work must never be silently rebased over newly authoritative progress");
        assert.equal(h.latestVersion.current, 6);
    });

    it("retires required work queued while conflict authority is being fetched", async () => {
        const flight = createSaveFlightCoordinator();
        const h = harness({ flight, latestVersion: 5 });
        const getStarted = deferred<void>();
        const getResponse = deferred<Response>();
        let postCalls = 0;
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === "POST") {
                postCalls += 1;
                return jsonResponse(409, { error: "save-version-conflict" });
            }
            getStarted.resolve();
            return getResponse.promise;
        }) as typeof fetch;

        const conflicted = h.persistence.persistAutosave(snapshot());
        await getStarted.promise;
        const queuedDuringRecovery = h.persistence.persistRequired(() => requiredSave());
        getResponse.resolve(jsonResponse(200, { character: { name: "Kaya", level: 9 }, _saveVersion: 6 }));

        await conflicted;
        await assert.rejects(queuedDuringRecovery, SaveConflictError);
        assert.equal(postCalls, 1, "work admitted during conflict recovery must be fenced before it can overwrite authority");
    });

    it("retires captured required work when an external authoritative snapshot lands", async () => {
        const flight = createSaveFlightCoordinator();
        const h = harness({ flight });
        const release = deferred<void>();
        let posts = 0;
        globalThis.fetch = (async () => { posts += 1; return jsonResponse(200, { persisted: true, _saveVersion: 6 }); }) as typeof fetch;
        const blocker = flight.runRequired(async () => release.promise);
        const queued = h.persistence.persistRequired(() => requiredSave());
        h.persistence.invalidateAuthority();
        release.resolve();
        await blocker;
        await assert.rejects(queued, SaveConflictError);
        assert.equal(posts, 0);
    });

    it("re-arms dirty when a disposable autosave is deferred", async () => {
        const flight = createSaveFlightCoordinator();
        const release = deferred<void>();
        const required = flight.runRequired(async () => { await release.promise; });
        const h = harness({ flight });
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            return jsonResponse(200, { _saveVersion: 6 });
        }) as typeof fetch;

        assert.deepEqual(await h.persistence.persistAutosave(snapshot()), { status: "deferred" });
        assert.equal(fetchCalls, 0, "a stale deferred body must never be posted later");
        assert.equal(h.dirty.current, true, "the next autosave tick must capture current state");
        release.resolve();
        await required;
    });

    it("adopts acknowledgements monotonically and previews only the current payload revision", async () => {
        const h = harness({ latestVersion: 10, payloadRevision: 4, failureCount: 1 });
        const acknowledgements = [8, 11];
        globalThis.fetch = (async () => jsonResponse(200, {
            persisted: true,
            _saveVersion: acknowledgements.shift(),
        })) as typeof fetch;

        await h.persistence.persistAutosave(snapshot(4));
        assert.equal(h.latestVersion.current, 10, "an older acknowledgement cannot move authority backwards");
        assert.equal(h.previews.length, 1);
        assert.equal((h.previews[0].payload as Payload)._saveVersion, 10);
        assert.equal(h.failureCount.current, 0);
        assert.deepEqual(h.blocked, [false]);

        h.latestPayloadRevision.current = 5;
        await h.persistence.persistAutosave(snapshot(4));
        assert.equal(h.latestVersion.current, 11);
        assert.equal(h.previews.length, 1, "a newer local payload must not be replaced in preview by an older in-flight body");
    });

    it("uses the same failure threshold for HTTP and network rejection", async () => {
        const http = harness();
        globalThis.fetch = (async () => jsonResponse(500, { error: "deploying" })) as typeof fetch;
        for (let attempt = 0; attempt < SAVE_FAILURE_BANNER_THRESHOLD; attempt += 1) {
            await http.persistence.persistAutosave(snapshot());
        }
        assert.equal(http.failureCount.current, SAVE_FAILURE_BANNER_THRESHOLD);
        assert.equal(http.dirty.current, true);
        assert.equal(http.blocked.at(-1), true);

        const network = harness();
        globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
        for (let attempt = 0; attempt < SAVE_FAILURE_BANNER_THRESHOLD; attempt += 1) {
            await network.persistence.persistAutosave(snapshot());
        }
        assert.equal(network.failureCount.current, SAVE_FAILURE_BANNER_THRESHOLD);
        assert.equal(network.dirty.current, true);
        assert.equal(network.blocked.at(-1), true);
    });

    it("treats a 200 persisted:false acknowledgement as a retryable failure", async () => {
        const h = harness({ latestVersion: 4 });
        globalThis.fetch = (async () => jsonResponse(200, {
            persisted: false,
            reason: "reset-lock",
            _saveVersion: 99,
        })) as typeof fetch;

        await h.persistence.persistAutosave(snapshot());
        assert.equal(h.dirty.current, true);
        assert.equal(h.failureCount.current, 1);
        assert.equal(h.latestVersion.current, 4, "a non-persisted response cannot advance the base version");
        assert.equal(h.previews.length, 0);
    });

    it("retains the unresolved journal and retries when a 200 acknowledgement has no valid version", async () => {
        const h = harness({ latestVersion: 4, dirty: false });
        globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
        await h.persistence.persistAutosave(snapshot());
        assert.equal(h.dirty.current, true);
        assert.ok(h.persistence.getUnresolvedPost(), "an unverifiable 200 cannot retire the exact pending body");
        await assert.rejects(h.persistence.persistRequired(() => requiredSave()), /valid authoritative version/i);
        assert.ok(h.persistence.getUnresolvedPost());
        assert.equal(h.latestVersion.current, 4);
    });
});
