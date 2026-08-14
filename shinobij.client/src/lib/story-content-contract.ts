import type { StoryStep } from "../types/vn";
import type { StoryInterlude } from "../data/story-interludes";

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
