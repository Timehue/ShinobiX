import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// settled it. Training used to report each of these as "Action unconfirmed.
// Refresh before retrying." and left the timer picker open.
//
// The session itself is the one thing NOT set on a refusal. The coordinator
// reads the stored save back (lib/player-save-coordinator), and that installs
// the server's session (lib/use-player-save-state). The setters here force an
// immediate save, which would carry the older local copy ahead of that read.
const training = readFileSync(new URL("./Training.tsx", import.meta.url), "utf8");

function handler(name: string): string {
    const start = training.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} is missing`);
    const end = training.slice(start + 1).search(/\n {4}(?:async )?function /);
    return end < 0 ? training.slice(start) : training.slice(start, start + 1 + end);
}

test("a settled training reply refused as stale is confirmed, not reported as unconfirmed", () => {
    const handlers = ["startTraining", "cancelTraining", "completeTraining", "startPaidJutsuTraining", "completePaidJutsuTraining",
        "cancelPaidJutsuTraining", "finishWithRyo", "queueNextJutsuTraining", "cancelQueuedJutsuTraining"];
    for (const name of handlers) {
        const body = handler(name);
        assert.doesNotMatch(body, /!onVersionedCharacter\([^()]*\)\)\s*return\b/, `${name} must not stop when its settled reply is refused as stale`);
        assert.match(body, /if \((?:onVersionedCharacter\([^()]*\)|current)\) setActive(?:Jutsu)?Training\(/,
            `${name} sets its session only on an accepted commit`);
    }
    // Each one still closes the picker or posts its success notice.
    assert.match(handler("startTraining"), /setActiveTraining\(data\.activeTraining as ActiveTraining\);\s*setTimerPickerOpen\(false\);/);
    for (const name of handlers.slice(3)) assert.match(handler(name), /setJutsuNotice\(\{\s*tone: "success"/,`${name} must confirm the settled lesson`);
});
