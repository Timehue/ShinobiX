import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cinematic = readFileSync(new URL("./IntroCinematic.tsx", import.meta.url), "utf8");
const companionRenderer = readFileSync(new URL("./IntroCompanion3D.tsx", import.meta.url), "utf8");

test("the three tall starter rigs receive headroom in every shared companion presentation", () => {
    const confirmation = cinematic.match(
        /\{phase\.kind === "confirm" && \([\s\S]*?<IntroCompanion3D[\s\S]*?\/>/,
    )?.[0] ?? "";

    assert.match(companionRenderer, /"starter-fire",[\s\S]*"starter-lightning",[\s\S]*"starter-earth",/);
    assert.match(companionRenderer, /const companionVisualId = config\?\.identityVisualId \?\? config\?\.visualId \?\? pet\.id/);
    assert.match(companionRenderer, /const needsHeadroom = COMPANION_HEADROOM_IDS\.has\(companionVisualId\)/);
    assert.match(companionRenderer, /needsHeadroom \? \[0, 1\.65, 4\.85\]/);
    assert.match(companionRenderer, /needsHeadroom && !closeUp \? 0\.84 : 0\.92/);
    assert.doesNotMatch(confirmation, /\bheadroom=/);
});
