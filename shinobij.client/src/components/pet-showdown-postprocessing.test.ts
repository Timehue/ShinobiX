import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
    fileURLToPath(new URL("./PetShowdownBattle.tsx", import.meta.url)),
    "utf8",
);

test("Showdown avoids the postprocessing 6.39 MSAA depth-resolve failure", () => {
    assert.match(source, /new EffectComposer\(gl\)/);
    assert.match(source, /composer\.renderTarget1\.samples = 0/);
    assert.match(source, /composer\.renderTarget2\.samples = 0/);
    assert.match(source, /new ShaderPass\(SHOWDOWN_POST_SHADER\)/);
    assert.doesNotMatch(source, /new UnrealBloomPass/);
    assert.doesNotMatch(source, /from ["'](?:@react-three\/postprocessing|postprocessing)["']/);
});

test("Showdown retains canvas antialiasing while the conditional composer is absent", () => {
    assert.match(source, /gl=\{\{ antialias: true,/);
});
