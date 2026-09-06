import { STORY_ROAD_CONTENT_URL } from "../generated/story-content/manifest";
import type { StoryRoadEvent } from "../data/story-road-events";
import { createStoryRoadContentLoader, createStoryRoadContentResource } from "./story-road-content-loader-core";

const loader = createStoryRoadContentLoader({
    url: STORY_ROAD_CONTENT_URL,
    fetchContent: (url, init) => fetch(url, init),
});
const resource = createStoryRoadContentResource(loader);

export function readStoryRoadContent(): StoryRoadEvent[] {
    return resource.read().events;
}

export function resetStoryRoadContent(): void {
    resource.reset();
}

export function preloadStoryRoadContent(): void {
    // Prime the same resource the route reads, so a failed preload remains
    // failed until the player's explicit retry instead of starting over.
    try { resource.read(); } catch { /* The route's read owns loading/error UI. */ }
}
