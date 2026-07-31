import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { SAVE_FAILURE_BANNER_THRESHOLD, createSaveFlightGate } from "./save-flight";

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

describe("autosave wiring in App.tsx", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    it("gates persistSave and re-arms the dirty flag when deferring", () => {
        // Re-arming dirty is what makes deferral safe: the next tick sends the CURRENT
        // snapshot instead of the stale one this call was holding.
        assert.match(
            appSource,
            /if \(saveFlightRef\.current\.busy\(\)\) \{ charDirtyRef\.current = true; return; \}/,
            "persistSave must defer (and stay dirty) while another save is in flight",
        );
        assert.match(appSource, /return saveFlightRef\.current\.run\(async \(\) => \{/);
    });

    it("adopts every mutation-response save version monotonically", () => {
        // A version that can go BACKWARDS guarantees a spurious 409 on the next
        // autosave, and the 409 path applies the server snapshot wholesale.
        for (const source of ["data._saveVersion", "saveData?._saveVersion", "result.saveVersion"]) {
            // Plain substring, not a built regex: every character here is literal, so
            // escaping one would only reintroduce a partial escaper to get wrong.
            const call = `latestSaveVersionRef.current = adoptSaveVersion(latestSaveVersionRef.current, ${source})`;
            assert.ok(appSource.includes(call), `${source} must be adopted via adoptSaveVersion`);
        }

        // No mutation reply may assign the ref directly. The remaining direct
        // assignments are full-snapshot adoptions, which replace character state at the
        // same time, so version and state stay consistent.
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = data\._saveVersion/);
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = saveData\._saveVersion/);
        assert.doesNotMatch(appSource, /latestSaveVersionRef\.current = result\.saveVersion/);
    });
});

describe("save-failure banner threshold", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

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
        const uses = appSource.match(/saveFailCountRef\.current >= SAVE_FAILURE_BANNER_THRESHOLD/g) ?? [];
        assert.equal(uses.length, 2, "both the HTTP-rejection and network-error paths must use the shared threshold");
        assert.doesNotMatch(appSource, /saveFailCountRef\.current >= [0-9]/, "no hard-coded streak counts");
    });
});
