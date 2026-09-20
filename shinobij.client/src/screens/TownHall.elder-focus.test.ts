import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TownHall.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/town-hall-aaa.css", import.meta.url), "utf8");

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

test("the acting council uses story art while an unlocked vacant Kage seat stays empty", () => {
    assert.match(source, /const displayedKageImage = state\.seatedKage[\s\S]*\? getLeaderImage\(state\.seatedKage, ""\)[\s\S]*: state\.kageSystemUnlocked[\s\S]*\? ""[\s\S]*: leadershipImages\.kage \?\? ""/);
    assert.match(source, /const displayedKageIsNpc = !state\.seatedKage && Boolean\(displayedKageImage\)/);
    assert.equal(source.match(/<LeaderPortrait image=\{displayedKageImage\}/g)?.length, 2);
    assert.equal(source.match(/data-npc=\{displayedKageIsNpc\}/g)?.length, 2);
});

test("cinematic NPC portraits keep their faces inside the square crop", () => {
    assert.match(styles, /\.town-leader-row\[data-npc="true"\] \.leader-portrait-img\s*\{[\s\S]*?object-position:\s*center top/);
    assert.match(styles, /\.town-elder-portrait\[data-npc="true"\] \.leader-portrait-img\s*\{[\s\S]*?object-position:\s*center top/);
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
