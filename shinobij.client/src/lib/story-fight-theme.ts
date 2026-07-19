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
    /** Ordered bark lines: [0] on fight start, [1] at ~2/3 boss HP, [2] at ~1/3. */
    barks?: string[];
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

/**
 * Pull up to three of the boss's own lines out of the chapter's authored VN
 * pages (typed `lines` first, legacy "Speaker: text" dialogue as fallback),
 * spread across the script so the fight retells the chapter: opening threat,
 * mid-fight escalation, last stand.
 */
export function extractBossBarks(
    pages: CreatorEvent["vnPages"],
    bossName: string,
    legacyDialogue?: string[],
): string[] {
    const wanted = bossName.trim().toLowerCase();
    if (!wanted) return [];
    const spoken: string[] = [];
    for (const page of pages ?? []) {
        for (const line of page.lines ?? []) {
            if (line.speaker.trim().toLowerCase() === wanted && line.text.trim()) spoken.push(cleanBark(line.text));
        }
        if (!page.lines?.length) {
            for (const raw of page.dialogue ?? []) {
                const split = raw.indexOf(":");
                if (split > 0 && raw.slice(0, split).trim().toLowerCase() === wanted) spoken.push(cleanBark(raw.slice(split + 1)));
            }
        }
    }
    if (!spoken.length) {
        for (const raw of legacyDialogue ?? []) {
            const split = raw.indexOf(":");
            if (split > 0 && raw.slice(0, split).trim().toLowerCase() === wanted) spoken.push(cleanBark(raw.slice(split + 1)));
        }
    }
    if (spoken.length <= 3) return spoken;
    return [spoken[0], spoken[Math.floor(spoken.length / 2)], spoken[spoken.length - 1]];
}
