/*
 * Visual-novel asset path helpers.
 *
 * Pure lookups: given a speaker name or event id, return the URL path to
 * the matching portrait / scene asset. CSS / <img onError> silently fall
 * back to a default if the file is missing — these helpers don't probe.
 *
 * Drop new assets into shinobij.client/public/portraits/<slug>.png or
 * /scenes/<slug>.png to enable them; the helper builds the slug from
 * the speaker name / event id automatically.
 *
 * Extracted from App.tsx.
 */

/**
 * Slug-ifies a speaker name into a /portraits/<slug>.png path. Returns ""
 * for empty / Narrator / Player so callers can decide whether to hide
 * the portrait slot entirely.
 */
export function defaultVnPortrait(name: string | undefined | null): string {
    if (!name) return "";
    const n = name.trim().toLowerCase();
    if (!n || n === "narrator" || n === "player") return "";
    const slug = n.replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    return slug ? `/portraits/${slug}.webp` : "";
}

/**
 * Best-fit scene background for a VN page. Tries an event-specific
 * /scenes/<eventid>.png first, then falls back to a biome default.
 * CSS background-image silently ignores 404s, so absent files just
 * fall through to the biome gradient — no broken-image icon shown.
 */
export function defaultVnScene(eventId?: string | null, biome?: string | null): string {
    if (eventId) {
        const slug = eventId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (slug) return `/scenes/${slug}.png`;
    }
    if (biome) {
        const slug = biome.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (slug) return `/scenes/${slug}.png`;
    }
    return "";
}

/**
 * Trait-gating predicate for a visual-novel choice. A choice is available when
 * the player has its requireTrait (if set) and lacks its forbidTrait (if set).
 * Choices with neither field are always available, so existing VNs — which carry
 * no trait conditions — behave exactly as before. Used by the VN renderer's
 * choice filter; pure + unit-tested so the branching rule can't silently change.
 */
export function isChoiceAvailable(
    choice: { requireTrait?: string; forbidTrait?: string },
    traits: readonly string[],
): boolean {
    if (choice.requireTrait && !traits.includes(choice.requireTrait)) return false;
    if (choice.forbidTrait && traits.includes(choice.forbidTrait)) return false;
    return true;
}

export type VnFlowChoice = {
    text: string;
    nextPage: number;
    requireTrait?: string;
    forbidTrait?: string;
    trait?: string;
    battle?: unknown;
};

export type VnFlowPage = {
    title?: string;
    scene: string;
    dialogue: string;
    choices?: VnFlowChoice[];
};

/**
 * Static analysis of a VN's page graph for the editor's "Story flow" panel.
 * Walks reachability from page 1 — a page WITH text-choices branches only to
 * those targets; a page with none auto-advances to the next — then collects
 * authoring warnings: empty pages, choices that jump out of range, and pages no
 * path can reach. Pure + unit-tested so the editor's validation can't silently
 * drift from what the player actually experiences.
 */
export function analyzeVnFlow(pages: VnFlowPage[]): { reachable: number[]; warnings: string[] } {
    const reachable = new Set<number>();
    const queue = [0];
    while (queue.length) {
        const i = queue.shift()!;
        if (i < 0 || i >= pages.length || reachable.has(i)) continue;
        reachable.add(i);
        const picks = (pages[i].choices ?? []).filter((c) => c.text.trim());
        if (picks.length) picks.forEach((c) => queue.push(c.nextPage));
        else if (i + 1 < pages.length) queue.push(i + 1);
    }
    const warnings: string[] = [];
    pages.forEach((p, i) => {
        if (!p.dialogue.trim() && !p.scene.trim()) warnings.push(`Page ${i + 1} has no dialogue or scene text.`);
        (p.choices ?? []).filter((c) => c.text.trim()).forEach((c) => {
            if (c.nextPage < 0 || c.nextPage >= pages.length) warnings.push(`Page ${i + 1} choice "${c.text.trim()}" jumps to a page that doesn't exist.`);
        });
        if (!reachable.has(i)) warnings.push(`Page ${i + 1} is unreachable — no choice or sequential path leads to it.`);
    });
    return { reachable: [...reachable], warnings };
}

export type DialogueLine = { speaker: string; text: string };

// Parse a stored "Speaker: text" dialogue blob (one entry per line) into
// structured {speaker, text} rows for the editor. A line with no colon has an
// empty speaker (the VN renderer attributes it to the page speaker). The first
// colon splits speaker from text — exactly how the renderer interprets it — so
// a speakerless narration line containing a colon is the one ambiguous case.
// Inverse of serializeDialogueLines for well-formed lines (round-trip stable).
export function parseDialogueString(dialogue: string): DialogueLine[] {
    return dialogue.split("\n").map((line) => {
        const i = line.indexOf(":");
        if (i < 0) return { speaker: "", text: line };
        const text = line.slice(i + 1);
        return { speaker: line.slice(0, i), text: text.startsWith(" ") ? text.slice(1) : text };
    });
}

// Serialize structured rows back to the "Speaker: text" line format the VN
// renderers and the save path already consume. An empty speaker is written as
// the bare text. Storage format is unchanged, so playback is unaffected.
export function serializeDialogueLines(lines: DialogueLine[]): string {
    return lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n");
}

// Render-time parse of one stored dialogue line into the speaker + spoken text a
// VN renderer displays. Distinct from parseDialogueString (the editor's
// round-trip parser): this trims for display, attributes a colon-less line to
// `fallbackSpeaker`, and — matching long-standing renderer behavior — uses the
// whole line as the spoken text when nothing follows the first colon. Shared by
// every VN renderer so the formerly-inline copies can't drift apart.
export function splitDialogueLine(line: string, fallbackSpeaker: string): { speaker: string; text: string } {
    if (line.includes(":")) {
        const parts = line.split(":");
        return { speaker: parts[0].trim(), text: parts.slice(1).join(":").trim() || line };
    }
    return { speaker: fallbackSpeaker.trim(), text: line.trim() || line };
}
