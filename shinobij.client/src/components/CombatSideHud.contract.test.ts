import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CombatSideHud.tsx", import.meta.url), "utf8");

test("desktop effect pills render the complete readable status contract", () => {
    assert.match(source, /semantics\.category/);
    assert.match(source, /semantics\.source/);
    assert.match(source, /semantics\.removal/);
    assert.match(source, /statusDurationText\(s\)/);
    assert.match(source, /minRounds/);
    assert.match(source, /maxRounds/);
    assert.match(source, /effect-pill-context/);
    assert.match(source, /effect-status-icon/);
});

test("mobile effect chips are inspectable controls with visible complete details", () => {
    assert.match(source, /<button[\s\S]*?popoverTarget=\{id\}/);
    assert.match(source, /popover="auto"/);
    assert.match(source, /aria-haspopup="dialog"/);
    assert.match(source, /<dt>Category<\/dt>/);
    assert.match(source, /<dt>Duration<\/dt>/);
    assert.match(source, /<dt>Source<\/dt>/);
    assert.match(source, /<dt>Removal<\/dt>/);
    assert.match(source, /Source: \$\{semantics\.source\}/);
});
