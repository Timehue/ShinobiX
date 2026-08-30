import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TownHall.tsx", import.meta.url), "utf8");

test("the active elder focus is status text, not a repeatable action", () => {
    assert.match(source, /character\.elderFocus === elderFocusKey \|\| elderFocusBusyRef\.current/);
    assert.match(source, /<div className="town-elder-selected" role="status">/);
    assert.match(source, /: <button type="button" disabled=\{elderFocusBusy !== null\}/);
    assert.doesNotMatch(source, /War focus active" : "Select focus"/);
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
