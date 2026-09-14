import type { Character, PendingStoryReport, StoryChoiceReceipt, StoryCursor } from "../types/character";
import {
    sanitizePendingStoryReports,
    sanitizeStoryChoices,
    sanitizeStoryEpilogues,
    sanitizeStoryScene,
    storyDecisionKey,
    STORY_CHOICE_LIMIT,
    STORY_REPORT_LIMIT,
} from "./story-history";

const cleanId = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function recordStoryScene(character: Character, eventId: string, cursor: StoryCursor, history: StoryCursor[]): Character {
    const storyScene = sanitizeStoryScene({ version: 1, eventId, ...cursor, history });
    return storyScene ? { ...character, storyScene } : character;
}

/** First write wins for a decision point; reopening can never replace its canon. */
export function recordStoryChoice(character: Character, receipt: StoryChoiceReceipt): Character {
    const current = sanitizeStoryChoices(character.storyChoices);
    const key = storyDecisionKey(receipt);
    if (current.some((row) => storyDecisionKey(row) === key)) return character;
    return { ...character, storyChoices: [...current, receipt].slice(-STORY_CHOICE_LIMIT) };
}

export function queueStoryReport(character: Character, report: Omit<PendingStoryReport, "version">): Character {
    const pending = sanitizePendingStoryReports(character.pendingStoryReports);
    if (pending.some((row) => row.kind === report.kind && row.eventId === report.eventId)) return character;
    const queued: PendingStoryReport = { version: 1, ...report };
    return { ...character, pendingStoryReports: [...pending, queued].slice(-STORY_REPORT_LIMIT) };
}

export function nextPendingStoryReport(character: Pick<Character, "pendingStoryReports">): PendingStoryReport | undefined {
    return sanitizePendingStoryReports(character.pendingStoryReports).find((report) => report.status !== "conflict");
}

export function recordStoryReportConflict(character: Character, report: PendingStoryReport, recordedTrait?: string): Character {
    const pending = sanitizePendingStoryReports(character.pendingStoryReports);
    return {
        ...character,
        pendingStoryReports: pending.map((row) => row.kind === report.kind && row.eventId === report.eventId && row.trait === report.trait
            ? { ...row, status: "conflict" as const, ...(cleanId(recordedTrait) ? { recordedTrait: cleanId(recordedTrait) } : {}) }
            : row),
    };
}

export function acknowledgeStoryReport(character: Character, report: Pick<PendingStoryReport, "kind" | "eventId" | "trait">): Character {
    const pending = sanitizePendingStoryReports(character.pendingStoryReports);
    const next = pending.filter((row) => !(row.kind === report.kind && row.eventId === report.eventId && row.trait === report.trait));
    return next.length === pending.length ? character : { ...character, pendingStoryReports: next };
}

export function markStoryEpilogueSeen(character: Character, chapterEventId: string): Character {
    const current = sanitizeStoryEpilogues(character.storyEpilogues);
    let changed = false;
    const next = current.map((row) => {
        if (row.chapterEventId !== chapterEventId || row.status === "seen") return row;
        changed = true;
        return { ...row, status: "seen" as const };
    });
    return changed ? { ...character, storyEpilogues: next } : character;
}
