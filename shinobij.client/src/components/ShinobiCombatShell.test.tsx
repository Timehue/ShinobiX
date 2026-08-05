import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShinobiCombatShell } from "./ShinobiCombatShell";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("shared shell stamps the same application boundary for PvP and Solo PvE", () => {
    const solo = renderToStaticMarkup(<ShinobiCombatShell mode="solo"><main>solo</main></ShinobiCombatShell>);
    const pvp = renderToStaticMarkup(<ShinobiCombatShell mode="pvp"><main>pvp</main></ShinobiCombatShell>);
    for (const html of [solo, pvp]) {
        assert.match(html, /arena-fullscreen combat-instance shinobi-combat-shell/);
    }
    assert.match(solo, /shinobi-combat-shell--solo/);
    assert.match(pvp, /shinobi-combat-shell--pvp/);
});
