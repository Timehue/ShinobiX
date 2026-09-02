import type { StoryStep } from "../types/vn";
import {
    ECHOES_CONTENT_KEY,
    ECHOES_CONTENT_SCHEMA_VERSION,
    STORY_CONTENT_SCHEMA_VERSION,
    type EchoesContentPayload,
    type StoryContentPayload,
    type StoryContentVillage,
} from "./story-content-contract";

export type StoryContentFetch = (url: string, init: RequestInit) => Promise<Response>;

type ContentResource<P> =
    | { status: "pending"; promise: Promise<void> }
    | { status: "ready"; value: P }
    | { status: "error"; error: unknown };

export class StoryContentLoadError extends Error {
    readonly retryable: boolean;
    readonly staleDeployment: boolean;

    constructor(message: string, retryable = false, staleDeployment = false) {
        super(message);
        this.name = "StoryContentLoadError";
        this.retryable = retryable;
        this.staleDeployment = staleDeployment;
    }
}

function object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function optional(value: Record<string, unknown>, key: string, valid: (entry: unknown) => boolean): boolean {
    return value[key] === undefined || valid(value[key]);
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function oneOf(values: readonly string[]) {
    return (value: unknown): value is string => typeof value === "string" && values.includes(value);
}

const BIOMES = ["forest", "snow", "volcano", "shadow", "central"] as const;
const ENCOUNTER_TYPES = ["ai", "pet", "tiles"] as const;
const BATTLE_DIFFICULTIES = ["easy", "normal", "hard", "impossible"] as const;
const TILE_DIFFICULTIES = ["easy", "normal", "hard"] as const;
const INTERLUDE_LANES = ["good", "neutral", "bad"] as const;
const CINEMATIC_ENUMS: Record<string, readonly string[]> = {
    mode: ["auto", "cinematic", "classic"],
    shot: ["wide", "medium", "close", "detail"],
    focus: ["left", "right", "center", "speaker"],
    backgroundMotion: ["auto", "none", "push", "pan-left", "pan-right", "drift"],
    transition: ["auto", "cut", "crossfade", "dip-black", "whiteout", "whip"],
    tone: ["neutral", "warm", "cold", "danger", "hollow", "elegy"],
    atmosphere: ["auto", "none", "embers", "rain", "snow", "mist", "motes"],
    actorEntrance: ["auto", "none", "fade", "left", "right", "rise"],
    leftActorPose: ["neutral", "tense", "injured", "resolute", "grieving", "defiant", "solemn"],
    rightActorPose: ["neutral", "tense", "injured", "resolute", "grieving", "defiant", "solemn"],
    impact: ["none", "soft", "heavy"],
    ambience: ["auto", "none", "village", "road", "interior", "hollow"],
    cue: ["none", "title", "paper", "reveal", "omen", "decision", "battle"],
};
const CINEMATIC_STRING_FIELDS = ["backgroundPosition", "backgroundImage"] as const;

function validCinematic(value: unknown): boolean {
    const cinematic = object(value);
    if (!cinematic || !exactKeys(cinematic, [...Object.keys(CINEMATIC_ENUMS), ...CINEMATIC_STRING_FIELDS, "titleCard"])) return false;
    return Object.entries(CINEMATIC_ENUMS).every(([key, values]) => optional(cinematic, key, oneOf(values)))
        && CINEMATIC_STRING_FIELDS.every((key) => optional(cinematic, key, (entry) => typeof entry === "string"))
        && optional(cinematic, "titleCard", (entry) => typeof entry === "boolean");
}

function validBattle(value: unknown): boolean {
    const battle = object(value);
    const keys = ["encounterType", "difficulty", "bossName", "bossIcon", "bossHp", "bossDamage", "aiProfileId", "petId", "tileDifficulty", "backgroundImage", "xpReward", "ryoReward"];
    return Boolean(battle && Object.keys(battle).length > 0 && exactKeys(battle, keys)
        && optional(battle, "encounterType", oneOf(ENCOUNTER_TYPES))
        && optional(battle, "difficulty", oneOf(BATTLE_DIFFICULTIES))
        && ["bossName", "bossIcon", "aiProfileId", "petId", "backgroundImage"].every((key) => optional(battle, key, nonEmptyString))
        && ["bossHp", "bossDamage"].every((key) => optional(battle, key, (entry) => finite(entry) && entry > 0))
        && ["xpReward", "ryoReward"].every((key) => optional(battle, key, (entry) => finite(entry) && entry >= 0))
        && optional(battle, "tileDifficulty", oneOf(TILE_DIFFICULTIES)));
}

function validLine(value: unknown): boolean {
    const line = object(value);
    return Boolean(line && exactKeys(line, ["speaker", "text", "image", "cinematic"])
        && nonEmptyString(line.speaker) && typeof line.text === "string"
        && optional(line, "image", nonEmptyString) && optional(line, "cinematic", validCinematic));
}

function validChoice(value: unknown, pageCount: number, interlude: boolean): boolean {
    const choice = object(value);
    const allowed = interlude
        ? ["text", "nextPage", "conclusion", "trait", "lane", "requireTrait"]
        : ["text", "nextPage", "conclusion", "trait", "requireTrait", "forbidTrait", "battle"];
    return Boolean(choice && exactKeys(choice, allowed) && nonEmptyString(choice.text)
        && Number.isInteger(choice.nextPage) && Number(choice.nextPage) >= 0 && Number(choice.nextPage) < pageCount
        && ["conclusion", "trait", "requireTrait", "forbidTrait"].every((key) => optional(choice, key, nonEmptyString))
        && (!interlude || optional(choice, "lane", oneOf(INTERLUDE_LANES)))
        && (interlude || optional(choice, "battle", validBattle)));
}

function validPage(value: unknown, pageCount: number, interlude: boolean): boolean {
    const page = object(value);
    const allowed = interlude
        ? ["title", "scene", "speaker", "dialogue", "choices"]
        : ["title", "scene", "speaker", "dialogue", "lines", "image", "cinematic", "leftName", "leftImage", "rightName", "rightImage", "choices"];
    if (!page || !exactKeys(page, allowed) || !nonEmptyString(page.title) || !nonEmptyString(page.scene)
        || !nonEmptyString(page.speaker) || !Array.isArray(page.dialogue)
        || !page.dialogue.every((line) => typeof line === "string")) return false;
    const dialogueLength = page.dialogue.length;
    if (!optional(page, "lines", (entry) => Array.isArray(entry) && entry.length === dialogueLength && entry.every(validLine))
        || !["image", "leftName", "leftImage", "rightName", "rightImage"].every((key) => optional(page, key, nonEmptyString))
        || !optional(page, "cinematic", validCinematic)
        || !optional(page, "choices", (entry) => Array.isArray(entry) && entry.every((choice) => validChoice(choice, pageCount, interlude)))) return false;
    return true;
}

function validChapter(value: unknown): value is StoryStep {
    const chapter = object(value);
    const allowed = ["levelReq", "title", "cinematicTitle", "scene", "dialogue", "bossName", "bossIcon", "bossHp", "bossDamage", "rewardXp", "rewardRyo", "biome", "aiProfileId", "kageFinale", "liberatorTitle", "pages"];
    if (!chapter || !exactKeys(chapter, allowed) || !Number.isInteger(chapter.levelReq) || Number(chapter.levelReq) < 1 || !nonEmptyString(chapter.title)
        || !nonEmptyString(chapter.bossName) || !nonEmptyString(chapter.bossIcon)
        || !finite(chapter.bossHp) || chapter.bossHp <= 0 || !finite(chapter.bossDamage) || chapter.bossDamage <= 0
        || !finite(chapter.rewardXp) || chapter.rewardXp < 0 || !finite(chapter.rewardRyo) || chapter.rewardRyo < 0
        || !Array.isArray(chapter.pages) || chapter.pages.length === 0
        || !Array.isArray(chapter.dialogue) || !chapter.dialogue.every((line) => typeof line === "string")) return false;
    if (!nonEmptyString(chapter.cinematicTitle) || !nonEmptyString(chapter.scene)
        || !optional(chapter, "biome", oneOf(BIOMES)) || !optional(chapter, "aiProfileId", nonEmptyString)
        || !optional(chapter, "kageFinale", (entry) => typeof entry === "boolean")
        || !optional(chapter, "liberatorTitle", nonEmptyString)
        || !chapter.pages.every((page) => validPage(page, (chapter.pages as unknown[]).length, false))) return false;
    const pages = chapter.pages as Array<Record<string, unknown>>;
    const dialogue = chapter.dialogue as string[];
    if (chapter.cinematicTitle !== pages[0].title || chapter.scene !== pages[0].scene) return false;
    const flattened = pages.flatMap((page) => page.dialogue as string[]);
    if (flattened.length !== dialogue.length || flattened.some((line, index) => line !== dialogue[index])) return false;
    for (const page of pages) {
        for (const rawChoice of (page.choices as unknown[] | undefined) ?? []) {
            const battle = object(object(rawChoice)?.battle);
            if (!battle) continue;
            if (battle.bossName !== chapter.bossName || battle.bossIcon !== chapter.bossIcon
                || battle.bossHp !== chapter.bossHp || battle.bossDamage !== chapter.bossDamage
                || battle.aiProfileId !== chapter.aiProfileId || battle.xpReward !== chapter.rewardXp
                || battle.ryoReward !== chapter.rewardRyo) return false;
        }
    }
    return true;
}

function validInterlude(value: unknown, village: StoryContentVillage): boolean {
    const interlude = object(value);
    const allowed = ["id", "village", "levelReq", "minProgress", "title", "pages"];
    return Boolean(interlude && exactKeys(interlude, allowed)
        && nonEmptyString(interlude.id)
        && interlude.village === village
        && Number.isInteger(interlude.levelReq) && Number(interlude.levelReq) >= 1
        && Number.isInteger(interlude.minProgress) && Number(interlude.minProgress) >= 0
        && nonEmptyString(interlude.title)
        && Array.isArray(interlude.pages)
        && interlude.pages.length > 0
        && interlude.pages.every((page) => validPage(page, (interlude.pages as unknown[]).length, true)));
}

export function validateStoryContentPayload(value: unknown, village: StoryContentVillage): StoryContentPayload {
    const payload = object(value);
    if (!payload || !exactKeys(payload, ["schemaVersion", "village", "chapters", "interludes"])
        || payload.schemaVersion !== STORY_CONTENT_SCHEMA_VERSION || payload.village !== village
        || !Array.isArray(payload.chapters) || payload.chapters.length !== 9 || !payload.chapters.every(validChapter)
        || !Array.isArray(payload.interludes) || payload.interludes.length !== 8
        || !payload.interludes.every((entry) => validInterlude(entry, village))) {
        throw new StoryContentLoadError(`Story content for ${village} failed schema validation.`);
    }
    const levels = payload.chapters.map((chapter) => (chapter as StoryStep).levelReq);
    if (levels.some((level, index) => index > 0 && level <= levels[index - 1])) {
        throw new StoryContentLoadError(`Story chapters for ${village} are not in ascending order.`);
    }
    const interludeIds = (payload.interludes as Array<{ id: string }>).map(({ id }) => id);
    if (new Set(interludeIds).size !== interludeIds.length) throw new StoryContentLoadError(`Story interlude ids for ${village} are not unique.`);
    return payload as StoryContentPayload;
}

const ECHOES_SCENE_KINDS = ["preShowdown", "defeat", "firstVictory", "rematch"] as const;

function validEchoesScenePage(value: unknown): boolean {
    const page = object(value);
    return Boolean(page && exactKeys(page, ["title", "scene", "speaker", "dialogue"])
        && nonEmptyString(page.title) && nonEmptyString(page.scene) && nonEmptyString(page.speaker)
        && Array.isArray(page.dialogue) && page.dialogue.length > 0
        && page.dialogue.every((line) => nonEmptyString(line)));
}

/** Shape-only, fail-closed: id parity against ECHOES_OPPONENTS is enforced by
 * the generator at build time (the payload is content-addressed, so a bundle
 * only ever fetches the payload generated from its own source tree). */
export function validateEchoesContentPayload(value: unknown): EchoesContentPayload {
    const payload = object(value);
    if (!payload || !exactKeys(payload, ["schemaVersion", "scope", "scenes"])
        || payload.schemaVersion !== ECHOES_CONTENT_SCHEMA_VERSION || payload.scope !== ECHOES_CONTENT_KEY) {
        throw new StoryContentLoadError("The Echoes of War script failed schema validation.");
    }
    const scenes = object(payload.scenes);
    if (!scenes || Object.keys(scenes).length === 0) throw new StoryContentLoadError("The Echoes of War script has no scenes.");
    for (const [id, entry] of Object.entries(scenes)) {
        const record = object(entry);
        if (!record || !exactKeys(record, [...ECHOES_SCENE_KINDS])
            || !ECHOES_SCENE_KINDS.every((kind) => Array.isArray(record[kind])
                && (record[kind] as unknown[]).length > 0
                && (record[kind] as unknown[]).every(validEchoesScenePage))) {
            throw new StoryContentLoadError(`The Echoes of War scenes for ${id} failed schema validation.`);
        }
    }
    return payload as EchoesContentPayload;
}

/** Generic content-addressed JSON loader. The village chronicles and the
 * Echoes of War campaign share this transport (retry, timeout, immutable-cache
 * semantics, fail-closed validation); each caller supplies its own validator. */
export function createContentLoader<K extends string, P>({
    urlFor,
    fetchContent,
    validate,
    staleMessage = "This story content belongs to an older game release.",
    attempts = 3,
    timeoutMs = 12_000,
    retryDelayMs = 250,
}: {
    urlFor: (key: K) => string;
    fetchContent: StoryContentFetch;
    validate: (parsed: unknown, key: K) => P;
    staleMessage?: string;
    attempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
}) {
    const cache = new Map<K, Promise<P>>();
    const once = async (village: K, refreshGeneration = 0): Promise<P> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let response: Response;
            try {
                const sourceUrl = urlFor(village);
                const requestUrl = refreshGeneration > 0
                    ? `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}story-retry=${refreshGeneration}`
                    : sourceUrl;
                response = await fetchContent(requestUrl, {
                    method: "GET",
                    credentials: "same-origin",
                    cache: refreshGeneration > 0 ? "reload" : "force-cache",
                    headers: { Accept: "application/json" },
                    signal: controller.signal,
                });
            } catch (error) {
                throw new StoryContentLoadError(error instanceof Error ? error.message : "Story content request failed.", true);
            }
            if (!response.ok) {
                const staleDeployment = response.status === 404 || response.status === 410;
                throw new StoryContentLoadError(
                    staleDeployment ? staleMessage : `Story content request failed (${response.status}).`,
                    response.status >= 500 || response.status === 408 || response.status === 429,
                    staleDeployment,
                );
            }
            let parsed: unknown;
            try {
                parsed = await response.json();
            } catch {
                throw new StoryContentLoadError(`Story content for ${village} was not valid JSON.`);
            }
            return validate(parsed, village);
        } finally {
            clearTimeout(timeout);
        }
    };
    const refreshGenerations = new Map<K, number>();
    const start = (village: K, refreshGeneration = 0): Promise<P> => {
        const pending = (async () => {
            let lastError: unknown;
            for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
                try {
                    return await once(village, refreshGeneration);
                } catch (error) {
                    lastError = error;
                    if (!(error instanceof StoryContentLoadError) || !error.retryable || attempt + 1 >= attempts) throw error;
                    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
                }
            }
            throw lastError;
        })();
        cache.set(village, pending);
        void pending.catch(() => { if (cache.get(village) === pending) cache.delete(village); });
        return pending;
    };
    const load = (village: K): Promise<P> => {
        const cached = cache.get(village);
        if (cached) return cached;
        return start(village);
    };
    const refresh = (village: K): Promise<P> => {
        cache.delete(village);
        const generation = (refreshGenerations.get(village) ?? 0) + 1;
        refreshGenerations.set(village, generation);
        return start(village, generation);
    };
    return { load, refresh, clear: (village?: K) => village ? cache.delete(village) : cache.clear() };
}

/** The village-chronicle loader, unchanged API: transport + village validator. */
export function createStoryContentLoader(options: {
    urlFor: (village: StoryContentVillage) => string;
    fetchContent: StoryContentFetch;
    attempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
}) {
    return createContentLoader<StoryContentVillage, StoryContentPayload>({
        ...options,
        validate: validateStoryContentPayload,
        staleMessage: "This village chronicle belongs to an older game release.",
    });
}

/** Suspense adapter kept separate from transport caching so a same-screen retry
 * can forget a rejected render resource without creating an automatic loop. */
export function createContentResource<K extends string, P>({
    load,
    refresh,
}: {
    load: (key: K) => Promise<P>;
    refresh: (key: K) => Promise<P>;
}) {
    const resources = new Map<K, ContentResource<P>>();
    const prime = (village: K, request: Promise<P>): ContentResource<P> => {
        const pending: ContentResource<P> = { status: "pending", promise: Promise.resolve() };
        pending.promise = request.then(
            (value) => { resources.set(village, { status: "ready", value }); },
            (error) => { resources.set(village, { status: "error", error }); },
        );
        resources.set(village, pending);
        return pending;
    };
    const read = (village: K): P => {
        let resource = resources.get(village);
        if (!resource) resource = prime(village, load(village));
        if (resource.status === "pending") throw resource.promise;
        if (resource.status === "error") throw resource.error;
        return resource.value;
    };
    const reset = (village: K): void => { prime(village, refresh(village)); };
    return { read, reset, clear: (village?: K) => village ? resources.delete(village) : resources.clear() };
}

/** The village-chronicle resource, unchanged API. */
export function createStoryContentResource(options: {
    load: (village: StoryContentVillage) => Promise<StoryContentPayload>;
    refresh: (village: StoryContentVillage) => Promise<StoryContentPayload>;
}) {
    return createContentResource<StoryContentVillage, StoryContentPayload>(options);
}
