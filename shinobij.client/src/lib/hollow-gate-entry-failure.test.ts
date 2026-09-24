import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { hollowGateEntryFailureMessage, reportHollowGateEntryFailure } from "./hollow-gate-entry-failure.ts";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("a chunk that failed to download asks for a reload, never a retry", () => {
    // Chromium, Firefox and WebKit spell the same failure three ways.
    for (const message of [
        "Failed to fetch dynamically imported module: https://game/assets/x.js",
        "error loading dynamically imported module: https://game/assets/x.js",
        "Importing a module script failed.",
    ]) {
        const text = hollowGateEntryFailureMessage(new TypeError(message));
        assert.match(text, /failed to download/);
        assert.match(text, /Reload the page to continue/);
        assert.doesNotMatch(text, /try again|retry/i, "an in-page retry cannot fetch a cached failure");
    }
});

test("any other escaped failure still tells the player what to do", () => {
    const shown: string[] = [];
    reportHollowGateEntryFailure(new Error("unexpected"), (message) => shown.push(message));
    assert.equal(shown.length, 1);
    assert.match(shown[0], /could not open\. Reload the page to continue/);
    assert.match(shown[0], /without spending another key/);
});

test("App reports a failed shrine entry instead of dropping the promise", () => {
    const app = source("../App.tsx");
    // Three map buttons fire `void enterHollowGateShrine(...)`; the one wrapper
    // they share must catch, or a rejection is an unhandled no-op.
    assert.match(app, /return enterHollowGateShrineFlow\(\{[\s\S]{0,400}?\}\)\.catch\(reportHollowGateEntryFailure\);/);
});

test("rift entry carries no party or deck gate and no dynamic import on the way in", () => {
    const entry = source("./hollow-gate-entry.ts");
    assert.doesNotMatch(entry, /rift-entry-readiness|rift-entry-not-ready|riftEntryReadiness/);
    assert.doesNotMatch(entry, /await import\(/, "entry must not depend on a chunk it cannot recover in-page");
    assert.doesNotMatch(entry, /carried pets|40-card/);
});
