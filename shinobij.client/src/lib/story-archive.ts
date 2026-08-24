import type { Character } from "../types/character";
import type { CreatorEvent, StoryStep } from "../types/vn";
import type { StoryInterlude } from "../data/story-interludes";
import type { StoryContentPayload } from "./story-content-contract";
import { interludeToCreatorEvent, storyToCreatorEvent } from "./story-trigger";
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
    decisions: { text: string; conclusion: string }[];
    replayEvent: CreatorEvent;
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

type StoryPage = NonNullable<StoryStep["pages"]>[number];

function choiceIsAvailable(choice: NonNullable<StoryPage["choices"]>[number], traits: Set<string>): boolean {
    if (choice.requireTrait && !traits.has(choice.requireTrait)) return false;
    if (choice.forbidTrait && traits.has(choice.forbidTrait)) return false;
    return true;
}

function selectedChoice(page: StoryPage, traits: Set<string>) {
    const available = (page.choices ?? []).filter((choice) => choiceIsAvailable(choice, traits));
    return available.find((choice) => choice.trait && traits.has(choice.trait))
        ?? (available.length === 1 ? available[0] : undefined);
}

function selectedPath(pages: StoryPage[], traits: Set<string>): StoryPage[] {
    const selected: StoryPage[] = [];
    const visited = new Set<number>();
    let pageIndex = 0;
    while (pageIndex >= 0 && pageIndex < pages.length && !visited.has(pageIndex)) {
        visited.add(pageIndex);
        const page = pages[pageIndex];
        selected.push(page);
        const choices = page.choices ?? [];
        if (choices.length === 0) {
            pageIndex += 1;
            continue;
        }
        const choice = selectedChoice(page, traits);
        if (!choice || choice.nextPage === pageIndex) break;
        pageIndex = choice.nextPage;
    }
    return selected;
}

function recordedDecisions(pages: StoryPage[], traits: Set<string>): { text: string; conclusion: string }[] {
    const seen = new Set<string>();
    return pages.flatMap((page) => (page.choices ?? []).flatMap((choice) => {
        if (!choice.trait || !traits.has(choice.trait) || seen.has(choice.trait)) return [];
        seen.add(choice.trait);
        return [{ text: choice.text, conclusion: choice.conclusion ?? "" }];
    }));
}

function readOnlyReplayEvent(event: CreatorEvent, traits: Set<string>): CreatorEvent {
    const pages = selectedPath(event.vnPages ?? [], traits).map((page) => ({
        ...page,
        // The archive has already resolved the durable choice. Removing the live
        // controls makes replay incapable of granting a trait or launching the
        // battle/reward path a second time while preserving the chosen branch.
        choices: undefined,
    }));
    return {
        ...event,
        eventKind: "visualNovel",
        vnPages: pages,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        currencyRewards: undefined,
        aiProfileId: undefined,
    };
}

function archivePages(pages: StoryPage[], traits: Set<string>): StoryArchivePage[] {
    return selectedPath(pages, traits).map((page) => ({
        title: page.title,
        scene: page.scene,
        image: page.image,
        lines: (page.lines?.length
            ? page.lines
            : page.dialogue.map((line) => splitDialogueLine(line, page.speaker || "Narrator"))
        ).map((line) => ({ speaker: line.speaker, text: line.text })),
    }));
}

function chapterPages(step: StoryStep, traits: Set<string>): StoryArchivePage[] {
    const pages = step.pages?.length
        ? step.pages
        : [{
            title: step.cinematicTitle,
            scene: step.scene,
            speaker: "Narrator",
            dialogue: step.dialogue,
        }];
    return archivePages(pages, traits);
}

function interludePages(interlude: StoryInterlude, traits: Set<string>): StoryArchivePage[] {
    return archivePages(interlude.pages, traits).map((page, pageIndex) => ({
        ...page,
        image: page.image ?? (pageIndex === 0 ? `/scenes/story/${interlude.id}.webp` : undefined),
    }));
}

export function buildCompletedStoryArchive(character: Character, content: StoryContentPayload): CompletedStoryArchiveEntry[] {
    const village = character.storyVillage || character.village;
    const traits = new Set(character.storyTraits ?? []);
    const completedChapterCount = Math.max(0, character.storyProgress ?? 0);
    const chapters = (content.village === village ? content.chapters : [])
        .slice(0, completedChapterCount)
        .map((step, index): CompletedStoryArchiveEntry => {
            const id = `chapter-${step.levelReq}-${index}`;
            return {
                id,
                kind: "chapter",
                level: step.levelReq,
                title: step.title,
                eyebrow: `Chapter ${index + 1} · ${step.bossName} defeated`,
                icon: step.bossIcon,
                pages: chapterPages(step, traits),
                decisions: recordedDecisions(step.pages ?? [], traits),
                replayEvent: readOnlyReplayEvent(storyToCreatorEvent(step, village, index), traits),
            };
        });
    const interludes = (content.village === village ? content.interludes : []).flatMap((interlude): CompletedStoryArchiveEntry[] => {
        const finalChoices = interlude.pages.at(-1)?.choices ?? [];
        const picked = finalChoices.find((choice) => choice.trait && traits.has(choice.trait));
        if (!picked) return [];
        return [{
            id: interlude.id,
            kind: "interlude",
            level: interlude.levelReq,
            title: interlude.title,
            eyebrow: `Interlude · level ${interlude.levelReq}`,
            icon: "📜",
            pages: interludePages(interlude, traits),
            decisions: recordedDecisions(interlude.pages, traits),
            replayEvent: readOnlyReplayEvent(interludeToCreatorEvent(interlude), traits),
        }];
    });
    return [...chapters, ...interludes].sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));
}
