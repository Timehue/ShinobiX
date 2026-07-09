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
import { storyRoadEvents } from "./story-road-events";
import { splitDialogueLine } from "../lib/vn";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

// Matches lib/vn.ts defaultVnPortrait slugging.
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Speakers that intentionally render as initials (no portrait file).
const NO_PORTRAIT_OK = new Set(["narrator", "player", "unknown-voice"]);

type AnyPage = { title: string; scene: string; speaker: string; dialogue: string[]; image?: string; rightImage?: string; choices?: { text: string; nextPage: number; requireTrait?: string; forbidTrait?: string; trait?: string; battle?: unknown }[] };

function collectSpeakers(pages: AnyPage[], into: Map<string, string>) {
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

test("every story speaker has portrait art (or is an intentional initials speaker)", () => {
    const speakers = new Map<string, string>();
    for (const { pages } of allContent()) collectSpeakers(pages, speakers);
    const missing: string[] = [];
    for (const [slug, name] of speakers) {
        if (!slug || NO_PORTRAIT_OK.has(slug)) continue;
        if (!existsSync(path.join(PUBLIC_DIR, "portraits", `${slug}.webp`))) missing.push(`${name} -> portraits/${slug}.webp`);
    }
    assert.deepEqual(missing, [], `speakers without portrait art:\n${missing.join("\n")}`);
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
        // Trait-gated hubs must always keep an ungated way forward.
        for (const [i, page] of pages.entries()) {
            const choices = page.choices ?? [];
            if (choices.some((c) => c.requireTrait)) {
                assert.ok(choices.some((c) => !c.requireTrait && !c.forbidTrait), `${label} page ${i}: gated hub without an ungated fallback choice`);
            }
        }
    }
});

test("finale reckoning gates reference real interlude traits from the same village", () => {
    for (const [village, steps] of Object.entries(storylines)) {
        const villageTraits = new Set(
            (storyInterludesByVillage[village] ?? []).flatMap((e) =>
                (e.pages[e.pages.length - 1].choices ?? []).map((c) => c.trait)),
        );
        const finale = steps[steps.length - 1];
        for (const page of (finale.pages ?? []) as AnyPage[]) {
            for (const choice of page.choices ?? []) {
                if (choice.requireTrait) {
                    assert.ok(villageTraits.has(choice.requireTrait), `${village} finale gates on unknown trait ${choice.requireTrait}`);
                }
            }
        }
    }
});
