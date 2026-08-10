import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    WF_DOCTRINES as SIM_DOCTRINES,
    WF_STANCES as SIM_STANCES,
    scoutedWarfrontDoctrine as simScout,
} from "./pet-warfront-sim.ts";
import {
    WF_DOCTRINES,
    WF_STANCES,
    scoutedWarfrontDoctrine,
} from "./pet-warfront-strategy.ts";

function importsFrom(source: string, specifier: string): RegExpMatchArray[] {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...source.matchAll(new RegExp(`import\\s+(type\\s+)?[^;]*?\\s+from\\s+["']${escaped}["'];`, "g"))];
}

test("pre-match screens do not runtime-import the Warfront simulator", () => {
    const arena = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");
    const coop = readFileSync(new URL("../components/ArenaCoopLobby.tsx", import.meta.url), "utf8");

    const arenaSimImports = importsFrom(arena, "../lib/pet-warfront-sim");
    assert.ok(arenaSimImports.length > 0, "PetArena should retain its simulator type contracts");
    assert.ok(arenaSimImports.every((match) => match[1] !== undefined), "PetArena simulator imports must remain type-only");
    assert.equal(importsFrom(coop, "../lib/pet-warfront-sim").length, 0, "co-op setup should not import the simulator");

    assert.equal(importsFrom(arena, "../lib/pet-warfront-strategy").length, 1);
    assert.equal(importsFrom(coop, "../lib/pet-warfront-strategy").length, 0,
        "co-op consumes the already sealed setup and should not load strategy metadata");

    assert.equal(importsFrom(arena, "../lib/pet-warfront-theme").length, 1,
        "the pre-match screen should use the dependency-free theme lookup");
    assert.equal(importsFrom(arena, "../lib/pet-warfront-map").length, 0,
        "the pre-match screen must not eagerly pull the procedural map and baked mask");

    const strategy = readFileSync(new URL("./pet-warfront-strategy.ts", import.meta.url), "utf8");
    assert.doesNotMatch(strategy, /^import\s/m, "strategy metadata must stay dependency-free");
    const theme = readFileSync(new URL("./pet-warfront-theme.ts", import.meta.url), "utf8");
    assert.doesNotMatch(theme, /^import\s/m, "theme lookup must stay dependency-free");
});

test("simulator re-exports the lightweight strategy contracts unchanged", () => {
    assert.equal(SIM_STANCES, WF_STANCES);
    assert.equal(SIM_DOCTRINES, WF_DOCTRINES);
    assert.equal(simScout, scoutedWarfrontDoctrine);

    for (const seed of [0, 1, 2, 19, 77, 12345, 0xffff_ffff]) {
        for (const team of ["blue", "red"] as const) {
            assert.equal(simScout(seed, team), scoutedWarfrontDoctrine(seed, team));
        }
    }
});
