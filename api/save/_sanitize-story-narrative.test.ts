import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeCharacterSave } from "./[name].js";

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) => sanitizeCharacterSave(
    { character: incoming }, existing ? { character: existing } : null,
).character as Record<string, unknown>;

const choice = (choiceId: string, trait: string, extra: Char = {}) => ({
    version: 1, eventId: "story-test-4-0", pageId: "decision", choiceId,
    pageIndex: 1, choiceIndex: 0, nextPage: 2, trait, ...extra,
});

test("generic save preserves omitted pending narrative state and accepts explicit acknowledgement", () => {
    const pending = [{ version: 1, kind: "interlude", eventId: "story-interlude-test-20", trait: "answer" }];
    const scene = { version: 1, eventId: "story-test-4-0", pageIndex: 2, lineIndex: 1, history: [{ pageIndex: 0, lineIndex: 0 }] };
    const stored = { pendingStoryReports: pending, storyScene: scene };
    const omitted = sanitize({}, stored);
    assert.deepEqual(omitted.pendingStoryReports, pending);
    assert.deepEqual(omitted.storyScene, scene);
    const acknowledged = sanitize({ pendingStoryReports: [], storyScene: null }, stored);
    assert.deepEqual(acknowledged.pendingStoryReports, []);
    assert.equal(acknowledged.storyScene, null);
});

test("save merge keeps immutable ordinary and terminal decisions but accepts reusable callbacks", () => {
    const stored = { storyChoices: [choice("first", "honorable")] };
    const conflict = sanitize({ storyChoices: [choice("second", "ambitious")] }, stored);
    assert.deepEqual((conflict.storyChoices as Char[]).map((row) => row.choiceId), ["first"]);
    const terminalStored = choice("break", "honorable", { battle: true, revisitable: true });
    const callbacks = sanitize({ storyChoices: [
        choice("proof", "proof-presented", { revisitable: true }),
        choice("take", "ambitious", { battle: true, revisitable: true }),
    ] }, { storyChoices: [terminalStored] });
    assert.deepEqual((callbacks.storyChoices as Char[]).map((row) => row.choiceId), ["break", "proof"]);
});

test("contradictory report metadata is bounded and preserved explicitly", () => {
    const out = sanitize({ pendingStoryReports: [{
        version: 99, kind: "interlude", eventId: "e".repeat(300), trait: "t".repeat(300),
        status: "conflict", recordedTrait: "server".repeat(100),
    }] }, {});
    const report = (out.pendingStoryReports as Char[])[0];
    assert.equal(report.version, 1);
    assert.equal((report.eventId as string).length, 160);
    assert.equal((report.trait as string).length, 160);
    assert.equal(report.status, "conflict");
    assert.equal((report.recordedTrait as string).length, 160);
});
