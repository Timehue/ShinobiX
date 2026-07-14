import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Character } from "../types/character.js";
import type { Biome } from "../types/core.js";
import { storyReckoningById } from "../data/story-reckonings.js";
import { storyReckoningEligible, visibleStoryReckonings, storyReckoningIntroEvent, storyReckoningForEventId } from "./story-reckonings.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "shinobij.client/public");

test("story reckonings expose current-canon Stormveil NPCs at eligible outskirts", () => {
    const character = {
        level: 58,
        storyVillage: "Stormveil Village",
        storyProgress: 5,
        storyTraits: [],
    } as Character;
    const visible = visibleStoryReckonings(character, 31);
    assert.deepEqual(visible.map((w) => w.name).sort(), ["Elder Vanta", "Mira Volt"]);
    assert.equal(visible.find((w) => w.name === "Elder Vanta")?.avatarImage, "/portraits/elder-vanta.webp");
    assert.equal(visible.find((w) => w.name === "Mira Volt")?.avatarImage, "/portraits/mira-volt.webp");
});

test("story reckoning character portraits exist for every authored character", () => {
    const vanta = storyReckoningById("story-reckoning-vanta-ninth");
    const mira = storyReckoningById("story-reckoning-mira-marker");
    assert.ok(vanta);
    assert.ok(mira);
    const portraits = [
        "/portraits/elder-vanta.webp",
        "/portraits/mira-volt.webp",
        vanta.task.boss?.portrait,
    ].filter(Boolean);
    for (const portrait of portraits) {
        assert.equal(existsSync(path.join(PUBLIC_DIR, portrait!.replace(/^\//, ""))), true, `${portrait} should exist`);
    }
});

test("story reckoning eligibility retires completed arcs", () => {
    const quest = storyReckoningById("story-reckoning-mira-marker");
    assert.ok(quest);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] } as Character, quest), true);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [quest.completionTrait] } as Character, quest), false);
});

test("story reckoning VN accept uses the sentinel and return ids map back to the arc", () => {
    const quest = storyReckoningById("story-reckoning-vanta-ninth");
    assert.ok(quest);
    const event = storyReckoningIntroEvent(quest, "coast" as Biome);
    const choices = event.vnPages?.at(-1)?.choices ?? [];
    assert.ok(choices.some((choice) => choice.trait === "__story-reckoning-accept"));
    assert.equal(storyReckoningForEventId("story-reckoning-vanta-ninth-return")?.id, quest.id);
});
