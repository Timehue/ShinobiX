import type { StoryStep } from "../types/vn";
import type { StoryInterlude } from "../data/story-interludes";
import type { EchoesEraIntro, EchoesOpponentScenes, EchoesWitnessContent } from "../data/echoes-of-war";

export const STORY_CONTENT_SCHEMA_VERSION = 1 as const;
export const STORY_CONTENT_VILLAGES = [
    "Stormveil Village",
    "Ashen Leaf Village",
    "Frostfang Village",
    "Moonshadow Village",
] as const;

export type StoryContentVillage = typeof STORY_CONTENT_VILLAGES[number];
export type StoryContentPayload = {
    schemaVersion: typeof STORY_CONTENT_SCHEMA_VERSION;
    village: StoryContentVillage;
    chapters: StoryStep[];
    interludes: StoryInterlude[];
};

export function isStoryContentVillage(value: string): value is StoryContentVillage {
    return (STORY_CONTENT_VILLAGES as readonly string[]).includes(value);
}

export function storyContentSlug(village: StoryContentVillage): string {
    return village.toLowerCase().replace(/\s+village$/, "").replace(/[^a-z0-9]+/g, "-");
}

/** The Echoes of War campaign script rides the same content-addressed pipeline
 * as the village chronicles: authored in data/echoes-of-war-scenes.ts, emitted
 * by scripts/generate-story-content.mts, fetched by lib/echoes-content-loader.ts. */
export const ECHOES_CONTENT_SCHEMA_VERSION = 2 as const;
export const ECHOES_CONTENT_KEY = "echoes-of-war" as const;

export type EchoesContentKey = typeof ECHOES_CONTENT_KEY;
export type EchoesContentPayload = {
    schemaVersion: typeof ECHOES_CONTENT_SCHEMA_VERSION;
    scope: EchoesContentKey;
    /** Scene scripts keyed by opponent id, in floor order. */
    scenes: Record<string, EchoesOpponentScenes>;
    /** Bespoke intro VN pages keyed by era id (data/echoes-of-war.ts ECHOES_ERAS). */
    eras: Record<string, EchoesEraIntro>;
    /** Durable witness prompt/reaction copy, kept outside the initial bundle. */
    witness: EchoesWitnessContent;
};
