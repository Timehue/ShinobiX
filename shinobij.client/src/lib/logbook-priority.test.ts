import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogbookObjective } from "./logbook-objectives";
import { logbookPriority } from "./logbook-priority";

const exam = (examKey: string, unlockLevel: number, prestige = false, ready = false): LogbookObjective => ({
    id: examKey, examKey, title: examKey, kind: "exam", unlockLevel,
    progressionImpact: prestige ? "prestige" : "blocking",
    requirements: [{ label: "Requirement", progress: ready ? 1 : 0, target: 1 }],
});

test("an active advancement hold displaces optional or early work", () => {
    const hold = exam("chunin", 39);
    const optional = exam("jonin", 50, true, true);
    assert.equal(logbookPriority({ level: 39, examsPassed: [] }, [optional, hold], optional), hold);
});

test("upcoming required preparation precedes optional prestige", () => {
    const upcoming = exam("chunin", 39);
    const optional = exam("jonin", 50, true);
    assert.equal(logbookPriority({ level: 30, examsPassed: ["genin"] }, [optional, upcoming], null), upcoming);
});

test("Academy and chapter guidance remain first while no hold is active", () => {
    const chapter: LogbookObjective = { id: "first-steps", title: "First steps", kind: "chapter", unlockLevel: 2, requirements: [] };
    assert.equal(logbookPriority({ level: 10, examsPassed: [] }, [exam("genin", 20)], chapter), chapter);
});

test("optional recognition follows the server's exam order even when a later distinction looks ready", () => {
    const passed = exam("chunin", 39);
    const pending = exam("jonin", 50, true);
    const ready = exam("specialJonin", 80, true, true);
    assert.equal(logbookPriority({ level: 80, examsPassed: ["chunin"] }, [passed, pending, ready], null), pending);
    assert.equal(logbookPriority({ level: 80, examsPassed: ["chunin", "jonin"] }, [passed, pending, ready], null), ready);
    assert.equal(logbookPriority({ level: 80, examsPassed: ["chunin", "jonin", "specialJonin"] }, [passed, pending, ready], null), null);
});
