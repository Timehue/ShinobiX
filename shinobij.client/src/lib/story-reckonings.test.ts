import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Character } from "../types/character.js";
import type { Biome } from "../types/core.js";
import { storyReckoningById, storyReckonings } from "../data/story-reckonings.js";
import { storyReckoningEligible, visibleStoryReckonings, storyReckoningIntroEvent, storyReckoningForEventId } from "./story-reckonings.js";
import { defaultVnPortrait } from "./vn.js";
import { storyFieldScenes } from "../data/story-field-scenes.js";
import { STORY_FIELD_CONTENT_SCHEMA_VERSION } from "./story-field-content-contract.js";
import { seedStoryFieldContentForTests } from "./story-field-content-loader.js";

seedStoryFieldContentForTests({ schemaVersion: STORY_FIELD_CONTENT_SCHEMA_VERSION, scenes: storyFieldScenes, reckonings: storyReckonings });

const PUBLIC_DIR = path.resolve(process.cwd(), "shinobij.client/public");

test("story reckonings expose current-canon Stormveil NPCs at eligible outskirts", () => {
    const character = {
        level: 58,
        storyVillage: "Stormveil Village",
        storyProgress: 5,
        storyTraits: [],
    } as Character;
    const visible = visibleStoryReckonings(character, 1);
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
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [], redeemedStoryReckonings: [{ questId: quest.id }] } as Character, quest), false);
    const receiptOnly = { level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [], redeemedStoryReckonings: [{ questId: quest.id }] } as Character;
    assert.ok(visibleStoryReckonings(receiptOnly, 1).some((wanderer) => wanderer.id === quest.id), "receipt-only field completions keep their aftermath giver visible");
});

test("story reckoning VN accept uses the sentinel and return ids map back to the arc", () => {
    const quest = storyReckoningById("story-reckoning-vanta-ninth");
    assert.ok(quest);
    const event = storyReckoningIntroEvent(quest, "coast" as Biome);
    const choices = event.vnPages?.at(-1)?.choices ?? [];
    assert.ok(choices.some((choice) => choice.trait === "__story-reckoning-accept"));
    assert.equal(storyReckoningForEventId("story-reckoning-vanta-ninth-return")?.id, quest.id);
});

test("every reckoning giver and hunt-target portrait file exists", () => {
    for (const quest of storyReckonings) {
        const giver = defaultVnPortrait(quest.npcName);
        assert.ok(giver, `${quest.npcName} should resolve a portrait`);
        assert.equal(existsSync(path.join(PUBLIC_DIR, giver.replace(/^\//, ""))), true, `${quest.npcName} portrait ${giver} should exist`);
        const boss = quest.task.boss?.portrait;
        if (boss) assert.equal(existsSync(path.join(PUBLIC_DIR, boss.replace(/^\//, ""))), true, `${boss} should exist`);
    }
});

test("each village exposes its own reckoning NPCs at its outskirts", () => {
    // outskirts sectors (2026-07 numbering): Stormveil 1, Ashen Leaf 9,
    // Frostfang 26, Moonshadow 17 — each village's block starts at its gate.
    const cases: Array<[string, number, number, string[]]> = [
        ["Ashen Leaf Village", 9, 58, ["Elder Mori", "Toma Reed"]],
        ["Frostfang Village", 26, 58, ["Captain Yura", "Elder Sova"]],
        ["Moonshadow Village", 17, 58, ["Nyx", "Shade Master Iro"]],
    ];
    for (const [village, sector, level, expected] of cases) {
        const character = { level, storyVillage: village, storyProgress: 5, storyTraits: [] } as Character;
        const visible = visibleStoryReckonings(character, sector).map((w) => w.name).sort();
        assert.deepEqual(visible, expected, `${village} should show ${expected.join(", ")}`);
    }
});

test("cross-village Kite Harrow stands at any outskirts once own arc is done, and is gated below it", () => {
    const harrow = storyReckoningById("story-reckoning-harrow-unbought");
    assert.ok(harrow?.crossVillage);
    // Eligible: level 65, progress 9, at a DIFFERENT village's outskirts (Frostfang 26).
    const ready = { level: 65, storyVillage: "Frostfang Village", storyProgress: 9, storyTraits: [] } as Character;
    assert.ok(visibleStoryReckonings(ready, 26).some((w) => w.name === "Kite Harrow"), "Harrow should appear cross-village when eligible");
    // Gated: one progress short.
    const notYet = { level: 65, storyVillage: "Frostfang Village", storyProgress: 8, storyTraits: [] } as Character;
    assert.ok(!visibleStoryReckonings(notYet, 26).some((w) => w.name === "Kite Harrow"), "Harrow should be hidden below the progress gate");
});

test("conditional reckoning callbacks keep each source choice on the player", () => {
    const cases = [
        ["story-reckoning-mori-working-copy", "al58-refused-the-cut", /I refused the cut/],
        ["story-reckoning-sova-true-roll", "ff42-held-the-doubt", /I held my doubt/],
        ["story-reckoning-yura-exemption", "ff58-took-the-exemption", /I took the exemption/],
        ["story-reckoning-iro-sealed-shelf", "ms58-took-the-shelf", /I took the shelf/],
    ] as const;
    for (const [id, trait, expected] of cases) {
        const quest = storyReckoningById(id);
        assert.ok(quest, id);
        const choice = quest.payoff.flatMap(page => page.choices ?? []).find(candidate => candidate.requireTrait === trait);
        assert.ok(choice, trait);
        assert.match(choice.text, expected, trait);
    }
});

test("reckoning speakers do not introduce themselves with third-person staging", () => {
    for (const quest of storyReckonings) {
        for (const page of [...quest.intro, ...quest.payoff]) {
            const surname = page.speaker.split(/\s+/).at(-1)!;
            assert.ok(!page.dialogue[0]?.startsWith(`${surname} `), `${quest.id}/${page.title} stages ${surname} under their own portrait`);
        }
    }
});
