/*
 * Story-content integrity suite (rebuild §12 cleanup obligations, kept as a
 * permanent gate): every VN speaker resolves to portrait art, every stamped
 * scene backdrop exists on disk, and every VN choice graph — including the
 * trait-gated finale reckonings — is walkable to a proper ending. Fails the
 * build on broken art paths or an unreachable/looping story beat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { storylines } from "./storylines";
import { storyInterludesByVillage } from "./story-interludes";
import { storyEpiloguesByVillage } from "./story-epilogues";
import { storyReckonings } from "./story-reckonings";
import { storyRoadEvents } from "./story-road-events";
import { hollowRifts } from "./hollow-rifts";
import { defaultVnPortrait, resolveVnActorBaseImage, splitDialogueLine } from "../lib/vn";
import { DERIVED_TRAIT_LEVELS } from "../lib/story-derive";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

// Matches lib/vn.ts defaultVnPortrait slugging.
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Speakers that intentionally render as initials (no portrait file).
const NO_PORTRAIT_OK = new Set(["narrator", "player", "unknown-voice"]);

type AnyPage = { title: string; scene: string; speaker: string; dialogue: string[]; image?: string; leftName?: string; rightName?: string; leftImage?: string; rightImage?: string; choices?: { text: string; nextPage: number; requireTrait?: string; forbidTrait?: string; trait?: string; battle?: unknown; conclusion?: string }[] };
type SpeakerPage = Pick<AnyPage, "speaker" | "dialogue">;

function collectSpeakers(pages: readonly SpeakerPage[], into: Map<string, string>) {
    for (const page of pages) {
        into.set(slugify(page.speaker), page.speaker);
        // Dialogue lines may carry a "Speaker: text" prefix that the renderer
        // resolves to that speaker's portrait — use the REAL renderer heuristic
        // so this test sees exactly what a player would see.
        for (const line of page.dialogue) {
            const { speaker } = splitDialogueLine(line, page.speaker);
            into.set(slugify(speaker), speaker);
        }
    }
}

function allContent(): { label: string; pages: AnyPage[]; kind: "milestone" | "interlude" | "road" }[] {
    const out: { label: string; pages: AnyPage[]; kind: "milestone" | "interlude" | "road" }[] = [];
    for (const [village, steps] of Object.entries(storylines)) {
        for (const step of steps) out.push({ label: `${village} L${step.levelReq}`, pages: (step.pages ?? []) as AnyPage[], kind: "milestone" });
    }
    for (const [village, entries] of Object.entries(storyInterludesByVillage)) {
        for (const entry of entries) out.push({ label: `${village} interlude L${entry.levelReq}`, pages: entry.pages as AnyPage[], kind: "interlude" });
    }
    for (const event of storyRoadEvents) out.push({ label: `road ${event.slug}`, pages: event.pages as AnyPage[], kind: "road" });
    return out;
}

function allStorySpeakerPages(): SpeakerPage[] {
    return [
        ...allContent().flatMap(({ pages }) => pages),
        ...Object.values(storyEpiloguesByVillage).flatMap((epilogues) => epilogues.flatMap((epilogue) => epilogue.pages)),
        ...storyReckonings.flatMap((reckoning) => [...reckoning.intro, ...reckoning.payoff]),
    ];
}

test("Frostfang's quarry count and Kessa's escape stay internally consistent", () => {
    const quarry = storylines["Frostfang Village"].find((step) => step.levelReq === 65);
    assert.ok(quarry);
    const escort = quarry.pages?.at(-1)?.choices?.find((choice) => choice.text.startsWith("Escort the camp"));
    assert.match(escort?.conclusion ?? "", /all nineteen names/i);

    const shortcut = storyInterludesByVillage["Frostfang Village"].find((entry) => entry.levelReq === 80);
    assert.ok(shortcut);
    const copy = shortcut.pages.flatMap((page) => page.dialogue).join(" ");
    assert.match(copy, /Kessa's refusal.*escaped before it could finish/i);
    assert.doesNotMatch(copy, /Dren went with it\. Kessa too/i);
});

test("the four village themes stay distinct through the grid reveal, finale, and epilogue", () => {
    const sharedFeedstocks = [
        /Stormveil supplies the reasons people fight/i,
        /Ashen Leaf supplies futures people were becoming/i,
        /Frostfang supplies the choice to leave/i,
        /Moonshadow supplies trust people placed in someone/i,
    ];
    const villageThemes: Record<string, RegExp> = {
        "Stormveil Village": /\breason(?:s)?\b|\bwhy\b|\bgrudge(?:s)?\b/i,
        "Ashen Leaf Village": /\bfuture(?:s)?\b|\bplan(?:s)?\b|\bambition(?:s)?\b|\bprun(?:e|ed|ing)\b/i,
        "Frostfang Village": /\brefus(?:al|als|e|ed)\b|\bchoice(?:s)?\b|\bexit(?:s)?\b|\bleave\b/i,
        "Moonshadow Village": /\btrust\b|\bentrust(?:ed|ing)?\b|\bconfession(?:s)?\b|\btruth(?:s)?\b/i,
    };

    for (const [village, theme] of Object.entries(villageThemes)) {
        const gridReveal = storyInterludesByVillage[village].find((entry) => entry.levelReq === 80);
        assert.ok(gridReveal, `${village}: missing level-80 grid reveal`);
        const gridCopy = gridReveal.pages.flatMap((page) => page.dialogue).join(" ");
        for (const feedstock of sharedFeedstocks) assert.match(gridCopy, feedstock, `${village}: grid reveal changed a village's feedstock`);

        const finale = storylines[village].find((step) => step.levelReq === 100);
        assert.ok(finale, `${village}: missing finale`);
        const finaleCopy = (finale.pages ?? []).flatMap((page) => [
            ...page.dialogue,
            ...(page.choices ?? []).flatMap((choice) => [choice.text, choice.conclusion ?? ""]),
        ]).join(" ");
        assert.match(finaleCopy, theme, `${village}: finale dropped its village theme`);

        for (const epilogue of storyEpiloguesByVillage[village]) {
            const epilogueCopy = epilogue.pages.flatMap((page) => page.dialogue).join(" ");
            assert.match(epilogueCopy, theme, `${village}: ${epilogue.title} dropped its village theme`);
        }
    }
});

test("the Hollow Gate remains human-built infrastructure in the main campaign", () => {
    const campaignPages: AnyPage[] = [
        ...allContent().filter(({ kind }) => kind !== "road").flatMap(({ pages }) => pages),
        ...Object.values(storyEpiloguesByVillage).flatMap((epilogues) => epilogues.flatMap((epilogue) => epilogue.pages)),
    ];
    const corpus = campaignPages.flatMap((page) => [
        page.title,
        page.scene,
        ...page.dialogue,
        ...(page.choices ?? []).flatMap((choice) => [choice.text, choice.conclusion ?? ""]),
    ]).join(" ");

    assert.match(corpus, /It isn't alive\. It was built to recognize leverage/i);
    assert.doesNotMatch(corpus, /something enormous notices the arithmetic|something beyond the village notices|the Gate claims what remains|the Gate calls in what remains|the thing under the Vault knows your hand/i);
});

test("each level-88 alternative carries into the finale and its specific epilogue", () => {
    const alternatives: Record<string, { proof: RegExp; finaleTraits: string[]; epilogueTrait: string }> = {
        "Stormveil Village": {
            proof: /anchors can stop a major storm without taking anyone's reason/i,
            finaleTraits: ["sv88-better-storm-carried", "sv88-better-storm-deferred"],
            epilogueTrait: "sv88-better-storm-ready",
        },
        "Ashen Leaf Village": {
            proof: /ninety mouths.*without burning a single future/i,
            finaleTraits: ["al88-better-winter-carried", "al88-better-winter-deferred"],
            epilogueTrait: "al88-better-winter-ready",
        },
        "Frostfang Village": {
            proof: /vault is not the only way to bring someone home/i,
            finaleTraits: ["ff88-better-roll-carried", "ff88-better-roll-deferred"],
            epilogueTrait: "ff88-better-roll-ready",
        },
        "Moonshadow Village": {
            proof: /Trust doesn't need an owner\. It needs a witness/i,
            finaleTraits: ["ms88-better-truth-ready", "ms88-better-truth-deferred"],
            epilogueTrait: "ms88-better-truth-ready",
        },
    };

    for (const [village, expected] of Object.entries(alternatives)) {
        const alternative = storyInterludesByVillage[village].find((entry) => entry.levelReq === 88);
        assert.ok(alternative, `${village}: missing level-88 alternative`);
        assert.match(alternative.pages.flatMap((page) => page.dialogue).join(" "), expected.proof, `${village}: alternative proof is unclear`);

        const finale = storylines[village].find((step) => step.levelReq === 100);
        assert.ok(finale, `${village}: missing finale`);
        const finaleGates = new Set((finale.pages ?? []).flatMap((page) => (page.choices ?? []).map((choice) => choice.requireTrait).filter(Boolean)));
        for (const trait of expected.finaleTraits) assert.ok(finaleGates.has(trait), `${village}: finale does not pay off ${trait}`);

        assert.ok(storyEpiloguesByVillage[village].some((epilogue) => epilogue.requireTrait === expected.epilogueTrait), `${village}: alternative has no tailored epilogue`);
    }
});

test("main-story dialogue stays paced into readable beats", () => {
    const dialogueOffenders: string[] = [];
    const conclusionOffenders: string[] = [];
    const wordCount = (copy: string) => copy.trim().split(/\s+/).filter(Boolean).length;

    for (const { label, pages, kind } of allContent()) {
        if (kind === "road") continue;
        for (const page of pages) {
            for (const line of page.dialogue) {
                const words = wordCount(line);
                if (words > 55) dialogueOffenders.push(`${label} / ${page.title}: ${words} words`);
            }
            for (const choice of page.choices ?? []) {
                if (!choice.conclusion) continue;
                const words = wordCount(choice.conclusion);
                if (words > 65) conclusionOffenders.push(`${label} / ${page.title}: ${words} words`);
            }
        }
    }

    assert.deepEqual(dialogueOffenders, [], `dialogue lines that should be split into natural beats:\n${dialogueOffenders.join("\n")}`);
    assert.deepEqual(conclusionOffenders, [], `choice outcomes that need a clearer, shorter result:\n${conclusionOffenders.join("\n")}`);
});

test("every story speaker has portrait art (or is an intentional initials speaker)", () => {
    const speakers = new Map<string, string>();
    collectSpeakers(allStorySpeakerPages(), speakers);
    const missing: string[] = [];
    for (const [slug, name] of speakers) {
        if (!slug || NO_PORTRAIT_OK.has(slug)) continue;
        if (!existsSync(path.join(PUBLIC_DIR, "portraits", `${slug}.webp`))) missing.push(`${name} -> portraits/${slug}.webp`);
    }
    assert.deepEqual(missing, [], `speakers without portrait art:\n${missing.join("\n")}`);
});

test("every story line binds the displayed character to that character's portrait", () => {
    let checkedLines = 0;
    for (const page of allStorySpeakerPages() as AnyPage[]) {
        const savedRightWasPlayer = (page.rightName ?? "").trim().toLowerCase() === "player";
        const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
        for (const line of page.dialogue) {
            checkedLines += 1;
            const { speaker } = splitDialogueLine(line, page.speaker);
            const rightName = savedRightWasPlayer
                ? (page.leftName || page.speaker || speaker)
                : (page.rightName || page.speaker || speaker);
            const speakerKey = speaker.trim().toLowerCase();
            const isLeftSpeaker = speakerKey === leftName.trim().toLowerCase();
            const isRightSpeaker = speakerKey === rightName.trim().toLowerCase();
            assert.ok(isLeftSpeaker || isRightSpeaker, `${page.title}: ${speaker} has no matching actor slot`);
            if (!isRightSpeaker) continue;

            const authoredImage = savedRightWasPlayer
                ? (page.leftImage || page.rightImage)
                : page.rightImage;
            const resolvedImage = resolveVnActorBaseImage(
                "story-character-route-audit",
                rightName,
                authoredImage,
                "/portraits/elder-sova.webp",
            );
            assert.equal(
                resolvedImage,
                authoredImage?.trim() || defaultVnPortrait(rightName),
                `${page.title}: ${rightName} inherited another character's event avatar`,
            );
            if (authoredImage && !NO_PORTRAIT_OK.has(slugify(rightName))) {
                assert.ok(
                    authoredImage.includes(slugify(rightName)),
                    `${page.title}: ${rightName} is explicitly mapped to ${authoredImage}`,
                );
            }
        }
    }
    assert.ok(checkedLines > 2_400, `portrait-route audit unexpectedly covered only ${checkedLines} lines`);
});

test("canonical story copy keeps Hoshina Enju, Elder Sova, and the Pale Pack Runner female", () => {
    const ashenCopy = (storylines["Ashen Leaf Village"].flatMap((step) => step.pages ?? []) as AnyPage[])
        .flatMap((page) => page.dialogue).join(" ");
    const palePackCopy = storyInterludesByVillage["Frostfang Village"]
        .flatMap((entry) => entry.pages).flatMap((page) => [page.scene, ...page.dialogue]).join(" ");
    const sovaCopy = storyReckonings.find((reckoning) => reckoning.slug === "sova-true-roll")
        ?.intro.flatMap((page) => page.dialogue).join(" ") ?? "";

    assert.match(ashenCopy, /Hoshina kept this village alive.*since she became Kage/i);
    assert.match(palePackCopy, /Pale Pack Runner with frost in her hood/i);
    assert.match(sovaCopy, /Sova stands.*with her coat open to the cold/i);
});

test("every stamped scene backdrop and finale hollow-form image exists on disk", () => {
    const missing: string[] = [];
    for (const { label, pages } of allContent()) {
        for (const page of pages) {
            for (const ref of [page.image, page.rightImage]) {
                if (ref && ref.startsWith("/") && !existsSync(path.join(PUBLIC_DIR, ref.replace(/^\//, "")))) {
                    missing.push(`${label}: ${ref}`);
                }
            }
        }
    }
    // Interlude/road backdrops are stamped at conversion time from the id.
    for (const [, entries] of Object.entries(storyInterludesByVillage)) {
        for (const entry of entries) if (!existsSync(path.join(PUBLIC_DIR, "scenes", "story", `${entry.id}.webp`))) missing.push(`scene ${entry.id}`);
    }
    for (const event of storyRoadEvents) {
        if (!existsSync(path.join(PUBLIC_DIR, "scenes", "story", `${event.id}.webp`))) missing.push(`scene ${event.id}`);
    }
    assert.deepEqual(missing, [], `missing art files:\n${missing.join("\n")}`);
});

/**
 * Walk a VN page graph the way TriggeredVisualNovel does: pages auto-advance
 * unless the current page has available choices; a choice either launches a
 * battle (terminal), self-points (scene concludes — terminal), or jumps.
 * Returns the set of terminal kinds reached; throws on a loop or a dead end.
 */
function walk(label: string, pages: AnyPage[], traits: string[]): Set<"battle" | "conclude" | "ranOff"> {
    const terminals = new Set<"battle" | "conclude" | "ranOff">();
    const seen = new Set<string>();
    function visit(pos: number, depth: number) {
        assert.ok(depth < 64, `${label}: walk too deep (loop?)`);
        const key = `${pos}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (pos >= pages.length) { terminals.add("ranOff"); return; }
        const page = pages[pos];
        const avail = (page.choices ?? []).filter((c) =>
            !!c.text &&
            (!c.requireTrait || traits.includes(c.requireTrait)) &&
            (!c.forbidTrait || !traits.includes(c.forbidTrait)));
        if (!avail.length) { visit(pos + 1, depth + 1); return; }
        for (const choice of avail) {
            if (choice.battle) { terminals.add("battle"); continue; }
            const target = Math.max(0, Math.min(pages.length - 1, choice.nextPage));
            if (target === pos) { terminals.add("conclude"); continue; }
            visit(target, depth + 1);
        }
    }
    visit(0, 0);
    return terminals;
}

test("every story VN graph is walkable and ends properly (all trait scenarios)", () => {
    for (const { label, pages, kind } of allContent()) {
        // Gate traits used anywhere in this graph, each simulated individually
        // plus the no-traits path (the ungated-fallback rule).
        const gates = pages.flatMap((p) => (p.choices ?? []).map((c) => c.requireTrait).filter((t): t is string => !!t));
        const scenarios: string[][] = [[], ...gates.map((g) => [g])];
        for (const traits of scenarios) {
            const terminals = walk(`${label} [${traits.join(",") || "no traits"}]`, pages, traits);
            assert.ok(!terminals.has("ranOff"), `${label} [${traits.join(",") || "no traits"}]: walked off the end without an ending`);
            if (kind === "milestone") {
                assert.ok(terminals.has("battle"), `${label} [${traits.join(",") || "no traits"}]: boss battle unreachable`);
            } else {
                assert.ok(terminals.has("battle") || terminals.has("conclude"), `${label}: no reachable ending`);
            }
        }
        // Trait-gated hubs must always keep an ungated way forward. Mid-scene
        // choices may grant UNIQUE-SCHEME traits only (identity seeds, crate
        // memory, etc.) — never the shared lane tags or relationship trios,
        // which belong to final-page decisions.
        const GENERIC = new Set(["reckless", "suspicious", "ambitious", "merciful", "honorable", "loyal"]);
        for (const [i, page] of pages.entries()) {
            const choices = page.choices ?? [];
            if (choices.some((c) => c.requireTrait)) {
                assert.ok(choices.some((c) => !c.requireTrait && !c.forbidTrait), `${label} page ${i}: gated hub without an ungated fallback choice`);
            }
            if (i < pages.length - 1) {
                for (const choice of choices) {
                    if (!choice.trait) continue;
                    assert.ok(/^(sv|al|ff|ms|rd)\d+-/.test(choice.trait), `${label} page ${i}: mid-scene trait ${choice.trait} must use the unique scheme`);
                    assert.ok(!GENERIC.has(choice.trait), `${label} page ${i}: mid-scene choice grants a lane tag`);
                }
            }
        }
    }
});

test("zero em/en dashes anywhere in story copy (owner hard rule)", () => {
    const offenders: string[] = [];
    for (const { label, pages } of allContent()) {
        for (const page of pages) {
            const fields = [page.title, page.scene, ...page.dialogue,
                ...(page.choices ?? []).flatMap((c) => [c.text, (c as { conclusion?: string }).conclusion ?? ""])];
            for (const field of fields) {
                if (/[—–]/.test(field)) offenders.push(`${label}: ${field.slice(0, 80)}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `em/en dashes found:\n${offenders.join("\n")}`);
});

test("Legacy canon is witnessed action, never heredity, reincarnation, or a preserved soul", () => {
    const slugs = new Set(["withheld-cache", "legacy-without-a-name", "unsworn-ledger", "fifth-anchor", "four-seals-one-gate"]);
    const copy = storyRoadEvents
        .filter((event) => slugs.has(event.slug))
        .flatMap((event) => event.pages)
        .flatMap((page) => [page.title, page.scene, ...page.dialogue, ...(page.choices ?? []).flatMap((choice) => [choice.text, choice.conclusion ?? ""])])
        .join(" ");

    assert.match(copy, /Ancients, people from the Sunken Court's age/i);
    assert.match(copy, /\bWithheld\b/i);
    assert.match(copy, /refused cession/i);
    assert.match(copy, /hundred recognizable action patterns/i);
    assert.match(copy, /Bloodline has nothing to do with it/i);
    assert.match(copy, /lattice cannot classify you/i);
    assert.match(copy, /under witness/i);
    assert.doesNotMatch(copy, /pass through a family|LEGACY-BEARING|dormant Legacy|passing from parent to child|preserve one part of a person/i);

    const riftCopy = hollowRifts
        .filter((rift) => rift.slug === "legacy-echo")
        .flatMap((rift) => [...rift.intro, ...rift.descent])
        .flatMap((page) => [page.title, page.scene, ...page.dialogue, ...(page.choices ?? []).flatMap((choice) => [choice.text, choice.conclusion ?? ""])])
        .join(" ");
    assert.match(riftCopy, /ordinary person of the Sunken Court's age/i);
    assert.match(riftCopy, /No soul waits in that stone/i);
    assert.match(riftCopy, /preserve the deed/i);
    assert.doesNotMatch(riftCopy, /a soul of the Sunken Court|ancestor living|reincarnat/i);
});

test("the player's avatar always holds the left portrait slot", () => {
    // The renderer puts the player LEFT when page.rightName is "Player" (the
    // storyPage default, which swaps sides) or when leftName is "Player"/unset.
    // A page must never name BOTH slots to NPCs, or the player vanishes from
    // their own story.
    const offenders: string[] = [];
    for (const { label, pages } of allContent()) {
        for (const [i, page] of pages.entries()) {
            const p = page as { leftName?: string; rightName?: string };
            const rightIsPlayer = (p.rightName ?? "Player").trim().toLowerCase() === "player";
            const leftIsPlayer = (p.leftName ?? "Player").trim().toLowerCase() === "player";
            if (!rightIsPlayer && !leftIsPlayer) offenders.push(`${label} page ${i}: left=${p.leftName} right=${p.rightName}`);
        }
    }
    assert.deepEqual(offenders, [], `pages without the player in a slot:\n${offenders.join("\n")}`);
});

test("every trait gate references a trait this player can actually earn by then", () => {
    // Earnable = this village's interlude traits + chapter mid-scene traits
    // (identity seeds etc.) + any road-event trait, and only from content
    // whose levelReq is at or below the gating scene's.
    const roadTraitLevels = new Map<string, number>();
    for (const event of storyRoadEvents) {
        for (const choice of event.pages[event.pages.length - 1].choices ?? []) roadTraitLevels.set(choice.trait, event.levelReq);
    }
    for (const [village, steps] of Object.entries(storylines)) {
        const villageTraitLevels = new Map<string, number>();
        for (const entry of storyInterludesByVillage[village] ?? []) {
            for (const page of entry.pages) for (const choice of page.choices ?? []) {
                if (choice.trait) villageTraitLevels.set(choice.trait, entry.levelReq);
            }
        }
        for (const step of steps) {
            for (const page of (step.pages ?? []) as AnyPage[]) {
                for (const choice of page.choices ?? []) {
                    if (choice.trait && /^(sv|al|ff|ms)\d+-/.test(choice.trait)) villageTraitLevels.set(choice.trait, step.levelReq);
                }
            }
        }
        // Composite traits are materialized by lib/story-derive.ts (never
        // granted by a choice), so register them as earnable at their level.
        for (const [trait, level] of Object.entries(DERIVED_TRAIT_LEVELS)) villageTraitLevels.set(trait, level);
        const gateCheck = (level: number, pages: AnyPage[], label: string) => {
            for (const page of pages) {
                for (const choice of page.choices ?? []) {
                    if (!choice.requireTrait) continue;
                    const earnLevel = villageTraitLevels.get(choice.requireTrait) ?? roadTraitLevels.get(choice.requireTrait);
                    assert.ok(earnLevel !== undefined, `${label} gates on unknown trait ${choice.requireTrait}`);
                    assert.ok(earnLevel <= level, `${label} gates on ${choice.requireTrait}, only earnable at level ${earnLevel}`);
                }
            }
        };
        for (const step of steps) gateCheck(step.levelReq, (step.pages ?? []) as AnyPage[], `${village} L${step.levelReq}`);
        for (const entry of storyInterludesByVillage[village] ?? []) gateCheck(entry.levelReq, entry.pages as AnyPage[], `${village} interlude L${entry.levelReq}`);
    }
});
