import { test } from "node:test";
import assert from "node:assert/strict";
import { storylines } from "./storylines";
import { storyRoadEvents } from "./story-road-events";
import { storyInterludesByVillage } from "./story-interludes";
import { storyEpiloguesByVillage } from "./story-epilogues";
import { storyReckonings } from "./story-reckonings";
import { hollowRifts } from "./hollow-rifts";
import { awakeningLv2VnEvent, auraSphereLv9VnEvent, craftDungeonEvents, hiddenDungeonVnEvent } from "./vn-events";
import { defaultAncientChestVn, defaultPetEncounterVn } from "./default-vn-events";
import { hidePlayerPortraitDuringNarration, splitDialogueLine } from "../lib/vn";
import { hollowGateFloorProfile } from "../lib/hollow-gate-presentation";
import { EMISSARY_DEFS } from "../lib/legacy-emissaries";
import { RUMOR_CATEGORIES, TAVERN_GOSSIP, rumorArc } from "../lib/legacy-rumors";
import { rollWanderers } from "../lib/wanderers";
import { ERA_DEFS } from "../../../api/_era-defs";
import { HOLLOW_GATE_DEPTH } from "../../../shared/hollow-gate-contract";
import { SECTOR_PLACES } from "../../../shared/sector-geo";
import { SHRINE_DEFS } from "../../../shared/shrines";

type PageLike = {
    title?: string;
    scene?: string;
    speaker: string;
    dialogue: string[];
    leftName?: string;
    leftImage?: string;
    rightName?: string;
    rightImage?: string;
    choices?: Array<{ text?: string; conclusion?: string }>;
};

const pages: PageLike[] = [
    ...Object.values(storylines).flatMap((steps) => steps.flatMap((step) => step.pages)),
    ...storyRoadEvents.flatMap((event) => event.pages),
    ...Object.values(storyInterludesByVillage).flatMap((events) => events.flatMap((event) => event.pages)),
    ...Object.values(storyEpiloguesByVillage).flatMap((events) => events.flatMap((event) => event.pages)),
    ...storyReckonings.flatMap((event) => [...event.intro, ...event.payoff]),
    ...hollowRifts.flatMap((rift) => [...rift.intro, ...rift.descent]),
    ...[
        awakeningLv2VnEvent,
        auraSphereLv9VnEvent,
        hiddenDungeonVnEvent,
        ...craftDungeonEvents,
        defaultAncientChestVn,
        defaultPetEncounterVn,
    ].flatMap((event) => event.vnPages ?? []),
];

function visiblePageText(page: PageLike): string[] {
    return [
        page.title ?? "",
        page.scene ?? "",
        page.speaker,
        ...page.dialogue,
        ...(page.choices?.flatMap((choice) => [choice.text ?? "", choice.conclusion ?? ""]) ?? []),
    ];
}

test("story narration suppresses every generic Player portrait across the catalog", () => {
    let narratorPlayerSlots = 0;
    for (const page of pages) {
        for (const line of page.dialogue) {
            const speaker = splitDialogueLine(line, page.speaker).speaker;
            if (speaker.trim().toLowerCase() !== "narrator") continue;
            const savedRightWasPlayer = page.rightName?.trim().toLowerCase() === "player";
            const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
            const rightName = savedRightWasPlayer
                ? (page.leftName || page.speaker || speaker)
                : (page.rightName || page.speaker || speaker);
            const leftAuthoredImage = savedRightWasPlayer ? undefined : page.leftImage;
            const rightAuthoredImage = savedRightWasPlayer
                ? (page.leftImage || page.rightImage)
                : page.rightImage;

            if (leftName.trim().toLowerCase() === "player" && !leftAuthoredImage?.trim()) {
                narratorPlayerSlots += 1;
                assert.equal(hidePlayerPortraitDuringNarration(speaker, leftName, leftAuthoredImage), true);
            }
            if (rightName.trim().toLowerCase() === "player" && !rightAuthoredImage?.trim()) {
                narratorPlayerSlots += 1;
                assert.equal(hidePlayerPortraitDuringNarration(speaker, rightName, rightAuthoredImage), true);
            }
        }
    }
    assert.ok(narratorPlayerSlots >= 500, `expected broad narrator coverage, found ${narratorPlayerSlots}`);
});

test("story and event copy uses shinobi-world language instead of generic fantasy or raw game terms", () => {
    const playerFacingCopy = pages.flatMap(visiblePageText).join("\n");
    assert.doesNotMatch(playerFacingCopy, /\bpilgrims?\b/i);
    assert.doesNotMatch(playerFacingCopy, /\b(?:wizard|paladin|cleric|sorcerer|adventurer|quest giver)s?\b/i);
    assert.doesNotMatch(playerFacingCopy, /\b(?:shinobi\s+)?level\s+\d+\b|\blevel of strength\b|\bshinobi tile game\b/i);
    assert.doesNotMatch(playerFacingCopy, /priests read entrails|more dangerous pilgrim/i);
    assert.match(playerFacingCopy, /shrine keeper/i);
    assert.match(playerFacingCopy, /field record/i);
    assert.match(playerFacingCopy, /Shinobi Chronicle Showdown/);
    assert.match(playerFacingCopy, /sealed record has always cut deeper than an open blade/i);
});

test("adjacent world lore, wanderers, shrines, and era events expose no pilgrim terminology", () => {
    const floorCopy = Array.from({ length: HOLLOW_GATE_DEPTH }, (_, index) =>
        Object.values(hollowGateFloorProfile(index + 1)).filter((value): value is string => typeof value === "string")
    ).flat();
    const emissaryCopy = EMISSARY_DEFS.flatMap((def) => [
        def.name,
        def.greeting,
        ...def.lore,
        def.trialLine,
        ...def.quests.map((quest) => quest.label),
    ]);
    const rumorCopy = RUMOR_CATEGORIES.flatMap((category) => rumorArc(category)?.flat() ?? []);
    const wandererCopy = Array.from({ length: 66 }, (_, sectorIndex) =>
        Array.from({ length: 96 }, (_, bucket) => rollWanderers(sectorIndex + 1, bucket))
    ).flat(2).flatMap((wanderer) => [wanderer.name, wanderer.greeting]);
    const eraCopy = ERA_DEFS.flatMap((era) => [
        era.name,
        era.description,
        era.lore,
        ...era.chronicle,
        ...era.milestones.map((milestone) => milestone.label),
        era.unlockTitle,
        era.unlockMessage,
    ]);
    const worldCopy = [
        ...SHRINE_DEFS.flatMap((shrine) => [shrine.name, shrine.region, shrine.lore, shrine.blessing]),
        ...SECTOR_PLACES.map((sector) => sector.name),
        ...floorCopy,
        ...emissaryCopy,
        ...rumorCopy,
        ...TAVERN_GOSSIP,
        ...wandererCopy,
        ...eraCopy,
    ].join("\n");

    assert.doesNotMatch(worldCopy, /\bpilgrims?\b/i);
    assert.doesNotMatch(worldCopy, /\b(?:shinobi\s+)?level\s+\d+\b|\blevel of strength\b/i);
    assert.match(worldCopy, /Lantern Approach/);
    assert.match(worldCopy, /Iron Disciple Daigo/);
    assert.match(worldCopy, /The Shinobi Roll/);
});
