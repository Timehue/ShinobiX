import type { StoryFieldSceneJourney } from "../data/story-field-scenes";
import type { StoryReckoning } from "../data/story-reckonings";

export const STORY_FIELD_CONTENT_SCHEMA_VERSION = 1 as const;
export const STORY_FIELD_CONTENT_QUEST_IDS = [
    "story-reckoning-mira-marker",
    "story-reckoning-toma-cinders",
    "story-reckoning-sova-true-roll",
    "story-reckoning-nyx-ledger",
] as const;
export const STORY_RECKONING_CONTENT_IDS = [
    "story-reckoning-vanta-ninth",
    "story-reckoning-mira-marker",
    "story-reckoning-toma-cinders",
    "story-reckoning-mori-working-copy",
    "story-reckoning-sova-true-roll",
    "story-reckoning-yura-exemption",
    "story-reckoning-nyx-ledger",
    "story-reckoning-iro-sealed-shelf",
    "story-reckoning-harrow-unbought",
] as const;

export type StoryFieldContentPayload = {
    schemaVersion: typeof STORY_FIELD_CONTENT_SCHEMA_VERSION;
    scenes: Record<string, StoryFieldSceneJourney>;
    reckonings: StoryReckoning[];
};
