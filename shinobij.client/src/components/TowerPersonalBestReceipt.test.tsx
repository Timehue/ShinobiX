import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TowerPersonalBestReceipt } from "./TowerPersonalBestReceipt";
import type { TowerClearComparison } from "../../../shared/tower-progression";

const comparison: TowerClearComparison = { runId: "run", key: "story:1:1:rest-shrine", score: 1500, rounds: 4, clean: true,
    previous: { mode: "story", floor: 1, partySize: 1, bestScore: 1200, fastestRounds: 6, noKnockout: false } };
const render = (value?: TowerClearComparison) => renderToStaticMarkup(<TowerPersonalBestReceipt comparison={value} />);

test("result receipt shows score improvement, fewer rounds and a first clean clear", () => {
    const html = render(comparison);
    for (const text of ["Personal best improved", "+300", "2 fewer", "First clean clear"]) assert.ok(html.includes(text));
});
test("slower repeat keeps previous achievements without claiming an improvement", () => {
    const html = render({ ...comparison, score: 1000, rounds: 8, clean: false, previous: { ...comparison.previous!, noKnockout: true } });
    for (const text of ["Compared with your best", "200 below best", "2 more than fastest", "Clean best retained"]) assert.ok(html.includes(text));
    assert.ok(!html.includes("new best"));
});
test("first clears and matching records have accurate labels", () => {
    assert.ok(render({ ...comparison, previous: undefined }).includes("First clear recorded"));
    const html = render({ ...comparison, score: 1200, rounds: 6, previous: { ...comparison.previous!, noKnockout: true } });
    for (const text of ["Matched best", "Matched fastest", "Clean clear repeated"]) assert.ok(html.includes(text));
    assert.ok(!html.includes("Personal best improved"));
});
test("there is no comparison panel without a committed receipt", () => assert.equal(render(), ""));
