/*
 * advanceJutsuTrainingQueue is the pure core of the queue runner. These tests lock
 * the fix for the "queue doesn't restart until login" bug: because ryo training is
 * client-authoritative the timer only ticks while a client is open, so a promoted
 * 2nd training must be BACK-DATED to when the first actually ended (not the login
 * moment) and, after a long enough absence, also granted in the same pass — so a
 * returning player collects everything they queued without re-logging to advance it.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { advanceJutsuTrainingQueue } from "./jutsu-training-queue";
import type { ActiveJutsuTraining, QueuedJutsuTraining } from "../types/combat";

const T0 = 1_000_000; // fixed epoch base — the settler takes `now` so tests are deterministic
const HOUR = 3_600_000;

function active(over: Partial<ActiveJutsuTraining> = {}): ActiveJutsuTraining {
    return { jutsuId: "fireball", label: "Fireball", fromLevel: 5, toLevel: 6, ryoCost: 1000, startedAt: T0, endsAt: T0 + HOUR, ...over };
}
function queued(over: Partial<QueuedJutsuTraining> = {}): QueuedJutsuTraining {
    return { jutsuId: "windblade", label: "Wind Blade", fromLevel: 3, toLevel: 4, ryoCost: 800, durationMs: HOUR, ...over };
}

describe("advanceJutsuTrainingQueue", () => {
    it("null active is a no-op", () => {
        assert.deepEqual(advanceJutsuTrainingQueue(null, T0), { grants: [], active: null });
    });

    it("active still in progress: nothing granted, active untouched", () => {
        const a = active({ next: queued() });
        const r = advanceJutsuTrainingQueue(a, T0 + HOUR / 2);
        assert.deepEqual(r.grants, []);
        assert.equal(r.active, a);
    });

    it("first done, second still mid-flight: grants the first and BACK-DATES the promotion to the first's end (not `now`)", () => {
        const a = active({ next: queued() }); // A ends T0+HOUR; B lasts 1h
        // Log in 30 min into B's real window.
        const r = advanceJutsuTrainingQueue(a, T0 + HOUR + HOUR / 2);
        assert.deepEqual(r.grants, [{ jutsuId: "fireball", toLevel: 6 }]);
        assert.ok(r.active);
        assert.equal(r.active!.jutsuId, "windblade");
        // The whole point: B's clock is anchored to when A ended, so offline time counts.
        assert.equal(r.active!.startedAt, T0 + HOUR);
        assert.equal(r.active!.endsAt, T0 + 2 * HOUR);
        assert.equal(r.active!.autoClaim, true);
        assert.equal(r.active!.next ?? null, null);
    });

    it("promoted endsAt does not depend on `now` (offline time is not discarded)", () => {
        const a = active({ next: queued() });
        const early = advanceJutsuTrainingQueue(a, T0 + HOUR + 1).active!;
        const late = advanceJutsuTrainingQueue(a, T0 + HOUR + HOUR / 2).active!;
        assert.equal(early.endsAt, late.endsAt); // same back-dated end regardless of login time
        assert.equal(early.endsAt, T0 + 2 * HOUR);
    });

    it("long absence: both runs already elapsed → grants both levels and frees the slot", () => {
        const a = active({ next: queued() });
        const r = advanceJutsuTrainingQueue(a, T0 + 5 * HOUR);
        assert.deepEqual(r.grants, [
            { jutsuId: "fireball", toLevel: 6 },
            { jutsuId: "windblade", toLevel: 4 },
        ]);
        assert.equal(r.active, null);
    });

    it("same jutsu trained twice composes in order (5→6 then 6→7)", () => {
        const a = active({ jutsuId: "fireball", toLevel: 6, next: queued({ jutsuId: "fireball", label: "Fireball", fromLevel: 6, toLevel: 7 }) });
        const r = advanceJutsuTrainingQueue(a, T0 + 5 * HOUR);
        assert.deepEqual(r.grants, [
            { jutsuId: "fireball", toLevel: 6 },
            { jutsuId: "fireball", toLevel: 7 },
        ]);
        assert.equal(r.active, null);
    });

    it("lone auto-claiming promotion that has finished is granted and the slot freed", () => {
        const a = active({ jutsuId: "windblade", toLevel: 4, autoClaim: true, endsAt: T0 + HOUR });
        const r = advanceJutsuTrainingQueue(a, T0 + 2 * HOUR);
        assert.deepEqual(r.grants, [{ jutsuId: "windblade", toLevel: 4 }]);
        assert.equal(r.active, null);
    });

    it("lone auto-claiming promotion still mid-flight is left running", () => {
        const a = active({ autoClaim: true });
        const r = advanceJutsuTrainingQueue(a, T0 + HOUR / 2);
        assert.deepEqual(r.grants, []);
        assert.equal(r.active, a);
    });

    it("a finished manually-started single training (no queue, no autoClaim) is NOT auto-granted", () => {
        const a = active({ endsAt: T0 + HOUR }); // no next, no autoClaim — still a manual claim
        const r = advanceJutsuTrainingQueue(a, T0 + 2 * HOUR);
        assert.deepEqual(r.grants, []);
        assert.equal(r.active, a);
    });

    it("idempotent: re-running on a promoted run does nothing until it finishes, then grants once", () => {
        const a = active({ next: queued() });
        const mid = advanceJutsuTrainingQueue(a, T0 + HOUR + HOUR / 2).active!;
        const again = advanceJutsuTrainingQueue(mid, T0 + HOUR + HOUR / 2);
        assert.deepEqual(again.grants, []);
        assert.equal(again.active, mid);
        const done = advanceJutsuTrainingQueue(mid, T0 + 3 * HOUR);
        assert.deepEqual(done.grants, [{ jutsuId: "windblade", toLevel: 4 }]);
        assert.equal(done.active, null);
    });
});
