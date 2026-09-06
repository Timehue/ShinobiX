import { storyEpiloguesByVillage, type StoryEpilogueDef } from "../data/story-epilogues";
import { selectStoryEpilogueFrom } from "./story-epilogue";

/** Authoring/test selector over the source module. The shipped reader loads the
 * content-addressed JSON projection only when a settled finale needs it. */
export function selectStoryEpilogue(village: string, lane: string | null | undefined, traits: readonly string[]): StoryEpilogueDef | null {
    return selectStoryEpilogueFrom(storyEpiloguesByVillage[village] ?? [], lane, traits);
}
