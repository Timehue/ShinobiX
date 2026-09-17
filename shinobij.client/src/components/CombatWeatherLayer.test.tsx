import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CombatWeatherLayer } from "./CombatWeatherLayer";

test("a clear sky (or none) mounts no weather layer at all", () => {
    assert.equal(renderToStaticMarkup(<CombatWeatherLayer biome="forest" weather="clear" />), "");
    assert.equal(renderToStaticMarkup(<CombatWeatherLayer biome="forest" weather={null} />), "");
    assert.equal(renderToStaticMarkup(<CombatWeatherLayer biome="forest" weather={undefined} />), "");
});

test("a real sky mounts one click-through ambience canvas tagged with the weather", () => {
    const html = renderToStaticMarkup(<CombatWeatherLayer biome="snow" weather="rain" />);
    assert.match(html, /class="combat-weather-layer combat-weather-rain"/);
    assert.match(html, /data-combat-weather="rain"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /--combat-weather-opacity:0\.6/);
    assert.match(html, /scene-ambience combat-weather-ambience/);
    assert.equal((html.match(/<canvas/g) ?? []).length, 1, "exactly one canvas per fight");
});

test("an arena biome SceneAmbience does not know falls back to the central sky art", () => {
    const html = renderToStaticMarkup(<CombatWeatherLayer biome="deathsgate" weather="ashfall" />);
    assert.match(html, /scene-rays-central/);
});
