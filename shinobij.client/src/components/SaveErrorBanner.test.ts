import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveErrorBanner } from "./SaveErrorBanner";
import { SAVE_REFRESH_REQUIRED, type SaveBlockedState } from "../lib/save-persistence";

// The root test runner compiles JSX with the classic runtime, and the banner
// (built with the automatic runtime in Vite) does not import React itself.
(globalThis as { React?: typeof React }).React = React;

const render = (visible: SaveBlockedState) => renderToStaticMarkup(createElement(SaveErrorBanner, { visible }));

test("the save-error banner renders nothing while saves land", () => {
    assert.equal(render(false), "");
});

test("a retrying failure (413/5xx/network) tells the player NOT to refresh", () => {
    const html = render(true);
    assert.match(html, /role="alert"/);
    assert.match(html, /saving retries automatically/);
    assert.match(html, /Do <strong>not<\/strong> refresh/);
});

test("a 426 tells the player to refresh, and never says saving retries", () => {
    const html = render(SAVE_REFRESH_REQUIRED);
    assert.match(html, /role="alert"/);
    assert.match(html, /Your game client is out of date\. Please refresh the page to keep saving\./);
    assert.doesNotMatch(html, /retries automatically/);
    assert.doesNotMatch(html, /not<\/strong> refresh/);
});
