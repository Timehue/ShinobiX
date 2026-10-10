import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A player's writes are stored in order, but their replies can land in any
// order. When a later write's save version is adopted first, an earlier reply's
// commit is refused as stale and returns false, yet the server has already
// settled it (lib/player-save-coordinator reads the stored save back). Paid
// crafts, rolls, sales and transfers must finish their step on that refusal.
// The war-crate and sale cases are exercised end to end in
// e2e/profession-change.spec.ts; these cover the rest of the economy screens.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

function handler(source: string, name: string): string {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `${name} is missing`);
    const end = source.slice(start + 1).search(/\n\s*(?:async )?function |\n {4}const |\n {4}return \(/);
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

const REFUSAL_STOPS = /!\s*(?:onVersionedCharacter|commitServerCharacter|onCharacter)\([^()]*\)\)+\s*(?:return\b|\{\s*(?:return|setError|setSaleError)\b|throw\b)/;

const cases: Array<[file: string, names: string[]]> = [
    ["./CentralHub.tsx", ["rollAwakening", "awakeningCreateBloodline", "craftHollowGateKeyWithDungeonKeys", "craftHollowGateKeyWithFateShards", "forgeRelicFromFragments", "forgeCoreFromShards"]],
    ["./Inventory.tsx", ["applyElementalCore", "consumeItem", "sellSelectedItem"]],
    ["./Bank.tsx", ["moveRyo"]],
    ["./Cafeteria.tsx", ["eat", "cook"]],
    ["../components/MasteryPanel.tsx", ["mutateMastery"]],
    ["../components/GatheringFind.tsx", ["collect"]],
];

test("a settled economy action finishes its step when its reply is refused as stale", () => {
    for (const [file, names] of cases) {
        const source = read(file);
        for (const name of names) {
            const body = handler(source, name);
            assert.match(body, /(?:onVersionedCharacter|commitServerCharacter|onCharacter)\(/, `${file} ${name} must still adopt the reply`);
            assert.doesNotMatch(body, REFUSAL_STOPS, `${file} ${name} must not stop when its settled reply is refused as stale`);
        }
    }
    // The paid awakening still reveals its element, the forge opens its builder,
    // and a collected find shows what was stowed.
    const hub = read("./CentralHub.tsx");
    assert.match(handler(hub, "rollAwakening"), /commitServerCharacter\(result\.character, result\._saveVersion\);\s*setTriggeredEvents\(/);
    assert.match(handler(hub, "awakeningCreateBloodline"), /commitServerCharacter\(result\.character, result\._saveVersion\);\s*closeAwakening\(\);/);
    assert.match(handler(read("../components/GatheringFind.tsx"), "collect"), /onCharacter\(result\.character, result\.saveVersion\);\s*setCollected\(/);
});
