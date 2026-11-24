import assert from "node:assert/strict";
import test from "node:test";
import { SPEECH_BUBBLE_MAX, speechBubbleLine } from "./speech-bubble-line";

test("a short greeting is left alone", () => {
    assert.equal(speechBubbleLine("Hello there."), "Hello there.");
    assert.equal(speechBubbleLine("  Good   to see you. "), "Good to see you.");
});

test("a paragraph is cut to its first sentence", () => {
    const text = "I'm Tomoe, a companion trainer. This is Kuro; he grew his second tail through years of working with me, a change called Bondwake.";
    assert.equal(speechBubbleLine(text), "I'm Tomoe, a companion trainer.");
});

test("one long sentence is cut at a word and marked", () => {
    const text = "Kuro found your trail and the next field note covers the way a companion's role and element decide what it does in battle";
    const line = speechBubbleLine(text);
    assert.ok(line.length <= SPEECH_BUBBLE_MAX, line);
    assert.ok(line.endsWith("…") && !line.endsWith(" …"), line);
    assert.ok(text.startsWith(line.slice(0, -1)), "a prefix of the original");
});
