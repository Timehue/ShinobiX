import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TownHall.tsx", import.meta.url), "utf8");

test("the active elder focus is status text, not a repeatable action", () => {
    assert.match(source, /selectedElderFocus === elderFocusKey \|\| elderFocusBusyRef\.current/);
    assert.match(source, /<div className="town-elder-selected" role="status">/);
    assert.match(source, /: <button type="button" disabled=\{elderFocusBusy !== null \|\| elderAppointmentBusy !== null\}/);
    assert.doesNotMatch(source, /War focus active" : "Select focus"/);
});

test("AI elders have no focus action or bonus, and only the Kage sees appointment controls", () => {
    assert.match(source, /const available = elderSeatsReady && Boolean\(appointee\)/);
    assert.match(source, /available \? option\.bonus : "0 bonus · No focus"/);
    assert.match(source, /!available[\s\S]*town-elder-locked[\s\S]*: active/);
    assert.match(source, /isSeatedKage && index === 0 && <div className="town-elder-appointment">/);
    assert.match(source, /!elderFocusForSeats\(elderFocusKey, elderSeats\)/);
});

test("elder contribution is awarded only after the authoritative save is adopted", () => {
    const handler = source.slice(
        source.indexOf("async function supportVillageFocus"),
        source.indexOf("function updateAnbuAppointmentInput"),
    );
    assert.ok(handler.indexOf("onVersionedCharacter") < handler.indexOf("contributionPoints: state.contributionPoints + 10"));
    assert.match(handler, /elderFocusBusyRef\.current = true/);
    assert.match(handler, /finally \{[\s\S]*elderFocusBusyRef\.current = false/);
});
