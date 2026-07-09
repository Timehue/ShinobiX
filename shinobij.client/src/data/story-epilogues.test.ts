/*
 * Story-epilogue integrity suite: the post-finale ending scenes must stay
 * selectable (every fought lane resolves to an epilogue), well-ordered
 * (trait-gated variants before their base entry — array order IS selection
 * precedence), and held to the same prose gates as the rest of the story
 * (zero dashes, real portraits, existing backdrops, banned-term free).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { storylines } from "./storylines";
import { storyEpiloguesByVillage } from "./story-epilogues";
import { selectStoryEpilogue, selectStoryEpilogueEvent } from "../lib/story-epilogue";
import { splitDialogueLine } from "../lib/vn";
import type { Character } from "../types/character";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const NO_PORTRAIT_OK = new Set(["narrator", "player", "unknown-voice"]);

function finaleLanes(village: string): Set<string> {
    const steps = storylines[village] ?? [];
    const finale = steps[steps.length - 1];
    const lastPage = (finale?.pages ?? [])[Math.max(0, (finale?.pages ?? []).length - 1)] as { choices?: { trait?: string; requireTrait?: string }[] } | undefined;
    return new Set((lastPage?.choices ?? []).filter((c) => c.trait && !c.requireTrait).map((c) => c.trait!));
}

test("every epilogue follows a real finale lane, gated variants precede their base, every lane has a base", () => {
    for (const [village, defs] of Object.entries(storyEpiloguesByVillage)) {
        const lanes = finaleLanes(village);
        const seenBase = new Set<string>();
        for (const def of defs) {
            assert.ok(lanes.has(def.lane), `${village}: epilogue lane ${def.lane} is not a finale lane (${[...lanes].join(", ")})`);
            if (def.requireTrait) {
                assert.ok(!seenBase.has(def.lane), `${village}/${def.lane}: gated variant "${def.title}" comes AFTER the base entry — selection would never reach it`);
                assert.match(def.requireTrait, /^(sv|al|ff|ms|rd)\d+-/, `${village}/${def.lane}: requireTrait ${def.requireTrait} off-scheme`);
            } else {
                seenBase.add(def.lane);
            }
        }
        for (const def of defs) {
            assert.ok(seenBase.has(def.lane), `${village}/${def.lane}: no ungated base epilogue — a player without the gate trait would get nothing`);
        }
    }
});

test("epilogue prose passes the story gates: dialogue present, zero dashes, no banned terms", () => {
    const offenders: string[] = [];
    for (const [village, defs] of Object.entries(storyEpiloguesByVillage)) {
        for (const def of defs) {
            assert.ok(def.pages.length >= 1, `${village}/${def.title}: no pages`);
            for (const page of def.pages) {
                assert.ok(page.dialogue.length >= 1, `${village}/${def.title}: page without dialogue`);
                for (const field of [def.title, page.title, page.scene, ...page.dialogue]) {
                    if (/[—–]/.test(field)) offenders.push(`${village}/${def.title}: dash in "${field.slice(0, 60)}"`);
                    if (/paper shinobi/i.test(field)) offenders.push(`${village}/${def.title}: banned term`);
                }
            }
        }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("every epilogue speaker has portrait art and every backdrop exists on disk", () => {
    const missing: string[] = [];
    for (const [village, defs] of Object.entries(storyEpiloguesByVillage)) {
        const backdrop = path.join(PUBLIC_DIR, "scenes", "story", `story-${slugify(village)}-100-8.webp`);
        if (!existsSync(backdrop)) missing.push(`${village}: finale backdrop ${backdrop}`);
        for (const def of defs) {
            for (const page of def.pages) {
                const speakers = new Set([page.speaker, ...page.dialogue.map((line) => splitDialogueLine(line, page.speaker).speaker)]);
                for (const speaker of speakers) {
                    const slug = slugify(speaker);
                    if (!slug || NO_PORTRAIT_OK.has(slug)) continue;
                    if (!existsSync(path.join(PUBLIC_DIR, "portraits", `${slug}.webp`))) missing.push(`${village}/${def.title}: ${speaker}`);
                }
            }
        }
    }
    assert.deepEqual(missing, [], `missing art:\n${missing.join("\n")}`);
});

test("selection precedence: gate trait picks the variant, otherwise base, unknown lane picks nothing", () => {
    const V = "Ashen Leaf Village";
    const ready = selectStoryEpilogue(V, "honorable", ["al88-better-winter-ready"]);
    assert.ok(ready?.requireTrait === "al88-better-winter-ready", "ready trait should select the gated honorable variant");
    const base = selectStoryEpilogue(V, "honorable", []);
    assert.ok(base && !base.requireTrait, "no traits should fall back to the base honorable epilogue");
    assert.notEqual(ready?.title, base?.title);
    assert.equal(selectStoryEpilogue(V, "suspicious", ["al88-better-winter-ready"]), null, "non-finale lane selects nothing");
    assert.equal(selectStoryEpilogue(V, null, []), null);
    assert.equal(selectStoryEpilogue("Nowhere Village", "honorable", []), null);
});

test("selectStoryEpilogueEvent builds a zero-reward story-epilogue VN with the finale backdrop", () => {
    const character = {
        name: "Tester",
        village: "Ashen Leaf Village",
        storyVillage: "Ashen Leaf Village",
        storyTraits: ["al65-saved-the-screw", "al88-better-winter-ready"],
    } as unknown as Character;
    const event = selectStoryEpilogueEvent(character, "ambitious");
    assert.ok(event, "expected an epilogue event");
    assert.equal(event!.id, "story-epilogue-ashen-leaf-village-ambitious");
    assert.equal(event!.eventKind, "visualNovel");
    assert.equal(event!.xpReward, 0);
    assert.equal(event!.ryoReward, 0);
    assert.equal(event!.staminaReward, 0);
    assert.ok(event!.vnPages && event!.vnPages.length >= 1);
    for (const page of event!.vnPages!) {
        assert.equal(page.image, "/scenes/story/story-ashen-leaf-village-100-8.webp");
        assert.ok(!page.choices?.length, "epilogue pages carry no choices");
    }
    // The devastated-Toma variant is the ready-gated one for the taken shears.
    assert.ok(event!.vnPages!.some((page) => page.dialogue.some((line) => line.includes("sat down in her chair"))));
    assert.equal(selectStoryEpilogueEvent(character, null), null, "no captured lane, no epilogue");
});
