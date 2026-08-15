import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
    SAVE_FAILURE_BANNER_THRESHOLD,
    createSaveFlightCoordinator,
    createSaveFlightGate,
    isCurrentSavePayloadRevision,
    nextSavePayloadRevision,
} from "./save-flight";

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("autosave single-flight gate", () => {
    it("runs the first save and defers an overlapping one", async () => {
        const gate = createSaveFlightGate();
        let release: (() => void) | null = null;
        const blocked = new Promise<void>((resolve) => { release = resolve; });

        let ran = 0;
        const first = gate.run(async () => { ran++; await blocked; return "committed"; });
        assert.equal(gate.busy(), true, "the gate reports busy while a save is in flight");

        // The overlapping attempt must NOT run: it would POST the same
        // _baseSaveVersion and be rejected 409, whose recovery discards local work.
        assert.equal(await gate.run(async () => { ran++; return "committed"; }), "deferred");
        assert.equal(ran, 1, "only one save body executed");

        release!();
        assert.equal(await first, "committed");
        assert.equal(gate.busy(), false, "the gate frees up once the save settles");
    });

    it("frees the gate when a save throws, so later autosaves still run", async () => {
        const gate = createSaveFlightGate();
        await assert.rejects(gate.run(async () => { throw new Error("network down"); }), /network down/);

        // A stuck flag here would wedge every autosave for the rest of the session —
        // silent, total progress loss rather than one failed write.
        assert.equal(gate.busy(), false);
        assert.equal(await gate.run(async () => "committed"), "committed");
    });

    it("serialises a burst down to one save per settle", async () => {
        const gate = createSaveFlightGate();
        // The three real triggers (3s debounce, 15s interval, immediate flush) can all
        // fire in the same tick.
        const results = await Promise.all([
            gate.run(async () => { await new Promise((r) => setTimeout(r, 5)); return "committed"; }),
            gate.run(async () => "committed"),
            gate.run(async () => "committed"),
        ]);
        assert.deepEqual(results, ["committed", "deferred", "deferred"]);
    });
});

describe("save-flight coordinator", () => {
    it("defers a disposable autosave instead of queueing its stale snapshot", async () => {
        const coordinator = createSaveFlightCoordinator();
        const release = deferred<void>();
        let autosavesRun = 0;

        const required = coordinator.runRequired(async () => {
            await release.promise;
            return "durable";
        });
        assert.equal(coordinator.busy(), true);

        const deferredResult = await coordinator.runAutosave(async () => {
            autosavesRun += 1;
            return "stale";
        });
        assert.deepEqual(deferredResult, { status: "deferred" });
        assert.equal(autosavesRun, 0, "a deferred autosave body must never run later");

        release.resolve();
        assert.deepEqual(await required, { status: "completed", value: "durable" });
        assert.equal(coordinator.busy(), false);
    });

    it("queues a required save behind active work and waits for its own completion", async () => {
        const coordinator = createSaveFlightCoordinator();
        const releaseAutosave = deferred<void>();
        const releaseRequired = deferred<void>();
        const order: string[] = [];

        const autosave = coordinator.runAutosave(async () => {
            order.push("autosave:start");
            await releaseAutosave.promise;
            order.push("autosave:end");
            return "autosaved";
        });
        const required = coordinator.runRequired(async () => {
            order.push("required:start");
            await releaseRequired.promise;
            order.push("required:end");
            return "saved-now";
        });

        assert.deepEqual(order, ["autosave:start"]);
        assert.equal(coordinator.pendingRequired(), 1);
        let requiredSettled = false;
        void required.finally(() => { requiredSettled = true; });

        releaseAutosave.resolve();
        assert.deepEqual(await autosave, { status: "completed", value: "autosaved" });
        assert.deepEqual(order, ["autosave:start", "autosave:end", "required:start"]);
        assert.equal(requiredSettled, false, "required promise must wait for its own write");

        releaseRequired.resolve();
        assert.deepEqual(await required, { status: "completed", value: "saved-now" });
        assert.deepEqual(order, ["autosave:start", "autosave:end", "required:start", "required:end"]);
    });

    it("releases after failure and still runs the next queued required save", async () => {
        const coordinator = createSaveFlightCoordinator();
        const releaseFailure = deferred<void>();
        const order: string[] = [];

        const failed = coordinator.runRequired(async () => {
            order.push("first:start");
            await releaseFailure.promise;
            order.push("first:throw");
            throw new Error("save unavailable");
        });
        const failedAssertion = assert.rejects(failed, /save unavailable/);
        const recovered = coordinator.runRequired(async () => {
            order.push("second:start");
            return "recovered";
        });

        assert.equal(coordinator.pendingRequired(), 1);
        releaseFailure.resolve();
        await failedAssertion;
        assert.deepEqual(await recovered, { status: "completed", value: "recovered" });
        assert.deepEqual(order, ["first:start", "first:throw", "second:start"]);
        assert.equal(coordinator.busy(), false);
    });

    it("serializes multiple required saves in FIFO order", async () => {
        const coordinator = createSaveFlightCoordinator();
        const releases = [deferred<void>(), deferred<void>(), deferred<void>()];
        const order: string[] = [];
        let active = 0;
        let maxActive = 0;

        const saves = releases.map((release, index) => coordinator.runRequired(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            order.push(`${index}:start`);
            await release.promise;
            order.push(`${index}:end`);
            active -= 1;
            return index;
        }));

        assert.deepEqual(order, ["0:start"]);
        assert.equal(coordinator.pendingRequired(), 2);
        releases[0].resolve();
        assert.deepEqual(await saves[0], { status: "completed", value: 0 });
        assert.deepEqual(order, ["0:start", "0:end", "1:start"]);
        releases[1].resolve();
        assert.deepEqual(await saves[1], { status: "completed", value: 1 });
        assert.deepEqual(order, ["0:start", "0:end", "1:start", "1:end", "2:start"]);
        releases[2].resolve();
        assert.deepEqual(await saves[2], { status: "completed", value: 2 });
        assert.equal(maxActive, 1, "required saves must never overlap");
    });
});

describe("full save-payload revision", () => {
    it("detects a non-character payload change during an in-flight write", () => {
        let revision = 0;
        const captured = revision;
        revision = nextSavePayloadRevision(revision); // e.g. mission/biome/travel changed
        assert.equal(isCurrentSavePayloadRevision(captured, revision), false);

        const nextCapture = revision;
        assert.equal(isCurrentSavePayloadRevision(nextCapture, revision), true);
    });

    it("rejects invalid or exhausted revision counters", () => {
        assert.throws(() => nextSavePayloadRevision(-1), /invalid or exhausted/i);
        assert.throws(() => nextSavePayloadRevision(1.5), /invalid or exhausted/i);
        assert.throws(() => nextSavePayloadRevision(Number.MAX_SAFE_INTEGER), /invalid or exhausted/i);
        assert.equal(isCurrentSavePayloadRevision(Number.NaN, Number.NaN), false);
    });
});

describe("save-persistence wiring in App.tsx", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const autosaveSource = readFileSync(new URL("./use-capability-guarded-autosave.ts", import.meta.url), "utf8");

    it("connects extracted autosaves and in-App required saves to one coordinator", () => {
        const initialization = appSource.slice(
            appSource.indexOf("if (!savePersistenceRef.current)"),
            appSource.indexOf("async function downloadLocalConflictDraft"),
        );
        assert.match(initialization, /createSavePersistence\(\{/);
        assert.match(initialization, /flight: saveFlightRef\.current/);
        assert.match(initialization, /dirty: charDirtyRef/);
        assert.match(initialization, /failureCount: saveFailCountRef/);
        assert.match(appSource, /const persistSave = savePersistenceRef\.current\.persistAutosave/);
        assert.match(appSource, /useCapabilityGuardedAutosave\(\{[\s\S]*?persistSave,[\s\S]*?\}\)/,
            "App must delegate every delayed autosave clock to the guarded hook");
        assert.equal((autosaveSource.match(/void persistSave\(snapshot\)/g) ?? []).length, 2,
            "both guarded dirty/flush paths must use the extracted persistence coordinator");
        assert.match(
            appSource,
            /return savePersistenceRef\.current!\.persistRequired\(\(\) => \{/,
            "immediate saves must queue and be awaited rather than bypassing the coordinator",
        );
    });

    it("keeps immediate and mutation-only versions monotonic", () => {
        // A version that can go BACKWARDS guarantees a spurious 409 on the next
        // autosave, and the 409 path applies the server snapshot wholesale.
        assert.match(
            appSource,
            /detail\.source !== "full-save"[\s\S]{0,140}acceptExternalSaveVersion\(version, detail\.accountName\)/,
            "version-only mutation events must use the account-scoped monotonic adopter",
        );
        assert.match(
            appSource,
            /if \(!commitVersionedCharacter\(state\.character, state\._saveVersion\)\) return false;/,
            "mission state receipts must adopt their character and save version atomically",
        );
        const persistenceSource = readFileSync(new URL("./save-persistence.ts", import.meta.url), "utf8");
        assert.match(
            persistenceSource,
            /params\.latestVersion\.current = adoptSaveVersion\(params\.latestVersion\.current, acknowledgement\?\._saveVersion\)/,
            "autosave and immediate save acknowledgements must use the shared monotonic adopter",
        );
        const versionedCommit = appSource.slice(
            appSource.indexOf("function commitVersionedCharacter"),
            appSource.indexOf("const {", appSource.indexOf("function commitVersionedCharacter")),
        );
        assert.match(versionedCommit, /acceptVersionedSnapshot\(latestSaveVersionRef\.current, incomingVersion\)/);
        assert.ok(versionedCommit.indexOf("if (!decision.accepted) return false") < versionedCommit.indexOf("latestSaveVersionRef.current = decision.latestVersion"));
        assert.ok(versionedCommit.indexOf("installAuthoritativeSaveRef") < versionedCommit.indexOf("setCharacter(nextCharacter)"),
            "the synchronous save payload ref must be updated before React paints the authoritative character");
        assert.match(appSource, /commitVersionedCharacter\(reconcileOwnedStarter\(current, result\.character, granted\.id\), result\._saveVersion\)/,
            "starter entitlement replies must not split version adoption from their reconciled character");

        // No mutation reply may assign the ref directly. The remaining direct
        // assignments are full-snapshot adoptions, which replace character state at the
        // same time, so version and state stay consistent.
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = data\??\._saveVersion/);
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = saveData\._saveVersion/);
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = result\.saveVersion/);
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = Math\.max\(latestSaveVersionRef\.current, result\._saveVersion\)/);
    });
});

describe("save-failure banner threshold", () => {
    const persistenceSource = readFileSync(new URL("./save-persistence.ts", import.meta.url), "utf8");

    it("is low enough to fire during a routine deploy outage", () => {
        // Autosave runs every 15s, so a ~30s outage yields only 2-3 attempts. The old
        // counts (4 HTTP / 6 network) could not fire during the very incident the banner
        // exists for — the player just saw buttons that appeared to do nothing.
        assert.ok(
            SAVE_FAILURE_BANNER_THRESHOLD <= 2,
            `threshold ${SAVE_FAILURE_BANNER_THRESHOLD} is too high to trip inside a ~30s blip`,
        );
        // But not so low that one transient miss nags the player.
        assert.ok(SAVE_FAILURE_BANNER_THRESHOLD >= 2, "a single blip must not raise the banner");
    });

    it("is used by BOTH the rejection and the network-error path", () => {
        // The catch branch had its own, higher count; if either path keeps a literal the
        // banner stays effectively unreachable on that path.
        const uses = persistenceSource.match(/params\.failureCount\.current >= SAVE_FAILURE_BANNER_THRESHOLD/g) ?? [];
        assert.equal(uses.length, 2, "both the HTTP-rejection and network-error paths must use the shared threshold");
        assert.doesNotMatch(persistenceSource, /failureCount\.current >= [0-9]/, "no hard-coded streak counts");
    });
});
