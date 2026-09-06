import type { StoryRoadEvent } from "../data/story-road-events";

export const STORY_ROAD_CONTENT_SCHEMA_VERSION = 1 as const;

export const STORY_ROAD_CONTENT_EVENT_IDS = [
    "story-road-border-smoke",
    "story-road-second-teacher",
    "story-road-three-footprints",
    "story-road-withheld-cache",
    "story-road-shrine-of-two-flags",
    "story-road-legacy-without-a-name",
    "story-road-unsworn-ledger",
    "story-road-black-bridge",
    "story-road-rival-who-keeps-losing",
    "story-road-alliance-drill",
    "story-road-fifth-anchor",
    "story-road-four-seals-one-gate",
    "story-road-emergency-powers",
    "story-road-last-road",
    "story-road-seat-of-scars",
] as const;

export type StoryRoadContentPayload = {
    schemaVersion: typeof STORY_ROAD_CONTENT_SCHEMA_VERSION;
    events: StoryRoadEvent[];
};
