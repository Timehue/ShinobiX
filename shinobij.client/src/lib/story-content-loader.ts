import { STORY_CONTENT_URLS } from "../generated/story-content/manifest";
import type { StoryContentPayload, StoryContentVillage } from "./story-content-contract";
import { createStoryContentLoader, createStoryContentResource } from "./story-content-loader-core";

const loader = createStoryContentLoader({
    urlFor: (village) => STORY_CONTENT_URLS[village],
    fetchContent: (url, init) => fetch(url, init),
});

const resource = createStoryContentResource({ load: loader.load, refresh: loader.refresh });

export function loadStoryContent(village: StoryContentVillage): Promise<StoryContentPayload> {
    return loader.load(village);
}

export function refreshStoryContent(village: StoryContentVillage): Promise<StoryContentPayload> {
    resource.clear(village);
    return loader.refresh(village);
}

export function preloadStoryContent(village: StoryContentVillage): void {
    void loadStoryContent(village).catch(() => undefined);
}

export function readStoryContent(village: StoryContentVillage): StoryContentPayload {
    return resource.read(village);
}

/** Explicit user retry: clear both layers, while leaving other villages warm. */
export function resetStoryContent(village: StoryContentVillage): void {
    resource.reset(village);
}
