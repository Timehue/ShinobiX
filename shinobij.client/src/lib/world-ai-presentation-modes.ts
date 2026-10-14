import type { WorldAiFightKind } from "../../../shared/world-ai-fight";

/** Existing encounter presentation names map to the server's sealed fight kinds. */
export const WORLD_FIGHT_KIND_BY_MODE: Readonly<Record<string, WorldAiFightKind>> = {
    single: "wanderer",
    ambush: "wanderer-ambush",
    patrol: "patrol",
    bountyHunter: "bounty-hunter",
    huntPack: "hunt-pack",
    huntTarget: "hunt-target",
    questboss: "questbook-boss",
    storyReckoning: "story-reckoning",
};
