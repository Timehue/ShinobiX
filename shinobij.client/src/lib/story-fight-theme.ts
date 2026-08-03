import type { CreatorEvent } from "../types/vn";

/*
 * Story-boss fight presentation + launch bus.
 *
 * Both story lanes (Story Hall chapters and the auto-trigger VN chapter
 * battles) launch the SAME sealed server fight (api/story/boss-start) through
 * requestStoryBossFight(). The single host — components/StoryBossFightHost,
 * mounted once in App — subscribes, starts the session, and renders the fight
 * in a full-screen portal with the chapter's theme: the authored scene art as
 * the battle backdrop, a chapter label, and mid-fight boss "barks".
 *
 * Barks reuse the boss's OWN authored VN lines (typed page lines, else legacy
 * "Speaker: text" dialogue) — canon voice, zero new prose. They are pure
 * presentation: nothing here touches stats, damage, or rewards.
 */

export type StoryFightTheme = {
    bossName: string;
    chapterLabel?: string;
    backdropImage?: string;
    /** The chapter antagonist's authored portrait, shown as the enemy on the fight
     *  board (dossier + bark face). Resolved from the chapter's VN art at launch;
     *  absent → the arena shell falls back to initials. Display-only. */
    bossPortrait?: string;
    /** Ordered bark lines: [0] on fight start, [1] at ~2/3 boss HP, [2] at ~1/3. */
    barks?: string[];
    /** The boss's last authored words — spoken on the killing blow. */
    defeatLine?: string;
    /** Mentor cut-ins: [0] when the PLAYER falls under half HP, [1] under 20%. */
    ally?: { name: string; lines: string[] };
    /** Village key for the shared chapter seal cue (lib/story-sfx). */
    village?: string;
};

type Listener = (theme: StoryFightTheme) => void;
let listener: Listener | null = null;

/** Host registration (single subscriber — the App-mounted StoryBossFightHost). */
export function onStoryBossFightRequest(fn: Listener): () => void {
    listener = fn;
    return () => { if (listener === fn) listener = null; };
}

/** Returns false when no host is mounted (caller should fall back / alert). */
export function requestStoryBossFight(theme: StoryFightTheme): boolean {
    if (!listener) return false;
    listener(theme);
    return true;
}

const BARK_MAX_CHARS = 160;

function cleanBark(text: string): string {
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed.length > BARK_MAX_CHARS ? `${trimmed.slice(0, BARK_MAX_CHARS - 1)}…` : trimmed;
}

function linesBySpeaker(
    pages: CreatorEvent["vnPages"],
    legacyDialogue: string[] | undefined,
    match: (speaker: string) => boolean,
): string[] {
    const spoken: string[] = [];
    for (const page of pages ?? []) {
        for (const line of page.lines ?? []) {
            if (match(line.speaker.trim().toLowerCase()) && line.text.trim()) spoken.push(cleanBark(line.text));
        }
        if (!page.lines?.length) {
            for (const raw of page.dialogue ?? []) {
                const split = raw.indexOf(":");
                if (split > 0 && match(raw.slice(0, split).trim().toLowerCase())) spoken.push(cleanBark(raw.slice(split + 1)));
            }
        }
    }
    if (!spoken.length) {
        for (const raw of legacyDialogue ?? []) {
            const split = raw.indexOf(":");
            if (split > 0 && match(raw.slice(0, split).trim().toLowerCase())) spoken.push(cleanBark(raw.slice(split + 1)));
        }
    }
    return spoken;
}

/**
 * Pull the boss's own lines out of the chapter's authored VN pages (typed
 * `lines` first, legacy "Speaker: text" dialogue as fallback) and spread them
 * across the fight so it retells the chapter: opening threat, escalation,
 * last stand — and the boss's final authored words on the killing blow.
 */
export function extractStoryFightScript(
    pages: CreatorEvent["vnPages"],
    bossName: string,
    legacyDialogue?: string[],
): { barks: string[]; defeatLine?: string } {
    const wanted = bossName.trim().toLowerCase();
    if (!wanted) return { barks: [] };
    const spoken = linesBySpeaker(pages, legacyDialogue, (speaker) => speaker === wanted);
    if (!spoken.length) return { barks: [] };
    if (spoken.length === 1) return { barks: spoken };
    if (spoken.length === 2) return { barks: [spoken[0]], defeatLine: spoken[1] };
    if (spoken.length === 3) return { barks: [spoken[0], spoken[1]], defeatLine: spoken[2] };
    return {
        barks: [spoken[0], spoken[Math.floor((spoken.length - 1) / 2)], spoken[spoken.length - 2]],
        defeatLine: spoken[spoken.length - 1],
    };
}

/**
 * The chapter's most-present voice that ISN'T the boss or the narrator (or the
 * player) — the mentor figure. Their first and last lines become cut-ins when
 * the PLAYER is hurting. Same zero-new-prose rule as the boss barks.
 */
export function extractMentorLines(
    pages: CreatorEvent["vnPages"],
    bossName: string,
    playerName: string,
    legacyDialogue?: string[],
): { name: string; lines: string[] } | undefined {
    const excluded = new Set(["", "narrator", bossName.trim().toLowerCase(), playerName.trim().toLowerCase()]);
    const counts = new Map<string, { name: string; count: number }>();
    for (const page of pages ?? []) {
        for (const line of page.lines ?? []) {
            const key = line.speaker.trim().toLowerCase();
            if (excluded.has(key) || !line.text.trim()) continue;
            const entry = counts.get(key) ?? { name: line.speaker.trim(), count: 0 };
            entry.count += 1;
            counts.set(key, entry);
        }
        if (!page.lines?.length) {
            for (const raw of page.dialogue ?? []) {
                const split = raw.indexOf(":");
                if (split <= 0) continue;
                const name = raw.slice(0, split).trim();
                const key = name.toLowerCase();
                if (excluded.has(key)) continue;
                const entry = counts.get(key) ?? { name, count: 0 };
                entry.count += 1;
                counts.set(key, entry);
            }
        }
    }
    let mentor: { name: string; count: number } | undefined;
    for (const entry of counts.values()) {
        if (!mentor || entry.count > mentor.count) mentor = entry;
    }
    if (!mentor) return undefined;
    const key = mentor.name.toLowerCase();
    const spoken = linesBySpeaker(pages, legacyDialogue, (speaker) => speaker === key);
    if (!spoken.length) return undefined;
    return {
        name: mentor.name,
        lines: spoken.length === 1 ? [spoken[0]] : [spoken[0], spoken[spoken.length - 1]],
    };
}
