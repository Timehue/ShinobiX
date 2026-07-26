// Render tests for the CLASH prompt — the one overlay that stops the fight and
// asks the player a question, so its states have to be right.
//
// Rendered with renderToStaticMarkup (same approach as ChronicleDuelBoard.test.ts):
// no jsdom needed, and it exercises the real component rather than a copy of its
// logic. Interaction is not covered here — there is no DOM event infrastructure in
// this repo — but the three states that differ per mode are.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// The test runner compiles .tsx with the CLASSIC JSX runtime (the automatic one is
// configured in tsconfig.app.json, which only Vite reads), so component modules
// emit bare `React.createElement` calls. Same line, same reason, as
// ChronicleDuelBoard.test.ts — without it every render throws "React is not
// defined" from inside the component.
(globalThis as typeof globalThis & { React: typeof React }).React = React;
import { PetDuelClashPrompt } from "./PetDuelClashPrompt";

const render = (props: Partial<React.ComponentProps<typeof PetDuelClashPrompt>> = {}) =>
    renderToStaticMarkup(React.createElement(PetDuelClashPrompt, {
        selfName: "Ember", foeName: "Tide", pick: -1, remaining: 1,
        onPick: () => undefined,
        ...props,
    }));

test("the prompt names both fighters and offers all three reads", () => {
    const html = render();
    assert.match(html, /CLASH/);
    assert.match(html, /Ember/);
    assert.match(html, /Tide/);
    for (const call of ["Strike", "Guard", "Dodge"]) {
        assert.match(html, new RegExp(call), `${call} must be offered`);
    }
    // The triangle is printed on the buttons so a first-timer can reason about the
    // read rather than guess.
    assert.match(html, /beats Dodge/);
    assert.match(html, /beats Strike/);
    assert.match(html, /beats Guard/);
});

test("an unanswered prompt is live; an answered one locks every button", () => {
    // Counted on the BUTTON tag, not anywhere in the markup: the inline <style>
    // block contains `:not(:disabled)`, which a bare /disabled/ match picks up.
    const disabledButtons = (html: string) => (html.match(/<button[^>]*\sdisabled/g) ?? []).length;

    const open = render({ pick: -1 });
    assert.equal(disabledButtons(open), 0, "an open read must be answerable");
    assert.match(open, /Read your opponent/);

    const locked = render({ pick: 1 });
    // All three lock together — a call cannot be taken back, which is what stops a
    // PvP player re-picking after seeing their opponent commit.
    assert.equal(disabledButtons(locked), 3, "every call must lock once one is made");
});

test("PvP copy waits on the opponent; PvE copy does not", () => {
    const pvp = render({ pick: 0, versusPlayer: true, foeCommitted: false });
    assert.match(pvp, /waiting on Tide/, "PvP must say the bind is waiting on the other player");

    const pvpBoth = render({ pick: 0, versusPlayer: true, foeCommitted: true });
    assert.match(pvpBoth, /Both calls are in/);

    const pve = render({ pick: 0, versusPlayer: false });
    assert.match(pve, /brace for it/, "PvE resolves immediately, so it must not promise a wait");
    assert.doesNotMatch(pve, /waiting on/);
});

test("a committed opponent is announced without revealing the call", () => {
    const html = render({ pick: -1, versusPlayer: true, foeCommitted: true });
    assert.match(html, /Tide has committed/);
    // Knowing WHICH read they made would turn a simultaneous choice into a reaction
    // test, so the pick must never reach the markup.
    assert.doesNotMatch(html, /Tide has committed[^<]*(Strike|Guard|Dodge)/);
});
