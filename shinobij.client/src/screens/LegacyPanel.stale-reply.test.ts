import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// settled it (lib/player-save-coordinator reads the stored save back). These
// screens told the player their sealed Legacy, finished trial or chapter was
// "ignored" or "set aside", or never showed a paid fight or its report.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

function handler(source: string, name: string): string {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `${name} is missing`);
    const end = source.slice(start + 1).search(/\n {4}(?:async )?function /);
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

const REFUSAL_STOPS = /!\s*onVersionedCharacter\([^()]*\)\)+\s*(?:return\b|throw\b)|onVersionedCharacter\([^()]*\)\s*===\s*false/;

const cases: Array<[file: string, names: string[]]> = [
    ["../components/EmissaryTrialPanel.tsx", ["complete"]],
    ["./LegacyPanel.tsx", ["handleTrial"]],
    ["../components/SageOfferModal.tsx", ["handleAccept"]],
    ["../components/WorldEraChapter.tsx", ["submit"]],
    ["./SectorWarGarrisonAssault.tsx", ["adoptResult"]],
    ["./WeeklyBossArena.tsx", ["launchAuthoritativeFight", "recoverAuthoritativeFight", "settleAuthoritativeFight"]],
];

test("a settled Legacy, era, garrison or Weekly Boss reply finishes when refused as stale", () => {
    for (const [file, names] of cases) {
        const source = read(file);
        for (const name of names) {
            const body = handler(source, name);
            assert.match(body, /onVersionedCharacter\(/, `${file} ${name} must still adopt the reply`);
            assert.doesNotMatch(body, REFUSAL_STOPS, `${file} ${name} must not stop when its settled reply is refused as stale`);
        }
    }
    for (const [file, line] of [
        ["../components/EmissaryTrialPanel.tsx", "This older reply was set aside"],
        ["./LegacyPanel.tsx", "this older trial reply was ignored"],
        ["../components/SageOfferModal.tsx", "older reply was safely ignored"],
        ["../components/WorldEraChapter.tsx", "A newer save arrived"],
        ["./WeeklyBossArena.tsx", "A newer Weekly Boss result is already active"],
    ] as const) assert.ok(!read(file).includes(line), `${file} must not report a settled reply as refused`);
    // The paid fight opens, and the settled assault shows its report.
    assert.match(handler(read("./WeeklyBossArena.tsx"), "launchAuthoritativeFight"), /if \(data\.character\) onVersionedCharacter\(data\.character, data\._saveVersion\);\s*setFight\(/);
    const garrison = read("./SectorWarGarrisonAssault.tsx");
    assert.match(handler(garrison, "settleGarrison"), /adoptResult\(runId, /);
    assert.match(handler(garrison, "adoptResult"), /if \(r\.ok && r\.character\) onVersionedCharacter\(r\.character, r\._saveVersion\);[\s\S]*?setReport\(r\);\s*setPhase\("result"\);/);
});
