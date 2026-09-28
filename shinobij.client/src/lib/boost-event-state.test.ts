import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { loadBoostEvent, setSharedBoostEvent } from "./boost-event-state";
import { setSharedBoostEventPayload } from "./world-state";

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;
const row = { id: "b1", title: "Double training", multiplier: 2, targets: ["training"], startsAt: T0, endsAt: T0 + HOUR };

afterEach(() => setSharedBoostEventPayload(null));

describe("boost event client state", () => {
    it("reads the polled payload only while the event runs", () => {
        setSharedBoostEventPayload(row);
        assert.equal(loadBoostEvent(T0 - 1), null, "before start");
        assert.equal(loadBoostEvent(T0)?.multiplier, 2);
        assert.equal(loadBoostEvent(T0 + HOUR), null, "ends exactly at endsAt");
    });

    it("never trusts a malformed payload", () => {
        for (const bad of [null, undefined, "2x", [], { ...row, multiplier: 5 }, { ...row, targets: ["gold"] }, { ...row, endsAt: T0 }]) {
            setSharedBoostEventPayload(bad);
            assert.equal(loadBoostEvent(T0), null, JSON.stringify(bad));
        }
    });

    it("adopts an admin start or stop ahead of the next poll", () => {
        setSharedBoostEvent(row);
        assert.equal(loadBoostEvent(T0)?.id, "b1");
        setSharedBoostEvent(null);
        assert.equal(loadBoostEvent(T0), null);
    });

    // world-state.ts ships in the startup bundle. Importing the boost-event
    // module there put all of it (admin copy, formatters) into the initial
    // graph and broke the production image's gzip budget on PR #223.
    it("keeps the boost-event module out of world-state.ts", () => {
        const source = readFileSync(`${process.cwd()}/shinobij.client/src/lib/world-state.ts`, "utf8");
        assert.doesNotMatch(source, /\bfrom\s+["'][^"']*boost-event(?:-state)?["']/);
    });
});
