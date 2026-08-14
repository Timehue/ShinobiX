import type { Character } from "../types/character";
import type { StoryStep } from "../types/vn";
import type { StoryInterlude } from "../data/story-interludes";
import type { StoryContentPayload } from "./story-content-contract";
import { splitDialogueLine } from "./vn";

export type StoryArchivePage = {
    title: string;
    scene: string;
    lines: { speaker: string; text: string }[];
    image?: string;
};

export type CompletedStoryArchiveEntry = {
    id: string;
    kind: "chapter" | "interlude";
    level: number;
    title: string;
    eyebrow: string;
    icon: string;
    pages: StoryArchivePage[];
    chosen?: { text: string; conclusion: string };
};

export type StoryArchiveGuidance = {
    state: "ready" | "level-gated" | "complete" | "unavailable";
    kicker: string;
    title: string;
    body: string;
    actionLabel?: string;
};

/**
 * Give the Story Hall a useful next step without leaking future chapter names,
 * bosses, choices, or interludes into the archive DOM. The live story trigger
 * remains authoritative; this is orientation and recovery copy only.
 */
export function storyArchiveGuidance(character: Character, content: StoryContentPayload): StoryArchiveGuidance {
    const village = character.storyVillage || character.village;
    const chapters = content.village === village ? content.chapters : [];
    if (chapters.length === 0) {
        return {
            state: "unavailable",
            kicker: "CHRONICLE UNBOUND",
            title: "No village story is bound to this record",
            body: "Return to your village and continue the road. The archive will open when a village chapter is completed.",
            actionLabel: "Return to Village",
        };
    }

    const progress = Math.max(0, Math.floor(character.storyProgress ?? 0));
    if (progress >= chapters.length) {
        return {
            state: "complete",
            kicker: "VILLAGE LEGACY SEALED",
            title: "Your village story is complete",
            body: "Every finished chapter is preserved below. Your choices and victories remain part of the village record.",
        };
    }

    const nextLevel = chapters[progress].levelReq;
    if ((character.level ?? 0) >= nextLevel) {
        return {
            state: "ready",
            kicker: "NEXT CHAPTER READY",
            title: "The road is ready to continue",
            body: "Return to the village. Your current chapter will begin automatically once you are outside combat.",
            actionLabel: "Return to Village",
        };
    }

    return {
        state: "level-gated",
        kicker: "NEXT MILESTONE",
        title: `Reach level ${nextLevel}`,
        body: "Grow through Missions, Training, and the World Map. The next chapter will find you automatically when you qualify.",
        actionLabel: "Return to Village",
    };
}

function chapterPages(step: StoryStep): StoryArchivePage[] {
    const pages = step.pages?.length
        ? step.pages
        : [{
            title: step.cinematicTitle,
            scene: step.scene,
            speaker: "Narrator",
            dialogue: step.dialogue,
        }];
    return pages.map((page) => ({
        title: page.title,
        scene: page.scene,
        image: page.image,
        lines: (page.lines?.length
            ? page.lines
            : page.dialogue.map((line) => splitDialogueLine(line, page.speaker || "Narrator"))
        ).map((line) => ({ speaker: line.speaker, text: line.text })),
    }));
}

function interludePages(interlude: StoryInterlude): StoryArchivePage[] {
    return interlude.pages.map((page, pageIndex) => ({
        title: page.title,
        scene: page.scene,
        image: pageIndex === 0 ? `/scenes/story/${interlude.id}.webp` : undefined,
        lines: page.dialogue
            .map((line) => splitDialogueLine(line, page.speaker || "Narrator"))
            .map((line) => ({ speaker: line.speaker, text: line.text })),
    }));
}

export function buildCompletedStoryArchive(character: Character, content: StoryContentPayload): CompletedStoryArchiveEntry[] {
    const village = character.storyVillage || character.village;
    const traits = character.storyTraits ?? [];
    const completedChapterCount = Math.max(0, character.storyProgress ?? 0);
    const chapters = (content.village === village ? content.chapters : [])
        .slice(0, completedChapterCount)
        .map((step, index): CompletedStoryArchiveEntry => ({
            id: `chapter-${step.levelReq}-${index}`,
            kind: "chapter",
            level: step.levelReq,
            title: step.title,
            eyebrow: `Chapter ${index + 1} · ${step.bossName} defeated`,
            icon: step.bossIcon,
            pages: chapterPages(step),
        }));
    const interludes = (content.village === village ? content.interludes : []).flatMap((interlude): CompletedStoryArchiveEntry[] => {
        const finalChoices = interlude.pages.at(-1)?.choices ?? [];
        const picked = finalChoices.find((choice) => choice.trait && traits.includes(choice.trait));
        if (!picked) return [];
        return [{
            id: interlude.id,
            kind: "interlude",
            level: interlude.levelReq,
            title: interlude.title,
            eyebrow: `Interlude · level ${interlude.levelReq}`,
            icon: "📜",
            pages: interludePages(interlude),
            chosen: { text: picked.text, conclusion: picked.conclusion ?? "" },
        }];
    });
    return [...chapters, ...interludes].sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));
}
