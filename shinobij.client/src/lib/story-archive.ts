import type { Character } from "../types/character";
import type { CreatorEvent, StoryStep } from "../types/vn";
import type { StoryInterlude } from "../data/story-interludes";
import type { StoryContentPayload } from "./story-content-contract";
import { interludeToCreatorEvent, storyToCreatorEvent } from "./story-trigger";
import { splitDialogueLine } from "./vn";
import { recordedStoryChoices, storyChoiceId } from "./story-choice-history";
import { sanitizeStoryChoices } from "./story-history";

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
    /** False only for migrated saves whose branch choice was never recorded. */
    historyComplete: boolean;
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
            body: "Resume opens this milestone directly. Earlier optional interludes remain waiting and return to their normal order afterward.",
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

function selectedPath(event: CreatorEvent, character: Character, traits: Set<string>): { pages: StoryPage[]; complete: boolean } {
    const pages = event.vnPages ?? [];
    const selected: StoryPage[] = [];
    const pageVisits = new Map<number, number>();
    let pageIndex = 0;
    let complete = true;
    let steps = 0;
    while (pageIndex >= 0 && pageIndex < pages.length && steps++ < 256) {
        const page = pages[pageIndex];
        selected.push(page);
        const choices = page.choices ?? [];
        if (choices.length === 0) {
            pageIndex += 1;
            continue;
        }
        const available = choices.filter((choice) => choiceIsAvailable(choice, traits));
        const receipts = recordedStoryChoices(character, event, pageIndex);
        const visit = pageVisits.get(pageIndex) ?? 0;
        pageVisits.set(pageIndex, visit + 1);
        const receipt = visit < receipts.length ? receipts[visit] : undefined;
        const choice = receipt
            ? choices.find((candidate, index) => storyChoiceId(candidate, index) === receipt.choiceId)
            : (choices.length === 1 && available.length === 1 && !available[0].requireTrait && !available[0].forbidTrait
                ? available[0]
                : undefined);
        if (!choice) { complete = false; break; }
        if (choice.conclusion?.trim()) {
            const conclusion = choice.conclusion.trim();
            const priorLines = page.lines?.length
                ? page.lines
                : page.dialogue.map((line) => splitDialogueLine(line, page.speaker || "Narrator"));
            selected[selected.length - 1] = {
                ...page,
                dialogue: [...page.dialogue, conclusion],
                lines: [...priorLines, { speaker: "Narrator", text: conclusion }],
            };
        }
        if (choice.battle) break;
        if (choice.nextPage === pageIndex) break;
        pageIndex = choice.nextPage;
    }
    return { pages: selected, complete };
}

function recordedDecisions(event: CreatorEvent, character: Character): { text: string; conclusion: string }[] {
    return sanitizeStoryChoices(character.storyChoices).filter((receipt) => receipt.eventId === event.id).flatMap((receipt) => {
        const page = event.vnPages?.[receipt.pageIndex];
        const choice = (page?.choices ?? []).find((candidate, index) => storyChoiceId(candidate, index) === receipt.choiceId);
        return choice ? [{ text: choice.text, conclusion: choice.conclusion ?? "" }] : [];
    });
}

function readOnlyReplayEvent(event: CreatorEvent, character: Character, traits: Set<string>): CreatorEvent {
    const pages = selectedPath(event, character, traits).pages.map((page) => ({
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

function archivePages(event: CreatorEvent, character: Character, traits: Set<string>): StoryArchivePage[] {
    return selectedPath(event, character, traits).pages.map((page) => ({
        title: page.title,
        scene: page.scene,
        image: page.image,
        lines: (page.lines?.length
            ? page.lines
            : page.dialogue.map((line) => splitDialogueLine(line, page.speaker || "Narrator"))
        ).map((line) => ({ speaker: line.speaker, text: line.text })),
    }));
}

function chapterPages(event: CreatorEvent, character: Character, traits: Set<string>): StoryArchivePage[] {
    const stepPages = event.vnPages;
    const pages = stepPages?.length
        ? stepPages
        : [{
            title: event.vnTitle ?? event.name,
            scene: event.vnScene ?? "",
            speaker: "Narrator",
            dialogue: event.dialogue,
        }];
    return archivePages({ ...event, vnPages: pages }, character, traits);
}

function interludePages(interlude: StoryInterlude, event: CreatorEvent, character: Character, traits: Set<string>): StoryArchivePage[] {
    return archivePages(event, character, traits).map((page, pageIndex) => ({
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
            const event = storyToCreatorEvent(step, village, index);
            const path = selectedPath(event, character, traits);
            return {
                id,
                kind: "chapter",
                level: step.levelReq,
                title: step.title,
                eyebrow: `Chapter ${index + 1} · ${step.bossName} defeated`,
                icon: step.bossIcon,
                pages: chapterPages(event, character, traits),
                decisions: recordedDecisions(event, character),
                replayEvent: readOnlyReplayEvent(event, character, traits),
                historyComplete: path.complete,
            };
        });
    const interludes = (content.village === village ? content.interludes : []).flatMap((interlude): CompletedStoryArchiveEntry[] => {
        const event = interludeToCreatorEvent(interlude);
        const finalChoices = interlude.pages.at(-1)?.choices ?? [];
        const finalPageIndex = Math.max(0, interlude.pages.length - 1);
        const finalReceipt = recordedStoryChoices(character, event, finalPageIndex).find((receipt) => !!receipt.trait);
        const picked = finalReceipt
            ? finalChoices.find((choice, index) => storyChoiceId(choice, index) === finalReceipt.choiceId)
            : finalChoices.find((choice) => choice.trait && traits.has(choice.trait));
        if (!picked) return [];
        const path = selectedPath(event, character, traits);
        return [{
            id: interlude.id,
            kind: "interlude",
            level: interlude.levelReq,
            title: interlude.title,
            eyebrow: `Interlude · level ${interlude.levelReq}`,
            icon: "📜",
            pages: interludePages(interlude, event, character, traits),
            decisions: recordedDecisions(event, character),
            replayEvent: readOnlyReplayEvent(event, character, traits),
            historyComplete: path.complete,
        }];
    });
    return [...chapters, ...interludes].sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));
}
