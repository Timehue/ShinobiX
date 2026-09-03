import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    FIRST_PACT_ANCHOR_QUALITIES,
    FIRST_PACT_MAIN_BEATS,
    FIRST_PACT_TOURNAMENT,
    FIRST_PACT_VOWS,
} from "../../../shared/first-pact-contract.js";

const screen = readFileSync(new URL("../screens/FirstPact.tsx", import.meta.url), "utf8");
const apiCopy = readFileSync(new URL("./first-pact-api.ts", import.meta.url), "utf8");
const productionSpec = readFileSync(new URL("../../../docs/first-pact-production-spec.md", import.meta.url), "utf8");

test("First Pact copy uses the main story's plain, zero-dash voice", () => {
    assert.doesNotMatch(`${screen}\n${apiCopy}`, /[\u2013\u2014]/u);
    assert.doesNotMatch(screen, /historical echo|living echo/i);
    assert.match(screen, /This is the past, not a reconstructed refuge\./);
});

test("First Pact states the Sunken Court chronology without rewriting the main story", () => {
    assert.match(screen, /civic lattice your age calls Hollow Gate/i);
    assert.match(screen, /four village anchors do not exist yet/i);
    assert.match(screen, /later refused the Court's demand to surrender that choice/i);
    assert.match(screen, /Your age remembers them among the Withheld/i);
    assert.match(screen, /cannot prevent the Sunken Court from falling/i);
    assert.match(screen, /The ruins are unchanged/i);
    assert.doesNotMatch(screen, /\b(?:bloodline|reincarnation|chosen one|trapped soul)\b/i);
});

test("the remembered pact gives three costly answers spanning all four anchor qualities", () => {
    assert.equal(FIRST_PACT_VOWS.length, 3);
    const covered = new Set(FIRST_PACT_VOWS.flatMap((vow) => [...vow.anchors]));
    assert.deepEqual([...covered].sort(), [...FIRST_PACT_ANCHOR_QUALITIES].sort());
    for (const vow of FIRST_PACT_VOWS) {
        assert.ok(FIRST_PACT_MAIN_BEATS.includes(`forge-first-pact-${vow.id}`));
        assert.ok(vow.consequence.length > 40);
        assert.ok(vow.returnCopy.length > 40);
    }
    assert.match(screen, /The Court has issued a finding for your companions/);
});

test("the production spec and runtime tournament use the same names", () => {
    for (const encounter of FIRST_PACT_TOURNAMENT) {
        assert.match(productionSpec, new RegExp(encounter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(productionSpec, new RegExp(encounter.opponent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
});
