import assert from "node:assert/strict";
import test from "node:test";
import { petColiseumWeatherDurationTicks, petColiseumWeatherForMove } from "./pet-coliseum-weather";

test("weather techniques change the whole battlefield by their named climate", () => {
    assert.equal(petColiseumWeatherForMove("Phoenix Firestorm", "damage")?.kind, "firestorm");
    assert.equal(petColiseumWeatherForMove("Phoenix Ashfall", "damage")?.kind, "firestorm");
    assert.equal(petColiseumWeatherForMove("Skyglass Tempest", "damage")?.kind, "thunderstorm");
    assert.equal(petColiseumWeatherForMove("Heaven Crow Storm", "damage")?.kind, "thunderstorm");
    assert.equal(petColiseumWeatherForMove("Worldstorm: Heaven's End", "crush")?.kind, "thunderstorm");
    assert.equal(petColiseumWeatherForMove("Tidal Monsoon", "damage")?.kind, "downpour");
    assert.equal(petColiseumWeatherForMove("Leviathan Deluge", "damage")?.kind, "downpour");
    assert.equal(petColiseumWeatherForMove("Winter Whiteout", "freeze")?.kind, "blizzard");
    assert.equal(petColiseumWeatherForMove("Eclipse Fang", "damage")?.kind, "eclipse");
    assert.equal(petColiseumWeatherForMove("Sunfall Judgment", "damage")?.kind, "eclipse");
    assert.equal(petColiseumWeatherForMove("Cyclone Break", "push")?.kind, "gale");
    assert.equal(petColiseumWeatherForMove("Kirin Gale", "damage")?.kind, "gale");
});

test("weather words on support and movement techniques stay local", () => {
    assert.equal(petColiseumWeatherForMove("Storm Aegis", "barrier"), null);
    assert.equal(petColiseumWeatherForMove("Storm King Aura", "buff"), null);
    assert.equal(petColiseumWeatherForMove("Stormrider Lunge", "move"), null);
    assert.equal(petColiseumWeatherForMove("Force Pulse", "damage"), null);
});

test("weather duration owns several seconds of arena time", () => {
    assert.equal(petColiseumWeatherDurationTicks(30), 255);
});
