import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { CreatorEvent } from "../types/vn";
import {
    isPremiumVnEvent,
    resolveStorySceneFamily,
    resolveStorywideActorImage,
    resolveStorywideDirection,
    STORYWIDE_ACTORS,
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
});

test("all story events are premium while creator events stay automatic", () => {
    assert.equal(isPremiumVnEvent("story-road-border-smoke"), true);
    assert.equal(isPremiumVnEvent("creator-generic"), false);
});

test("recurring story actors receive consistent transparent cutouts", () => {
    assert.equal(
        resolveStorywideActorImage("story-stormveil-village-15-1", "Mira Volt"),
        "/portraits/cinematic/storywide/mira-volt.webp",
    );
    assert.equal(resolveStorywideActorImage("creator-generic", "Mira Volt"), undefined);
});

test("the story-wide cinematic package is present and within asset budgets", () => {
    const publicRoot = existsSync(resolve(process.cwd(), "shinobij.client/public"))
        ? resolve(process.cwd(), "shinobij.client/public")
        : resolve(process.cwd(), "public");
    const assets = [
        ...Object.values(STORYWIDE_ENVIRONMENTS).flatMap((families) => Object.values(families)),
        ...new Set(Object.values(STORYWIDE_ACTORS)),
    ];

    assert.equal(new Set(Object.values(STORYWIDE_ACTORS)).size, 14);
    assert.equal(Object.values(STORYWIDE_ENVIRONMENTS).flatMap((families) => Object.values(families)).length, 16);
    for (const asset of assets) {
        const file = resolve(publicRoot, asset.replace(/^\//, ""));
        assert.equal(existsSync(file), true, `Missing story-wide VN asset: ${asset}`);
        assert.ok(statSync(file).size < 700_000, `Story-wide VN asset exceeds 700 KB: ${asset}`);
    }
});
