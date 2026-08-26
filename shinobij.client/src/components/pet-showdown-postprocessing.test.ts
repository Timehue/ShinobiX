import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./PetShowdownBattle.tsx", import.meta.url)),
    "utf8",
);

test("Showdown avoids the postprocessing 6.39 MSAA depth-resolve failure", () => {
    assert.match(source, /<EffectComposer\s+multisampling=\{0\}>/);
    assert.match(source, /new ShowdownEdgeAAEffect\(\)/);
    assert.match(source, /new ShowdownChromaticEffect\(new THREE\.Vector2\(0\.0003, 0\.0002\)\)/);
    assert.doesNotMatch(source, /new ChromaticAberrationEffect/);
    assert.match(source, /list: \[edgeAA, rays, bloom, ca, zoom\]/);
});

test("Showdown retains canvas antialiasing while the conditional composer is absent", () => {
    assert.match(source, /gl=\{\{ antialias: true,/);
});
