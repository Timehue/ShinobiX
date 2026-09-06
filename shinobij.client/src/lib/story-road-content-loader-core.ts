import type { StoryRoadEvent, StoryRoadPage } from "../data/story-road-events";
import {
    STORY_ROAD_CONTENT_EVENT_IDS,
    STORY_ROAD_CONTENT_SCHEMA_VERSION,
    type StoryRoadContentPayload,
} from "./story-road-content-contract";
import { StoryFieldContentLoadError } from "./story-field-content-loader-core";

type RoadResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type RoadResource =
    | { status: "pending"; promise: Promise<void> }
    | { status: "ready"; value: StoryRoadContentPayload }
    | { status: "error"; error: unknown };

const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 4_000;
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]) => Object.keys(row).every((key) => keys.includes(key));
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

function validBattle(value: unknown): boolean {
    const row = object(value);
    return Boolean(row && exactKeys(row, ["bossName", "bossIcon"]) && string(row.bossName) && string(row.bossIcon));
}

function validPage(value: unknown, pageIndex: number, finalPageIndex: number, levelReq: number): value is StoryRoadPage {
    const row = object(value);
    if (!row || !exactKeys(row, ["title", "scene", "speaker", "dialogue", "choices"])
        || !string(row.title) || !string(row.scene) || !string(row.speaker)
        || !Array.isArray(row.dialogue) || row.dialogue.length === 0 || !row.dialogue.every(string)) return false;
    if (pageIndex !== finalPageIndex) return row.choices === undefined;
    if (!Array.isArray(row.choices) || row.choices.length !== 3) return false;
    const traits = new Set<string>();
    return row.choices.every((value: unknown, choiceIndex: number) => {
        const choice = object(value);
        if (!choice || !exactKeys(choice, ["text", "conclusion", "trait", "lane", "nextPage", "battle"])
            || !string(choice.text) || !string(choice.conclusion) || !string(choice.trait)
            || choice.lane !== ["good", "neutral", "bad"][choiceIndex]
            || choice.nextPage !== finalPageIndex
            || (choice.battle !== undefined && !validBattle(choice.battle))
            || !new RegExp(`^rd${levelReq}-[a-z0-9-]+$`).test(choice.trait)
            || traits.has(choice.trait)) return false;
        traits.add(choice.trait);
        return true;
    });
}

function validEvent(value: unknown, index: number): value is StoryRoadEvent {
    const row = object(value);
    if (!row || !exactKeys(row, ["id", "slug", "levelReq", "minProgress", "title", "npcName", "npcArchetype", "pages"])
        || row.id !== STORY_ROAD_CONTENT_EVENT_IDS[index] || !string(row.slug) || row.id !== `story-road-${row.slug}`
        || !integer(row.levelReq, 1) || !integer(row.minProgress)
        || row.minProgress !== (row.levelReq >= 100 ? 9 : 0)
        || !string(row.title) || !string(row.npcName)
        || !["courier", "tracker", "trainer", "pilgrim", "emissary", "broker", "official", "soldier", "rival"].includes(String(row.npcArchetype))
        || !Array.isArray(row.pages) || row.pages.length < 2) return false;
    const last = row.pages.length - 1;
    return row.pages.every((page, pageIndex) => validPage(page, pageIndex, last, Number(row.levelReq)));
}

export function validateStoryRoadContent(value: unknown): StoryRoadContentPayload {
    const payload = object(value);
    if (!payload || !exactKeys(payload, ["schemaVersion", "events"])
        || payload.schemaVersion !== STORY_ROAD_CONTENT_SCHEMA_VERSION
        || !Array.isArray(payload.events) || payload.events.length !== STORY_ROAD_CONTENT_EVENT_IDS.length
        || !payload.events.every(validEvent)) {
        throw new StoryFieldContentLoadError("Road story content failed schema validation.");
    }
    const events = payload.events as StoryRoadEvent[];
    if (events.some((event, index) => index > 0 && event.levelReq <= events[index - 1].levelReq)) {
        throw new StoryFieldContentLoadError("Road story events are not in ascending level order.");
    }
    const traits = events.flatMap((event) => event.pages.at(-1)?.choices?.map((choice) => choice.trait) ?? []);
    if (new Set(traits).size !== traits.length) throw new StoryFieldContentLoadError("Road story choice traits are not unique.");
    return payload as StoryRoadContentPayload;
}

export function createStoryRoadContentLoader({
    url, fetchContent, attempts = 3, retryDelayMs = 250,
}: {
    url: string;
    fetchContent: (url: string, init: RequestInit) => Promise<RoadResponse>;
    attempts?: number;
    retryDelayMs?: number;
}) {
    let cached: Promise<StoryRoadContentPayload> | null = null;
    let generation = 0;
    const start = (refresh = false) => {
        const requestGeneration = generation;
        const pending = (async () => {
            let lastError: StoryFieldContentLoadError | undefined;
            for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
                try {
                    const suffix = url.includes("?") ? "&" : "?";
                    const response = await fetchContent(refresh ? `${url}${suffix}road-retry=${requestGeneration}` : url, {
                        method: "GET", credentials: "same-origin", cache: refresh ? "reload" : "force-cache",
                        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000),
                    });
                    if (!response.ok) {
                        const stale = response.status === 404 || response.status === 410;
                        throw new StoryFieldContentLoadError(stale ? "This road story belongs to an older game release." : `Road story request failed (${response.status}).`, response.status >= 500 || response.status === 408 || response.status === 429, stale);
                    }
                    return validateStoryRoadContent(await response.json());
                } catch (error) {
                    lastError = error instanceof StoryFieldContentLoadError
                        ? error
                        : new StoryFieldContentLoadError(error instanceof Error ? error.message : "Road story request failed.", true);
                    if (!lastError.retryable || attempt + 1 >= attempts) throw lastError;
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
        clear: () => { cached = null; generation += 1; },
    };
}

export function createStoryRoadContentResource(loader: { load: () => Promise<StoryRoadContentPayload>; refresh: () => Promise<StoryRoadContentPayload> }) {
    let resource: RoadResource | null = null;
    const prime = (request: Promise<StoryRoadContentPayload>) => {
        const pending: RoadResource = { status: "pending", promise: Promise.resolve() };
        pending.promise = request.then(
            (value) => { if (resource === pending) resource = { status: "ready", value }; },
            (error) => { if (resource === pending) resource = { status: "error", error }; },
        );
        resource = pending;
    };
    return {
        read(): StoryRoadContentPayload {
            if (!resource) prime(loader.load());
            if (resource!.status === "pending") throw resource!.promise;
            if (resource!.status === "error") throw resource!.error;
            return resource!.value;
        },
        reset(): void { prime(loader.refresh()); },
        seed(value: StoryRoadContentPayload): void { resource = { status: "ready", value: validateStoryRoadContent(value) }; },
    };
}
