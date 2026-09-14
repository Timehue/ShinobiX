import { test } from "node:test";
import assert from "node:assert/strict";
import { ECHOES_ERA_INTROS, ECHOES_SCENES, ECHOES_WITNESS_CONTENT } from "../data/echoes-of-war-scenes";
import { echoesReactiveEraIntro, echoesReactiveVictory } from "./echoes-witness-scenes";

test("only an authoritative era-close beat adds a concrete match callback", () => {
    const ordinary = echoesReactiveVictory("echoes-2-vetta", ECHOES_SCENES["echoes-2-vetta"].firstVictory, "denied-attack", {}, ECHOES_WITNESS_CONTENT);
    assert.equal(ordinary.length, ECHOES_SCENES["echoes-2-vetta"].firstVictory.length);

    const close = echoesReactiveVictory("echoes-3-aya", ECHOES_SCENES["echoes-3-aya"].firstVictory, "recovered-ground", {}, ECHOES_WITNESS_CONTENT);
    assert.equal(close[1].title, "What the Table Kept");
    assert.match(close[1].dialogue.join(" "), /took the hit.*line came back/i);
});

test("later intros acknowledge only a sealed preceding answer", () => {
    const untouched = echoesReactiveEraIntro("echoes-age-2", ECHOES_ERA_INTROS["echoes-age-2"], {}, ECHOES_WITNESS_CONTENT)!;
    assert.equal(untouched.length, ECHOES_ERA_INTROS["echoes-age-2"].length);
    const answered = echoesReactiveEraIntro("echoes-age-2", ECHOES_ERA_INTROS["echoes-age-2"], { "echoes-age-1": "names-first" }, ECHOES_WITNESS_CONTENT)!;
    assert.equal(answered[1].title, "What You Carried Up");
    assert.match(answered[1].dialogue.join(" "), /kept their names/i);
});

test("Halden answers the specific earlier records and never invents missing ones", () => {
    const pages = echoesReactiveVictory("echoes-10-halden", ECHOES_SCENES["echoes-10-halden"].firstVictory, "unrecorded", {
        "echoes-age-1": "cause-open",
        "echoes-age-3": "outcome-open",
    }, ECHOES_WITNESS_CONTENT);
    const acknowledgement = pages.find(({ title }) => title === "The Record You Brought");
    assert.ok(acknowledgement);
    assert.equal(acknowledgement.dialogue.length, 2);
    assert.match(acknowledgement.dialogue[0], /could not see/i);
    assert.match(acknowledgement.dialogue[1], /stolen verdict unwritten/i);
});
