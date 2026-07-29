import type { Character } from "../types/character";
import type { StoryStep } from "../types/vn";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage, type StoryInterlude } from "../data/story-interludes";
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

export function buildCompletedStoryArchive(character: Character): CompletedStoryArchiveEntry[] {
    const village = character.storyVillage || character.village;
    const traits = character.storyTraits ?? [];
    const completedChapterCount = Math.max(0, character.storyProgress ?? 0);
    const chapters = (storylines[village] ?? [])
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
    const interludes = (storyInterludesByVillage[village] ?? []).flatMap((interlude): CompletedStoryArchiveEntry[] => {
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
