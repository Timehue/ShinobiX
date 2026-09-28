import { test } from "node:test";
import assert from "node:assert/strict";
import { departureNarrative } from "./departure-narrative";
import { AWAKENING_VN_ID } from "../constants/game";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";

const hero = (over: Partial<Character> = {}) => ({ level: 2, onboardingStep: "done", elements: [], ...over }) as unknown as Character;
const leaveVn = { id: "creator-leave", eventKind: "visualNovel", trigger: "firstLeaveVillage", levelReq: 1 } as unknown as CreatorEvent;

test("the Awakening Stone opens before an unawakened player's first trip to Central Hub", () => {
    const opened = departureNarrative({ character: hero(), screen: "worldMap", nextScreen: "centralHub", triggeredEvents: [], creatorEvents: [] });
    assert.equal(opened?.id, AWAKENING_VN_ID);
    assert.equal(departureNarrative({ character: hero(), screen: "worldMap", nextScreen: "centralHub", triggeredEvents: [AWAKENING_VN_ID], creatorEvents: [] }), null,
        "it plays once");
    assert.equal(departureNarrative({ character: hero({ elements: ["Fire"] } as Partial<Character>), screen: "worldMap", nextScreen: "centralHub", triggeredEvents: [], creatorEvents: [] }), null,
        "an awakened player walks straight in");
});

test("a first-departure story fires only when actually leaving the village", () => {
    const awakened = hero({ elements: ["Fire"] } as Partial<Character>);
    assert.equal(departureNarrative({ character: awakened, screen: "village", nextScreen: "worldMap", triggeredEvents: [AWAKENING_VN_ID], creatorEvents: [leaveVn] })?.id, "creator-leave");
    assert.equal(departureNarrative({ character: hero(), screen: "worldMap", nextScreen: "centralHub", triggeredEvents: [AWAKENING_VN_ID], creatorEvents: [leaveVn] }), null);
});

test("nothing interrupts the Academy tutorial or a level-one player", () => {
    assert.equal(departureNarrative({ character: hero({ onboardingStep: "academySpar" } as Partial<Character>), screen: "village", nextScreen: "centralHub", triggeredEvents: [], creatorEvents: [leaveVn] }), null);
    assert.equal(departureNarrative({ character: hero({ level: 1 }), screen: "worldMap", nextScreen: "centralHub", triggeredEvents: [], creatorEvents: [] }), null);
    assert.equal(departureNarrative({ character: null, screen: "village", nextScreen: "worldMap", triggeredEvents: [], creatorEvents: [leaveVn] }), null);
});
