import type {
    Character,
    PendingStoryReport,
    StoryChoiceReceipt,
    StoryCursor,
    StoryEpilogueReceipt,
    StorySceneResume,
} from "../types/character";
import { deriveStoryTraits } from "./story-derive";

export const STORY_CHOICE_LIMIT = 512;
export const STORY_HISTORY_LIMIT = 256;
export const STORY_REPORT_LIMIT = 64;
export const STORY_EPILOGUE_LIMIT = 8;

export function normalizeNarrativeFields(character: Character): Pick<Character, "storyTraits" | "storyChoices" | "storyScene" | "pendingStoryReports" | "storyEpilogues"> {
    const storyChoices = sanitizeStoryChoices(character.storyChoices);
    const normalized = {
        storyTraits: deriveStoryTraits(Array.isArray(character.storyTraits) ? character.storyTraits.filter(Boolean) : [], storyChoices),
        storyChoices,
        storyScene: sanitizeStoryScene(character.storyScene) ?? null,
        pendingStoryReports: sanitizePendingStoryReports(character.pendingStoryReports),
        storyEpilogues: sanitizeStoryEpilogues(character.storyEpilogues),
    };
    const recovered = recoverPendingStoryEpilogue({ ...character, ...normalized });
    return {
        storyTraits: recovered.storyTraits ?? [], storyChoices: recovered.storyChoices ?? [],
        storyScene: recovered.storyScene ?? null, pendingStoryReports: recovered.pendingStoryReports ?? [],
        storyEpilogues: recovered.storyEpilogues ?? [],
    };
}

const cleanId = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const whole = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

export function storyDecisionKey(receipt: Pick<StoryChoiceReceipt, "eventId" | "pageId">): string {
    const row = receipt as StoryChoiceReceipt;
    const suffix = row.battle ? "\u0000terminal" : row.revisitable ? `\u0000${row.choiceId}` : "";
    return `${receipt.eventId}\u0000${receipt.pageId}${suffix}`;
}


export function sanitizeStoryChoices(value: unknown): StoryChoiceReceipt[] {
    if (!Array.isArray(value)) return [];
    const out: StoryChoiceReceipt[] = [];
    const decisions = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<StoryChoiceReceipt>;
        const eventId = cleanId(row.eventId), pageId = cleanId(row.pageId), choiceId = cleanId(row.choiceId);
        if (!eventId || !pageId || !choiceId) continue;
        const receipt: StoryChoiceReceipt = {
            version: 1,
            eventId,
            pageId,
            choiceId,
            pageIndex: whole(row.pageIndex, 999),
            choiceIndex: whole(row.choiceIndex, 99),
            nextPage: whole(row.nextPage, 999),
            ...(cleanId(row.trait) ? { trait: cleanId(row.trait) } : {}),
            ...(row.battle === true ? { battle: true } : {}),
            ...(row.revisitable === true ? { revisitable: true } : {}),
        };
        const key = storyDecisionKey(receipt);
        if (decisions.has(key)) continue;
        decisions.add(key);
        out.push(receipt);
        if (out.length >= STORY_CHOICE_LIMIT) break;
    }
    return out;
}

/** First write wins for a decision point; reopening can never replace its canon. */
export function recordStoryChoice(character: Character, receipt: StoryChoiceReceipt): Character {
    const current = sanitizeStoryChoices(character.storyChoices);
    const key = storyDecisionKey(receipt);
    if (current.some((row) => storyDecisionKey(row) === key)) return character;
    return { ...character, storyChoices: [...current, receipt].slice(-STORY_CHOICE_LIMIT) };
}

function sanitizeCursor(value: unknown): StoryCursor | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<StoryCursor>;
    return { pageIndex: whole(row.pageIndex, 999), lineIndex: whole(row.lineIndex, 999) };
}

export function sanitizeStoryScene(value: unknown): StorySceneResume | undefined {
    if (!value || typeof value !== "object") return undefined;
    const row = value as Partial<StorySceneResume>;
    const eventId = cleanId(row.eventId);
    const cursor = sanitizeCursor(row);
    if (!eventId || !cursor) return undefined;
    const history = Array.isArray(row.history)
        ? row.history.map(sanitizeCursor).filter((entry): entry is StoryCursor => !!entry).slice(-STORY_HISTORY_LIMIT)
        : [];
    return { version: 1, eventId, ...cursor, history };
}

export function recordStoryScene(character: Character, eventId: string, cursor: StoryCursor, history: StoryCursor[]): Character {
    const storyScene = sanitizeStoryScene({ version: 1, eventId, ...cursor, history });
    return storyScene ? { ...character, storyScene } : character;
}

export function clearStoryScene(character: Character, eventId?: string): Character {
    if (!character.storyScene || (eventId && character.storyScene.eventId !== eventId)) return character;
    return { ...character, storyScene: null };
}

export function sanitizePendingStoryReports(value: unknown): PendingStoryReport[] {
    if (!Array.isArray(value)) return [];
    const out: PendingStoryReport[] = [], seen = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<PendingStoryReport>;
        const kind = row.kind === "interlude" || row.kind === "road" ? row.kind : null;
        const eventId = cleanId(row.eventId), trait = cleanId(row.trait);
        if (!kind || !eventId || !trait) continue;
        const key = `${kind}:${eventId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const recordedTrait = cleanId(row.recordedTrait);
        out.push({
            version: 1, kind, eventId, trait,
            ...(row.status === "conflict" ? { status: "conflict" as const } : {}),
            ...(row.status === "conflict" && recordedTrait ? { recordedTrait } : {}),
        });
        if (out.length >= STORY_REPORT_LIMIT) break;
    }
    return out;
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

export function queueStoryReport(character: Character, report: Omit<PendingStoryReport, "version">): Character {
    const pending = sanitizePendingStoryReports(character.pendingStoryReports);
    if (pending.some((row) => row.kind === report.kind && row.eventId === report.eventId)) return character;
    const queued: PendingStoryReport = { version: 1, ...report };
    return { ...character, pendingStoryReports: [...pending, queued].slice(-STORY_REPORT_LIMIT) };
}

export function acknowledgeStoryReport(character: Character, report: Pick<PendingStoryReport, "kind" | "eventId" | "trait">): Character {
    const pending = sanitizePendingStoryReports(character.pendingStoryReports);
    const next = pending.filter((row) => !(row.kind === report.kind && row.eventId === report.eventId && row.trait === report.trait));
    return next.length === pending.length ? character : { ...character, pendingStoryReports: next };
}

export function sanitizeStoryEpilogues(value: unknown): StoryEpilogueReceipt[] {
    if (!Array.isArray(value)) return [];
    const out: StoryEpilogueReceipt[] = [], seen = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<StoryEpilogueReceipt>;
        const chapterEventId = cleanId(row.chapterEventId), lane = cleanId(row.lane);
        if (!chapterEventId || !lane || seen.has(chapterEventId)) continue;
        seen.add(chapterEventId);
        out.push({
            version: 1,
            chapterEventId,
            lane,
            status: row.status === "seen" ? "seen" : "pending",
            presentationTraits: Array.isArray(row.presentationTraits)
                ? [...new Set(row.presentationTraits.map((trait) => cleanId(trait)).filter(Boolean))].slice(0, 96)
                : [],
        });
        if (out.length >= STORY_EPILOGUE_LIMIT) break;
    }
    return out;
}

export function recordPendingStoryEpilogue(character: Character, chapterEventId: string, lane: string): Character {
    const current = sanitizeStoryEpilogues(character.storyEpilogues);
    if (current.some((row) => row.chapterEventId === chapterEventId)) return character;
    const receipt: StoryEpilogueReceipt = {
        version: 1,
        chapterEventId,
        lane,
        status: "pending",
        presentationTraits: [...new Set(character.storyTraits ?? [])].filter((trait) =>
            /^(?:al|sv|ff|ms)(?:88-better-|100-(?:proof-presented-|vanta-testified$|mori-testified$|sova-testified$|iro-testified$|nyx-named-herself$))/.test(trait)
        ).slice(-96),
    };
    return {
        ...character,
        storyEpilogues: [...current, receipt].slice(-STORY_EPILOGUE_LIMIT),
    };
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

export function pendingStoryEpilogue(character: Character): StoryEpilogueReceipt | undefined {
    return sanitizeStoryEpilogues(character.storyEpilogues).find((row) => row.status === "pending");
}

/** Recover a finale acknowledgement whose response or first local save was
 * interrupted. Progress 9 is the sealed win proof; the exact terminal receipt
 * supplies the lane. Historical saves missing that receipt remain unknown. */
export function recoverPendingStoryEpilogue(character: Character): Character {
    if ((Number(character.storyProgress) || 0) < 9) return character;
    const village = character.storyVillage || character.village;
    const chapterEventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-100-8`;
    if (sanitizeStoryEpilogues(character.storyEpilogues).some((row) => row.chapterEventId === chapterEventId)) return character;
    const terminal = [...sanitizeStoryChoices(character.storyChoices)].reverse()
        .find((receipt) => receipt.eventId === chapterEventId && receipt.battle && receipt.trait);
    return terminal?.trait
        ? recordPendingStoryEpilogue(clearStoryScene(character, chapterEventId), chapterEventId, terminal.trait)
        : character;
}

export type NarrativeDelivery = { kind: "epilogue"; receipt: StoryEpilogueReceipt } | { kind: "rift"; riftId: string };

function mergeEchoesStorySeen(
    authoritative: Character["echoesStorySeen"],
    local: Character["echoesStorySeen"],
): Character["echoesStorySeen"] {
    const merged: NonNullable<Character["echoesStorySeen"]> = {};
    let present = false;
    for (const source of [authoritative, local]) {
        if (!source || typeof source !== "object" || Array.isArray(source)) continue;
        present = true;
        for (const [id, raw] of Object.entries(source)) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
            const prior = merged[id];
            const pre = prior?.pre === true || raw.pre === true;
            const post = prior?.post === true || raw.post === true;
            if (pre || post) merged[id] = { ...(pre ? { pre: true } : {}), ...(post ? { post: true } : {}) };
        }
    }
    return present ? merged : undefined;
}

/** Pending post-win scenes are serialized ahead of ordinary story selection. */
export function nextNarrativeDelivery(character: Character, triggeredEvents: readonly string[]): NarrativeDelivery | undefined {
    const epilogue = character.storyProgress >= 9 ? pendingStoryEpilogue(character) : undefined;
    if (epilogue) return { kind: "epilogue", receipt: epilogue };
    const rift = Object.entries(character.riftFirstClears ?? {})
        .filter(([riftId, receipt]) => riftId.startsWith("rift-") && !!receipt && typeof receipt === "object"
            && !triggeredEvents.includes(`rift-first-clear-${riftId.slice("rift-".length)}`))
        .sort(([, left], [, right]) => (Number(left?.at) || 0) - (Number(right?.at) || 0))[0];
    return rift ? { kind: "rift", riftId: rift[0] } : undefined;
}

/** Merge only same-account, narrative-only client state around an authoritative mutation. */
export function preserveNarrativeState(authoritative: Character, local: Character | null | undefined): Character {
    if (!local || authoritative.name.trim().toLowerCase() !== local.name.trim().toLowerCase()) return authoritative;
    let merged = authoritative;
    const authoritativeChoices = sanitizeStoryChoices(authoritative.storyChoices), localChoices = sanitizeStoryChoices(local.storyChoices);
    const localByDecision = new Map(localChoices.map((row) => [storyDecisionKey(row), row]));
    const authoritativeDecisions = new Set(authoritativeChoices.map(storyDecisionKey));
    const choices = sanitizeStoryChoices([
        ...authoritativeChoices.map((row) => localByDecision.get(storyDecisionKey(row)) ?? row),
        ...localChoices.filter((row) => !authoritativeDecisions.has(storyDecisionKey(row))),
    ]);
    const reports = Object.prototype.hasOwnProperty.call(local, "pendingStoryReports")
        ? sanitizePendingStoryReports(local.pendingStoryReports)
        : sanitizePendingStoryReports(authoritative.pendingStoryReports);
    const epiloguesByChapter = new Map<string, StoryEpilogueReceipt>();
    for (const row of [...sanitizeStoryEpilogues(authoritative.storyEpilogues), ...sanitizeStoryEpilogues(local.storyEpilogues)]) {
        const prior = epiloguesByChapter.get(row.chapterEventId);
        if (!prior) epiloguesByChapter.set(row.chapterEventId, row);
        else if (row.status === "seen" && prior.status !== "seen") epiloguesByChapter.set(row.chapterEventId, { ...prior, status: "seen" });
    }
    const rawTraits = [...new Set([...(authoritative.storyTraits ?? []), ...(local.storyTraits ?? []), ...choices.map((row) => row.trait).filter((trait): trait is string => !!trait)])];
    const traits = deriveStoryTraits(rawTraits, choices).filter((trait) =>
        !trait.startsWith("sf-") || (authoritative.storyTraits ?? []).includes(trait));
    merged = {
        ...merged,
        storyTraits: traits,
        storyChoices: choices,
        pendingStoryReports: reports,
        storyEpilogues: [...epiloguesByChapter.values()].slice(-STORY_EPILOGUE_LIMIT),
        echoesStorySeen: mergeEchoesStorySeen(authoritative.echoesStorySeen, local.echoesStorySeen),
    };
    const localOwnsScene = Object.prototype.hasOwnProperty.call(local, "storyScene");
    const scene = sanitizeStoryScene(localOwnsScene ? local.storyScene : authoritative.storyScene);
    if (scene) merged.storyScene = scene;
    else merged.storyScene = null;
    return merged;
}

/** Adopt a story settlement while retaining the exact pre-fight choices and
 * sealing one pending ending only for the first accepted finale clear. */
export function prepareStorySettlement(
    authoritative: Character,
    local: Character | null | undefined,
    finale: boolean,
    replayed: boolean,
    fallbackLane: string | null,
): Character {
    let merged = preserveNarrativeState(authoritative, local);
    if (local?.storyScene?.eventId && /^story-(?!interlude-|road-).+-\d+-\d+$/.test(local.storyScene.eventId)) {
        merged = clearStoryScene(merged, local.storyScene.eventId);
    }
    if (!finale || replayed) return recoverPendingStoryEpilogue(merged);
    const village = merged.storyVillage || merged.village;
    const eventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-100-8`;
    const decision = [...(merged.storyChoices ?? [])].reverse().find((receipt) => receipt.eventId === eventId && receipt.battle);
    const lane = decision?.trait ?? fallbackLane;
    return lane ? recordPendingStoryEpilogue(clearStoryScene(merged, eventId), eventId, lane) : recoverPendingStoryEpilogue(merged);
}
