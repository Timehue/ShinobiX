import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// applied it (lib/player-save-coordinator reads the stored save back). The
// companion actions used to treat that as a failure: runPetProgress threw "A
// newer companion update is already active." after a paid rename, so renaming
// again charged another 10 Fate Shards.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const petYard = read("./PetYard.tsx");
const barn = read("../components/PetBreedingBarn.tsx");

function handler(source: string, name: string): string {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} is missing`);
    const end = source.slice(start + 1).search(/\n {4}(?:async )?function /);
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

const REFUSAL_STOPS = /!\s*(?:onVersionedCharacter|commitServerCharacter)\([^()]*\)\)+\s*(?:return\b|throw\b)/;

test("a settled companion action finishes when its reply is refused as stale", () => {
    for (const [source, names] of [[petYard, ["runPetProgress", "startExpedition", "collectExpedition"]], [barn, ["confirmStart", "hatch"]]] as const) {
        for (const name of names) {
            const body = handler(source, name);
            assert.match(body, /(?:onVersionedCharacter|commitServerCharacter)\(/, `${name} must still adopt the reply`);
            assert.doesNotMatch(body, REFUSAL_STOPS, `${name} must not stop when its settled reply is refused as stale`);
        }
    }
    assert.doesNotMatch(petYard, /A newer companion update is already active/);
    // The shared helper hands its reply back, so every caller (rename, feed,
    // train, equip, release) finishes its own step.
    assert.match(handler(petYard, "runPetProgress"), /onVersionedCharacter\(data\.character as Character, data\._saveVersion\);\s*return data as/);
    assert.match(handler(barn, "hatch"), /commitServerCharacter\(result\.character, result\._saveVersion\);\s*setSessionOverride\(null\); setHatchedDestination\(/);
});
