import { STORY_FIELD_CONTENT_URL } from "../generated/story-content/manifest";
import type { StoryFieldContentPayload } from "./story-field-content-contract";
import { createStoryFieldContentLoader, createStoryFieldContentResource } from "./story-field-content-loader-core";

const loader = createStoryFieldContentLoader({
    url: STORY_FIELD_CONTENT_URL,
    fetchContent: (url, init) => fetch(url, init),
});
const resource = createStoryFieldContentResource(loader);

export const loadStoryFieldContent = loader.load;
export const readStoryFieldContent = resource.read;
export const resetStoryFieldContent = resource.reset;

/** Test-only hydration is tree-shaken from production callers. */
export function seedStoryFieldContentForTests(payload: StoryFieldContentPayload): void {
    resource.seed(payload);
}
