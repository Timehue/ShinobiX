import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPetEncounterVn } from "../data/default-vn-events";
import { rawPetPool } from "../data/pet-pool";
import type { CreatorEvent } from "../types/vn";
import { buildPetEncounterVn } from "./pet-encounter-vn";

function staleTemplate(): CreatorEvent {
    return {
        ...defaultPetEncounterVn,
        avatarImage: "/portraits/narrator.webp",
        vnPages: defaultPetEncounterVn.vnPages!.map((page) => ({
            ...page,
            leftName: "Narrator",
            leftImage: "/api/img?id=vn%3Asys-pet-encounter%3Apage%3A0%3Aleft",
            rightImage: "/api/img?id=vn%3Asys-pet-encounter%3Apage%3A0%3Aright",
        })),
    };
}

test("pet encounters replace stale narrator art with the discovered Wild Boar on every page", () => {
    const image = "/pet-poses/standard-9-idle.webp?v=4";
    const event = buildPetEncounterVn(staleTemplate(), { name: "Wild Boar" }, image);
    assert.equal(event.avatarImage, image);
    assert.equal(event.vnSpeaker, "Narrator");
    for (const page of event.vnPages!) {
        assert.equal(page.leftName, "Player");
        assert.equal(page.leftImage, undefined);
        assert.equal(page.rightName, "Wild Boar");
        assert.equal(page.rightImage, image);
        assert.equal(page.speaker, "Narrator");
    }
});

test("every built-in pet and an encounter instance keep their own name and resolved image", () => {
    const template = staleTemplate();
    assert.ok(rawPetPool.length >= 145);
    for (const pet of [...rawPetPool, { name: "Copper", id: "owned-instance-123" }]) {
        const image = `/api/img?id=pet%3A${pet.id}`;
        const event = buildPetEncounterVn(template, pet, image);
        for (const page of event.vnPages!) {
            assert.equal(page.rightName, pet.name, pet.id);
            assert.equal(page.rightImage, image, pet.id);
        }
    }
});

test("an encounter without pet art never reuses a template actor portrait", () => {
    const event = buildPetEncounterVn(staleTemplate(), { name: "Wild Boar" }, "");
    assert.equal(event.avatarImage, "");
    for (const page of event.vnPages!) {
        assert.equal(page.leftImage, undefined);
        assert.equal(page.rightImage, undefined);
        assert.equal(page.rightName, "Wild Boar");
    }
});

test("legacy Player-on-right staging cannot swap the pet with a saved narrator", () => {
    const template = staleTemplate();
    template.vnPages![0].rightName = "Player";
    const event = buildPetEncounterVn(template, { name: "Red Fox" }, "/pet-poses/standard-0-idle.webp");
    assert.equal(event.vnPages![0].leftName, "Player");
    assert.equal(event.vnPages![0].rightName, "Red Fox");
    assert.equal(event.vnPages![0].rightImage, "/pet-poses/standard-0-idle.webp");
});

test("binding preserves authored content and does not mutate the template", () => {
    const template = staleTemplate();
    template.id = "pet-encounter";
    template.biome = "desert";
    template.image = "/scenes/forest.webp";
    template.cinematic = { atmosphere: "mist", shot: "wide" };
    const page = template.vnPages![0];
    page.image = "/scenes/trail.webp";
    page.cinematic = { focus: "right", rightActorPose: "tense" };
    page.lines = [{ speaker: "Narrator", text: "The brush moves.", cinematic: { cue: "reveal" } }];
    page.choices = [{ text: "Wait", nextPage: 1, trait: "patient" }];
    const original = structuredClone(template);
    const event = buildPetEncounterVn(template, { name: "Wild Boar" }, "/pet-poses/standard-9-idle.webp");

    assert.deepEqual(template, original);
    assert.notEqual(event, template);
    assert.notEqual(event.vnPages, template.vnPages);
    assert.equal(event.id, "sys-pet-encounter");
    assert.equal(event.biome, "forest");
    assert.equal(event.image, template.image);
    assert.deepEqual(event.cinematic, template.cinematic);
    for (let index = 0; index < template.vnPages!.length; index++) {
        const source = template.vnPages![index];
        const actual = event.vnPages![index];
        assert.notEqual(actual, source);
        for (const key of ["title", "scene", "speaker", "dialogue", "lines", "image", "cinematic", "choices"] as const) {
            assert.deepEqual(actual[key], source[key], key);
        }
    }
});

test("a legacy encounter without pages creates one page from its authored event", () => {
    const template = {
        ...defaultPetEncounterVn,
        vnPages: [],
        vnTitle: "A rustle nearby",
        vnScene: "The forest trail",
        vnSpeaker: "Narrator",
        dialogue: ["Narrator: An animal steps out."],
    };
    const event = buildPetEncounterVn(template, { name: "Wild Boar" }, "/pet-poses/standard-9-idle.webp");
    assert.equal(event.vnPages!.length, 1);
    assert.deepEqual(event.vnPages![0], {
        title: template.vnTitle,
        scene: template.vnScene,
        speaker: template.vnSpeaker,
        dialogue: template.dialogue,
        leftName: "Player",
        leftImage: undefined,
        rightName: "Wild Boar",
        rightImage: "/pet-poses/standard-9-idle.webp",
    });
});
