import { STORY_EPILOGUE_URLS } from "../generated/story-content/manifest";
import { createStoryEpilogueLoader } from "./story-epilogue-loader-core";

const loader = createStoryEpilogueLoader({
    urlFor: (village) => STORY_EPILOGUE_URLS[village],
    fetchContent: (url, init) => fetch(url, init),
});

export const loadStoryEpilogues = loader.load;
