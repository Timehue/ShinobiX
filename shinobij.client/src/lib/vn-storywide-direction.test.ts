import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { CreatorEvent } from "../types/vn";
import { storylines } from "../data/storylines";
import {
    isPremiumVnEvent,
    MAJOR_STORY_DIRECTIONS,
    resolveStoryActorPose,
    resolveStorySceneFamily,
    resolveStorySceneVariant,
    resolveStorywideActorImage,
    resolveStorywideDirection,
    STORYWIDE_ACTOR_VARIANTS,
    STORYWIDE_ACTORS,
    STORYWIDE_CLIMAX_ENVIRONMENTS,
    STORYWIDE_ENVIRONMENT_VARIANTS,
    STORYWIDE_ENVIRONMENTS,
    storyVillageKey,
} from "./vn-storywide-direction";

function event(overrides: Partial<CreatorEvent> = {}): CreatorEvent {
    return {
        id: "story-stormveil-village-15-1",
        name: "Stormveil Village: The Hearing",
        village: "Stormveil Village",
        biome: "forest",
        icon: "x",
        levelReq: 15,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: ["Line"],
        vnPages: [
            { title: "Opening", scene: "The high gate", speaker: "Mira Volt", dialogue: ["Line"] },
            { title: "Evidence", scene: "The council archive and ledger desk", speaker: "Elder Vanta", dialogue: ["Line"] },
            { title: "Ending", scene: "The mountain road", speaker: "Mira Volt", dialogue: ["Line"] },
        ],
        ...overrides,
    };
}

test("story direction preserves bespoke opening and ending art", () => {
    const e = event();
    assert.equal(resolveStorywideDirection(e, e.vnPages![0], 0)?.backgroundImage, undefined);
    assert.equal(resolveStorywideDirection(e, e.vnPages![2], 2)?.backgroundImage, undefined);
    assert.equal(resolveStorywideDirection(e, e.vnPages![0], 0)?.cue, "title");
    assert.equal(resolveStorywideDirection(e, e.vnPages![2], 2)?.cue, "none");
});

test("intermediate pages resolve to a semantic village scene family", () => {
    const e = event();
    const page = e.vnPages![1];
    assert.equal(storyVillageKey(e, page), "stormveil");
    assert.equal(resolveStorySceneFamily(e, page, 1), "civic");
    assert.equal(resolveStorywideDirection(e, page, 1)?.backgroundImage, STORYWIDE_ENVIRONMENTS.stormveil.civic);
    assert.equal(resolveStorywideDirection(e, page, 1)?.cue, "none");
    assert.equal(resolveStorywideDirection(e, page, 1)?.backgroundMotion, "none");
});

test("major chapter beats receive authored camera, motion, cue, and expression direction", () => {
    assert.equal(Object.keys(MAJOR_STORY_DIRECTIONS).length, 52);
    const villageKeys = {
        "Stormveil Village": "stormveil",
        "Ashen Leaf Village": "ashen",
        "Frostfang Village": "frostfang",
        "Moonshadow Village": "moonshadow",
    } as const;
    const authoredPageKeys = new Set(Object.entries(villageKeys).flatMap(([village, key]) =>
        (storylines[village] ?? []).flatMap((step) =>
            (step.pages ?? []).map((page) => `${key}:${page.title.trim().toLowerCase()}`),
        ),
    ));
    for (const directionKey of Object.keys(MAJOR_STORY_DIRECTIONS)) {
        assert.ok(authoredPageKeys.has(directionKey), `Major direction does not match a story page: ${directionKey}`);
    }
    const finale = event({
        id: "story-stormveil-village-100-8",
        levelReq: 100,
        vnPages: [
            { title: "Prelude", scene: "The tower road", speaker: "Narrator", dialogue: ["Line"] },
            { title: "Her Daughter Says the Why", scene: "Mira enters", speaker: "Mira Volt", dialogue: ["Line"] },
            { title: "After", scene: "The storm floor", speaker: "Narrator", dialogue: ["Line"] },
        ],
    });
    const direction = resolveStorywideDirection(finale, finale.vnPages![1], 1);
    assert.equal(direction?.shot, "close");
    assert.equal(direction?.backgroundMotion, "none");
    assert.equal(direction?.leftActorPose, "grieving");
    assert.equal(direction?.cue, "reveal");
});

test("all story events are premium while creator events stay automatic", () => {
    assert.equal(isPremiumVnEvent("story-road-border-smoke"), true);
    assert.equal(isPremiumVnEvent("creator-generic"), false);
});

test("recurring story actors receive consistent transparent cutouts", () => {
    assert.equal(
        resolveStorywideActorImage("story-stormveil-village-15-1", "Mira Volt"),
        "/portraits/cinematic/storywide/mira-volt-neutral.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-stormveil-village-15-1", "Mira Volt", "tense"),
        "/portraits/cinematic/storywide/mira-volt.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-stormveil-village-100-8", "Mira Volt", "grieving"),
        "/portraits/cinematic/storywide/mira-volt-grieving.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-moonshadow-village-100-8", "Nyx", "resolute"),
        "/portraits/cinematic/storywide/nyx-resolute.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-stormveil-village-100-8", "Elder Vanta", "solemn"),
        "/portraits/cinematic/storywide/elder-vanta-solemn.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-ashen-leaf-village-100-8", "Elder Mori", "solemn"),
        "/portraits/cinematic/storywide/elder-mori-solemn.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-frostfang-village-100-8", "Elder Sova", "solemn"),
        "/portraits/cinematic/storywide/elder-sova-solemn.webp",
    );
    assert.equal(
        resolveStorywideActorImage("story-moonshadow-village-100-8", "Shade Master Iro", "solemn"),
        "/portraits/cinematic/storywide/shade-master-iro-solemn.webp",
    );
    assert.equal(resolveStorywideActorImage("creator-generic", "Mira Volt"), undefined);
});

test("each final reckoning resolves to its bespoke climax environment", () => {
    const finaleTitles = {
        stormveil: "The Blank Board",
        ashen: "The Shears on the Anvil",
        frostfang: "The Meter at Zero",
        moonshadow: "The Glass and the Notice",
    } as const;
    const villages = {
        stormveil: "Stormveil Village",
        ashen: "Ashen Leaf Village",
        frostfang: "Frostfang Village",
        moonshadow: "Moonshadow Village",
    } as const;
    for (const villageKey of Object.keys(finaleTitles) as Array<keyof typeof finaleTitles>) {
        const page = {
            title: finaleTitles[villageKey],
            scene: "The reckoning",
            speaker: "Narrator",
            dialogue: ["Line"],
        };
        const finale = event({
            id: `story-${villages[villageKey].toLowerCase().replaceAll(" ", "-")}-100-8`,
            name: `${villages[villageKey]}: Final Reckoning`,
            village: villages[villageKey],
            vnPages: [{ ...page, title: "Prelude" }, page],
        });
        assert.equal(
            resolveStorywideDirection(finale, page, 1)?.backgroundImage,
            STORYWIDE_CLIMAX_ENVIRONMENTS[villageKey],
        );
    }
});

test("story beats choose crisis, aftermath, and stable actor poses semantically", () => {
    const e = event();
    const crisis = { ...e.vnPages![1], scene: "The council hall sounds the alarm during the blackout." };
    const aftermath = { ...e.vnPages![1], scene: "After the storm, repair crews reach the damaged hall." };
    const injured = { ...e.vnPages![1], scene: "Captain Yura stands wounded with a bandaged shoulder." };

    assert.equal(resolveStorySceneVariant(e, crisis), "crisis");
    assert.equal(resolveStorySceneVariant(e, aftermath), "aftermath");
    assert.equal(resolveStoryActorPose(e, crisis), "tense");
    assert.equal(resolveStoryActorPose(e, injured), "injured");
    assert.equal(
        resolveStorywideDirection(e, crisis, 1)?.backgroundImage,
        STORYWIDE_ENVIRONMENT_VARIANTS.stormveil.crisis,
    );
    assert.equal(
        resolveStorywideDirection(e, aftermath, 1)?.backgroundImage,
        STORYWIDE_ENVIRONMENT_VARIANTS.stormveil.aftermath,
    );
});

test("the story-wide cinematic package is present and within asset budgets", () => {
    const publicRoot = existsSync(resolve(process.cwd(), "shinobij.client/public"))
        ? resolve(process.cwd(), "shinobij.client/public")
        : resolve(process.cwd(), "public");
    const assets = [
        ...Object.values(STORYWIDE_ENVIRONMENTS).flatMap((families) => Object.values(families)),
        ...Object.values(STORYWIDE_ENVIRONMENT_VARIANTS).flatMap((variants) => Object.values(variants)),
        ...Object.values(STORYWIDE_CLIMAX_ENVIRONMENTS),
        ...new Set(Object.values(STORYWIDE_ACTORS)),
        ...new Set(Object.values(STORYWIDE_ACTOR_VARIANTS).flatMap((variants) => Object.values(variants))),
    ];

    assert.equal(new Set(Object.values(STORYWIDE_ACTORS)).size, 14);
    assert.equal(Object.values(STORYWIDE_ENVIRONMENTS).flatMap((families) => Object.values(families)).length, 16);
    assert.equal(Object.values(STORYWIDE_ENVIRONMENT_VARIANTS).flatMap((variants) => Object.values(variants)).length, 8);
    assert.equal(Object.values(STORYWIDE_CLIMAX_ENVIRONMENTS).length, 4);
    for (const asset of assets) {
        const file = resolve(publicRoot, asset.replace(/^\//, ""));
        assert.equal(existsSync(file), true, `Missing story-wide VN asset: ${asset}`);
        assert.ok(statSync(file).size < 700_000, `Story-wide VN asset exceeds 700 KB: ${asset}`);
    }
});
