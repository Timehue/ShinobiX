import type { StoryFieldSceneJourney } from "../data/story-field-scenes";
import type { StoryReckoning, StoryReckoningPage } from "../data/story-reckonings";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import {
    STORY_FIELD_CONTENT_QUEST_IDS,
    STORY_FIELD_CONTENT_SCHEMA_VERSION,
    STORY_RECKONING_CONTENT_IDS,
    type StoryFieldContentPayload,
} from "./story-field-content-contract";

type FieldResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FieldResource =
    | { status: "pending"; promise: Promise<void> }
    | { status: "ready"; value: StoryFieldContentPayload }
    | { status: "error"; error: unknown };

export class StoryFieldContentLoadError extends Error {
    readonly retryable: boolean;
    readonly staleDeployment: boolean;

    constructor(message: string, retryable = false, staleDeployment = false) {
        super(message);
        this.name = "StoryFieldContentLoadError";
        this.retryable = retryable;
        this.staleDeployment = staleDeployment;
    }
}

const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 2_000;
const optionalString = (row: Record<string, unknown>, key: string) => row[key] === undefined || string(row[key]);
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]) => Object.keys(row).every((key) => keys.includes(key));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validChoice(value: unknown): boolean {
    const row = object(value);
    return Boolean(row && exactKeys(row, ["id", "text", "conclusion", "trait", "requireTrait", "forbidTrait", "accept"])
        && string(row.text) && ["id", "conclusion", "trait", "requireTrait", "forbidTrait"].every((key) => optionalString(row, key))
        && (row.accept === undefined || typeof row.accept === "boolean"));
}

function validPage(value: unknown): value is StoryReckoningPage {
    const row = object(value);
    return Boolean(row && exactKeys(row, ["title", "scene", "speaker", "dialogue", "choices", "requireTrait", "forbidTrait"])
        && string(row.title) && string(row.scene) && string(row.speaker)
        && Array.isArray(row.dialogue) && row.dialogue.length > 0 && row.dialogue.every(string)
        && optionalString(row, "requireTrait") && optionalString(row, "forbidTrait")
        && (row.choices === undefined || (Array.isArray(row.choices) && row.choices.length > 0 && row.choices.every(validChoice))));
}

function validJourney(questId: string, value: unknown): value is StoryFieldSceneJourney {
    const row = object(value);
    const points = object(row?.points);
    const graph = STORY_FIELD_JOURNEYS[questId];
    if (!row || !points || !exactKeys(row, ["points", "aftermath", "legacyAftermath"])
        || !graph || Object.keys(points).length !== Object.keys(graph.points).length
        || Object.keys(points).some((id, index) => id !== Object.keys(graph.points)[index])
        || !Array.isArray(row.aftermath) || row.aftermath.length === 0 || !row.aftermath.every(validPage)
        || (row.legacyAftermath !== undefined && (!Array.isArray(row.legacyAftermath) || row.legacyAftermath.length === 0 || !row.legacyAftermath.every(validPage)))) return false;
    const pointsValid = Object.entries(points).every(([id, pointValue]) => {
        const point = object(pointValue);
        const pages = point && Array.isArray(point.pages) ? point.pages : [];
        const finalChoices = pages.at(-1) && object(pages.at(-1))?.choices;
        const expectedChoices = Object.keys(graph.points[id].choices);
        return string(id) && Boolean(point && exactKeys(point, ["name", "greeting", "objective", "pages"])
            && string(point.name) && string(point.greeting) && string(point.objective)
            && pages.length > 0 && pages.every(validPage)
            && pages.slice(0, -1).every((page) => object(page)?.choices === undefined)
            && Array.isArray(finalChoices) && finalChoices.length === expectedChoices.length
            && finalChoices.every((choice, index) => object(choice)?.id === expectedChoices[index]));
    });
    const expectedTraits = Object.values(graph.points).flatMap((point) => Object.values(point.choices).flatMap((choice) => choice.trait ? [choice.trait] : []));
    const aftermathTraits = row.aftermath.flatMap((page) => object(page)?.requireTrait ? [object(page)!.requireTrait] : []);
    return pointsValid && expectedTraits.length === aftermathTraits.length
        && expectedTraits.every((trait, index) => trait === aftermathTraits[index]);
}

function validTask(value: unknown): boolean {
    const row = object(value);
    if (!row || !exactKeys(row, ["kind", "metric", "target", "dropItemId", "targetName", "boss"])) return false;
    if (!(row.kind === "hunt" || row.kind === "collect") || !(row.metric === "totalAiKills" || row.metric === "totalTilesExplored")
        || !Number.isSafeInteger(row.target) || Number(row.target) < 1 || !string(row.dropItemId) || !string(row.targetName)) return false;
    if (row.boss === undefined) return true;
    const boss = object(row.boss);
    return Boolean(boss && exactKeys(boss, ["bossId", "name", "icon", "portrait", "loadoutId", "statBonus", "levelOffset"])
        && ["bossId", "name", "icon", "portrait", "loadoutId"].every((key) => string(boss[key]))
        && finite(boss.statBonus) && finite(boss.levelOffset));
}

function validReward(value: unknown): boolean {
    const row = object(value);
    return Boolean(row && exactKeys(row, ["weight", "fateShards", "title"])
        && finite(row.weight) && row.weight > 0
        && (row.fateShards === undefined || (Number.isSafeInteger(row.fateShards) && Number(row.fateShards) >= 0))
        && string(row.title));
}

function validReckoning(value: unknown): value is StoryReckoning {
    const row = object(value);
    return Boolean(row && exactKeys(row, ["id", "slug", "village", "npcName", "levelReq", "ownProgress", "crossVillage", "completionTrait", "title", "task", "reward", "intro", "payoff"])
        && ["id", "slug", "village", "npcName", "completionTrait", "title"].every((key) => string(row[key]))
        && Number.isSafeInteger(row.levelReq) && Number(row.levelReq) >= 1
        && Number.isSafeInteger(row.ownProgress) && Number(row.ownProgress) >= 0
        && (row.crossVillage === undefined || typeof row.crossVillage === "boolean")
        && validTask(row.task) && validReward(row.reward)
        && Array.isArray(row.intro) && row.intro.length > 0 && row.intro.every(validPage)
        && Array.isArray(row.payoff) && row.payoff.length > 0 && row.payoff.every(validPage));
}

export function validateStoryFieldContent(value: unknown): StoryFieldContentPayload {
    const payload = object(value);
    const scenes = object(payload?.scenes);
    if (!payload || !scenes || !exactKeys(payload, ["schemaVersion", "scenes", "reckonings"])
        || payload.schemaVersion !== STORY_FIELD_CONTENT_SCHEMA_VERSION
        || !Array.isArray(payload.reckonings) || payload.reckonings.length === 0 || payload.reckonings.length > 32
        || !payload.reckonings.every(validReckoning)) {
        throw new StoryFieldContentLoadError("Personal journey content failed schema validation.");
    }
    const expected = new Set<string>(STORY_FIELD_CONTENT_QUEST_IDS);
    if (Object.keys(scenes).length !== expected.size || Object.keys(scenes).some((id) => !expected.has(id) || !validJourney(id, scenes[id]))) {
        throw new StoryFieldContentLoadError("Personal journey scenes failed schema validation.");
    }
    const reckoningIds = (payload.reckonings as Array<{ id: string }>).map(({ id }) => id);
    if (reckoningIds.length !== STORY_RECKONING_CONTENT_IDS.length
        || reckoningIds.some((id, index) => id !== STORY_RECKONING_CONTENT_IDS[index])) {
        throw new StoryFieldContentLoadError("Personal journey catalog is incomplete or duplicated.");
    }
    return payload as StoryFieldContentPayload;
}

export function createStoryFieldContentLoader({
    url, fetchContent, attempts = 3, retryDelayMs = 250,
}: {
    url: string;
    fetchContent: (url: string, init: RequestInit) => Promise<FieldResponse>;
    attempts?: number;
    retryDelayMs?: number;
}) {
    let cached: Promise<StoryFieldContentPayload> | null = null;
    let generation = 0;
    const start = (refresh = false) => {
        const pending = (async () => {
            let lastError: unknown;
            for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
                try {
                    const requestUrl = refresh ? `${url}${url.includes("?") ? "&" : "?"}field-retry=${generation}` : url;
                    const response = await fetchContent(requestUrl, {
                        method: "GET", credentials: "same-origin", cache: refresh ? "reload" : "force-cache",
                        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000),
                    });
                    if (!response.ok) {
                        const stale = response.status === 404 || response.status === 410;
                        throw new StoryFieldContentLoadError(stale ? "This personal journey belongs to an older game release." : `Personal journey request failed (${response.status}).`, response.status >= 500 || response.status === 408 || response.status === 429, stale);
                    }
                    return validateStoryFieldContent(await response.json());
                } catch (error) {
                    lastError = error instanceof StoryFieldContentLoadError
                        ? error
                        : new StoryFieldContentLoadError(error instanceof Error ? error.message : "Personal journey request failed.", true);
                    if (!(lastError instanceof StoryFieldContentLoadError) || !lastError.retryable || attempt + 1 >= attempts) throw lastError;
                    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
                }
            }
            throw lastError;
        })();
        cached = pending;
        void pending.catch(() => { if (cached === pending) cached = null; });
        return pending;
    };
    return {
        load: () => cached ?? start(),
        refresh: () => { cached = null; generation += 1; return start(true); },
        clear: () => { cached = null; },
    };
}

export function createStoryFieldContentResource(loader: { load: () => Promise<StoryFieldContentPayload>; refresh: () => Promise<StoryFieldContentPayload> }) {
    let resource: FieldResource | null = null;
    const prime = (request: Promise<StoryFieldContentPayload>) => {
        const pending: FieldResource = { status: "pending", promise: Promise.resolve() };
        pending.promise = request.then(
            (value) => { if (resource === pending) resource = { status: "ready", value }; },
            (error) => { if (resource === pending) resource = { status: "error", error }; },
        );
        resource = pending;
    };
    return {
        read(): StoryFieldContentPayload {
            if (!resource) prime(loader.load());
            if (resource!.status === "pending") throw resource!.promise;
            if (resource!.status === "error") throw resource!.error;
            return resource!.value;
        },
        reset(): void { prime(loader.refresh()); },
        seed(value: StoryFieldContentPayload): void { resource = { status: "ready", value: validateStoryFieldContent(value) }; },
    };
}
