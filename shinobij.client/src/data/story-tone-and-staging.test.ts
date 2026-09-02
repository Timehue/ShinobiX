import { test } from "node:test";
import assert from "node:assert/strict";
import { storylines } from "./storylines";
import { storyRoadEvents } from "./story-road-events";
import { storyInterludesByVillage } from "./story-interludes";
import { storyEpiloguesByVillage } from "./story-epilogues";
import { storyReckonings } from "./story-reckonings";
import { hollowRifts } from "./hollow-rifts";
import { ECHOES_ERA_INTROS, ECHOES_SCENES } from "./echoes-of-war-scenes";
import { ECHOES_HERO_COPY } from "./echoes-of-war";
import { awakeningLv2VnEvent, auraSphereLv9VnEvent, craftDungeonEvents, hiddenDungeonVnEvent } from "./vn-events";
import { defaultAncientChestVn, defaultPetEncounterVn } from "./default-vn-events";
import { hidePlayerPortraitDuringNarration, splitDialogueLine } from "../lib/vn";
import { hollowGateFloorProfile } from "../lib/hollow-gate-presentation";
import { EMISSARY_DEFS } from "../lib/legacy-emissaries";
import { RUMOR_CATEGORIES, TAVERN_GOSSIP, rumorArc } from "../lib/legacy-rumors";
import { rollWanderers } from "../lib/wanderers";
import { buildSageVnEvent } from "../lib/legacy-sage-vn";
import { QUEST_BOOK } from "../lib/questbook";
import { scribeIntroEvent } from "../lib/chronicle-scribe";
import { hollowGateFlavorPool, hollowGateIntroPages } from "./hollow-gate-flavor";
import { builtinFetchMissions, builtinHuntMissions } from "./missions";
import { clanLore } from "./clan-lore";
import { GUIDES } from "./guides";
import {
    PRE_GIFT_LINES,
    VILLAGE_LORE_LINES,
    COMPANION_VILLAGE_FLAVOR,
    buildCompanionIntroLines,
    buildPostGiftLines,
} from "../features/intro-cinematic/introCinematicScript";
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
    ...Object.values(ECHOES_SCENES).flatMap((scenes) => [
        ...scenes.preShowdown, ...scenes.defeat, ...scenes.firstVictory, ...scenes.rematch,
    ]),
    // The Age intro VNs are authored content too and MUST ride every tone gate
    // (zero-dash, shinobi-language, AI-mysticism, portrait-suppression). They
    // are also the highest-risk spot for Hollow-Gate origin drift, so the canon
    // guard in story-content.test.ts scans them as well.
    ...Object.values(ECHOES_ERA_INTROS).flat(),
    // The mode's landing copy is authored player-facing text too (held as data
    // in ECHOES_HERO_COPY so it can be scanned). The "not their souls" subtitle
    // does the heaviest canon work in the feature, so it must be gated here and
    // in the Gate-origin corpus.
    { speaker: "Narrator", dialogue: [ECHOES_HERO_COPY.eyebrow, ECHOES_HERO_COPY.subtitle, ECHOES_HERO_COPY.footnote] },
    ...[
        awakeningLv2VnEvent,
        auraSphereLv9VnEvent,
        hiddenDungeonVnEvent,
        ...craftDungeonEvents,
        defaultAncientChestVn,
        defaultPetEncounterVn,
        scribeIntroEvent("central"),
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

function guideText(): string[] {
    return GUIDES.flatMap((guide) => [
        guide.title,
        guide.tagline,
        guide.blurb,
        ...guide.sections.flatMap((section) => [
            section.heading,
            ...section.blocks.flatMap((block) => block.type === "list"
                    ? block.items
                    : block.type === "table"
                        ? [...block.head, ...block.rows.flat()]
                    : block.type === "figure"
                        ? [block.alt, block.caption]
                    : block.type === "callout"
                        ? [block.label, block.text]
                        : [block.text]),
        ]),
    ]);
}

const villageNames = Object.keys(VILLAGE_LORE_LINES);
const introCopy = [
    ...PRE_GIFT_LINES.map((line) => line.text),
    ...Object.values(VILLAGE_LORE_LINES).flat(),
    ...Object.values(COMPANION_VILLAGE_FLAVOR),
    ...villageNames.flatMap((village) => buildPostGiftLines(village).map((line) => line.text)),
    ...villageNames.flatMap((village) => buildCompanionIntroLines(village, "Kumo").map((line) => line.text)),
];

const sageCopy = buildSageVnEvent({
    status: "spawned",
    offers: [{
        legacyId: "witness-test",
        name: "Witness Test",
        rarity: "basic",
        category: "pve",
        flavor: "You returned for the person the mission order forgot.",
        title: "The Returning Hand",
        villageAffinity: "Frostfang Village",
        signature: { name: "Open Road Form", shape: "single", effects: ["Guard"], unlockStage: 3 },
    }],
    sector: 1,
    spawnedAt: 1,
    expiresAt: 2,
}, "Test Shinobi").vnPages?.flatMap((page) => page.dialogue) ?? [];

const emissaryCopy = EMISSARY_DEFS.flatMap((def) => [
    def.name,
    def.greeting,
    ...def.lore,
    def.trialLine,
    ...def.quests.map((quest) => quest.label),
]);

const rumorCopy = RUMOR_CATEGORIES.flatMap((category) => rumorArc(category)?.flat() ?? []);

const questbookCopy = Object.values(QUEST_BOOK).flatMap((entry) => [
    entry.title,
    entry.giver,
    ...entry.stages.flatMap((stage) => [
        stage.text,
        stage.choice?.prompt ?? "",
        ...(stage.choice?.options.flatMap((option) => [option.label, option.blurb]) ?? []),
    ]),
]);

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

test("all live visual-novel copy follows the zero-dash punctuation rule", () => {
    const adjacentNarrative = [
        ...introCopy,
        ...sageCopy,
        ...emissaryCopy,
        ...rumorCopy,
        ...TAVERN_GOSSIP,
        ...questbookCopy,
        ...builtinHuntMissions.flatMap((mission) => [mission.name, mission.description]),
        ...builtinFetchMissions.flatMap((mission) => [mission.name, mission.description]),
        ...Object.values(clanLore).flatMap((entry) => [entry.name, entry.motto, entry.lore]),
        ...Object.values(hollowGateFlavorPool).flat(),
        ...hollowGateIntroPages.flatMap((page) => [page.title, ...page.lines]),
        ...ERA_DEFS.flatMap((era) => [era.name, era.description, era.lore, ...era.chronicle, era.unlockTitle, era.unlockMessage]),
    ];
    const offenders = [
        ...pages.flatMap((page) => visiblePageText(page)),
        ...adjacentNarrative,
    ].filter((text) => /[—–]/.test(text));
    assert.deepEqual(offenders, [], `em/en dashes found in live VN copy:\n${offenders.join("\n")}`);
});

test("authored narrative avoids stock AI-mysticism and retired village labels", () => {
    const adjacentCopy = [
        ...introCopy,
        ...sageCopy,
        ...emissaryCopy,
        ...rumorCopy,
        ...TAVERN_GOSSIP,
        ...questbookCopy,
        ...builtinHuntMissions.flatMap((mission) => [mission.name, mission.description]),
        ...builtinFetchMissions.flatMap((mission) => [mission.name, mission.description]),
        ...Object.values(clanLore).flatMap((entry) => [entry.name, entry.motto, entry.lore]),
        ...Object.values(hollowGateFlavorPool).flat(),
        ...hollowGateIntroPages.flatMap((page) => [page.title, ...page.lines]),
        ...ERA_DEFS.flatMap((era) => [era.name, era.description, era.lore, ...era.chronicle, era.unlockTitle, era.unlockMessage]),
    ].join("\n");
    const guideCopy = guideText().join("\n");
    const allNarrative = `${pages.flatMap(visiblePageText).join("\n")}\n${adjacentCopy}`;

    assert.doesNotMatch(allNarrative, /\b(?:something stirs|strange energy|ancient energy|true potential|last sanctuary|fate-bound|fortune favors|carved something into your spirit|a new path opens before you|the world is holding its breath|only the strongest hunters survive|the swords are listening|the lantern sees it|the clouds told me you were coming|the clapper is cursed|promoted form|glass-cannon firebrand|base reward)\b|\([+−-]standing\)/i);
    assert.doesNotMatch(`${adjacentCopy}\n${guideCopy}`, /\bThe (?:Chaotic|Traditional|Loyal|Selfish) Path\b|lawless proving ground|masters of stealth and deception who trust no one/i);
    assert.doesNotMatch(adjacentCopy, /\b(?:whole servers?|world queues?|card game)\b/i);
});

test("rift givers speak as people instead of narrating themselves", () => {
    const offenders: string[] = [];
    for (const rift of hollowRifts) {
        for (const page of rift.intro) {
            const firstName = page.speaker.split(/\s+/)[0];
            for (const line of page.dialogue) {
                if (new RegExp(`^(?:${firstName}|${page.speaker})\\s+(?:is|keeps|stands|sits|has|looks|turns|walks)\\b`, "i").test(line)) {
                    offenders.push(`${rift.slug}: ${line}`);
                }
                assert.ok(line.trim().split(/\s+/).length <= 45, `${rift.slug}: lore-wall speech (${line.trim().split(/\s+/).length} words): ${line}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `rift givers narrate themselves in third person:\n${offenders.join("\n")}`);
});

test("adjacent world lore, wanderers, shrines, and era events expose no pilgrim terminology", () => {
    const floorCopy = Array.from({ length: HOLLOW_GATE_DEPTH }, (_, index) =>
        Object.values(hollowGateFloorProfile(index + 1)).filter((value): value is string => typeof value === "string")
    ).flat();
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
        ...introCopy,
        ...sageCopy,
        ...Object.values(clanLore).flatMap((entry) => [entry.name, entry.motto, entry.lore]),
        ...builtinHuntMissions.flatMap((mission) => [mission.name, mission.description]),
        ...builtinFetchMissions.flatMap((mission) => [mission.name, mission.description]),
        ...Object.values(hollowGateFlavorPool).flat(),
        ...hollowGateIntroPages.flatMap((page) => [page.title, ...page.lines]),
    ].join("\n");

    assert.doesNotMatch(worldCopy, /\bpilgrims?\b/i);
    assert.doesNotMatch(worldCopy, /\b(?:shinobi\s+)?level\s+\d+\b|\blevel of strength\b/i);
    assert.match(worldCopy, /Lantern Approach/);
    assert.match(worldCopy, /Iron Disciple Daigo/);
    assert.match(worldCopy, /The Shinobi Roll/);
});
