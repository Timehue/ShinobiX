import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenLoadingFallback } from "./ScreenLoadingFallback";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// A refresh mid-trip reopens the World Map, which is a lazy chunk. The trip keeps
// running in real time while it downloads, so on a slow load the generic card used
// to cover the entire remaining trip and "Traveling" never appeared at all.

test("the World Map fallback shows the traveling mask during a trip", () => {
    const html = renderToStaticMarkup(<ScreenLoadingFallback screen="worldMap" travelingUntil={Date.now() + 3_000} />);
    assert.match(html, /<h2>Traveling<\/h2>/);
    assert.doesNotMatch(html, /Loading World Map/);
});

test("the World Map fallback is the ordinary loading card when no trip is running", () => {
    const html = renderToStaticMarkup(<ScreenLoadingFallback screen="worldMap" travelingUntil={0} />);
    assert.match(html, /Loading World Map/);
    assert.doesNotMatch(html, /Traveling/);
    assert.match(renderToStaticMarkup(<ScreenLoadingFallback screen="worldMap" />), /Loading World Map/);
});

test("only the World Map borrows the mask; other screens keep their own card", () => {
    const html = renderToStaticMarkup(<ScreenLoadingFallback screen="bank" travelingUntil={Date.now() + 3_000} />);
    assert.match(html, /Loading Bank/);
    assert.doesNotMatch(html, /Traveling/);
});

test("App hands the fallback the live trip deadline, and nothing once it has ended", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(app, /<ScreenLoadingFallback screen=\{screen\} travelingUntil=\{isTraveling \? travelingUntil : 0\} \/>/);
});
