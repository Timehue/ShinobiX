import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// App hands Missions/Logbook a fresh onVersionedCharacter every render, so the
// adoptFieldTrail callback built on it changes identity every render. When the
// accepted-contract sync effect listed it as a dependency, every App re-render
// re-POSTed a field-trail "state" for each accepted contract. That drained the
// 40/min field-trail budget, and a player's next Abandon got "You're going a
// little fast" (Nero, 2026-09-24).
describe("accepted field contract sync", () => {
    for (const screen of ["Missions", "Logbook"]) {
        test(`${screen} re-syncs only when the accepted set or the player changes`, () => {
            const src = readFileSync(new URL(`../screens/${screen}.tsx`, import.meta.url), "utf8");
            const effects = [...src.matchAll(/useEffect\(\(\) => \{\s*const owner = character\.name;\s*const ids = acceptedFieldMissionKey[\s\S]*?\n\s*\}, \[([^\]]*)\]\);/g)];
            assert.equal(effects.length, 1, `${screen} must have exactly one accepted-contract sync effect`);
            const deps = effects[0][1].split(",").map((dep) => dep.trim()).sort();
            assert.deepEqual(deps, ["acceptedFieldMissionKey", "character.name"]);
            assert.match(effects[0][0], /adoptFieldTrailRef\.current\(result\)/);
        });
    }

    test("HunterBoard re-syncs hunts only when the accepted set or the player changes", () => {
        const src = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
        const effect = src.match(/useEffect\(\(\) => \{\s*let cancelled = false;\s*const missionIds = acceptedHuntKey[\s\S]*?\n\s*\}, \[([^\]]*)\]\);/);
        assert.ok(effect, "HunterBoard must keep its accepted-hunt sync effect");
        const deps = effect[1].split(",").map((dep) => dep.trim());
        assert.ok(!deps.includes("onVersionedCharacter") && !deps.includes("onServerVersion"),
            `per-render App callbacks must not be deps: ${deps.join(", ")}`);
        assert.match(effect[0], /commitRef\.current\.onVersionedCharacter\(/);
    });
});

// The same trap in callbacks and hooks whose effects fetch: the deps array
// that drives the fetch must not name a per-render App callback.
describe("fetching callbacks and hooks do not depend on per-render App callbacks", () => {
    const cases: Array<{ file: string; anchor: string; allowed: string[] }> = [
        { file: "../screens/LegacyPanel.tsx", anchor: "const reload = useCallback(", allowed: ["character.name"] },
        { file: "../components/PetBreedingBarn.tsx", anchor: "const refresh = useCallback(", allowed: ["character.name"] },
        { file: "./use-village-tax.ts", anchor: "const name = character?.name;", allowed: ["character?.name", "setCharacter"] },
        { file: "./jutsu-training-queue.ts", anchor: "if (!isServerSettlementReady(\"timedJutsuTrainingQueue\")) return;", allowed: ["playerName", "activeJutsuTraining", "setActiveJutsuTraining"] },
    ];
    for (const { file, anchor, allowed } of cases) {
        test(file, () => {
            const src = readFileSync(new URL(file, import.meta.url), "utf8");
            const start = src.indexOf(anchor);
            assert.notEqual(start, -1, `${file} must keep ${anchor}`);
            const deps = src.slice(start).match(/\n\s*\}, \[([^\]]*)\]\);/);
            assert.ok(deps, `${file} deps array not found`);
            assert.deepEqual(deps[1].split(",").map((dep) => dep.trim()).sort(), [...allowed].sort());
        });
    }
});
