import type { StoryReckoning } from "../data/story-reckonings";

export function storyReckoningActionFailure(
    reason: string | undefined,
    arc: StoryReckoning,
    action: "accept" | "turn-in",
): string {
    const place = arc.crossVillage ? "an outskirts post" : `${arc.village} outskirts`;
    if (reason === "presence" || reason === "offline") return `Reconnect to the world, then speak with ${arc.npcName} at ${place}.`;
    if (reason === "wrong-place") return `Return to ${place} and speak with ${arc.npcName}.`;
    if (reason === "traveling") return `Finish traveling, then speak with ${arc.npcName} at ${place}.`;
    if (reason === "in-battle") return `Finish the battle, then speak with ${arc.npcName} at ${place}.`;
    if (action === "accept" && reason === "busy") return "Finish the story burden you already carry first.";
    if (action === "accept" && reason === "ineligible") return "This reckoning is not available now.";
    if (reason === "incomplete") return `Finish the field route or battle, then return to ${arc.npcName}.`;
    if (reason === "no-item") return `Recover ${arc.task.targetName}, then return to ${arc.npcName}.`;
    if (reason === "daily-cap") return "You have settled enough reckonings today. Return tomorrow.";
    if (reason === "none") return `This reckoning is no longer active. Speak with ${arc.npcName} at ${place} if it remains unsettled.`;
    return action === "accept" ? "The reckoning could not be sealed. Reconnect and try again."
        : "The reckoning could not be turned in. Reconnect and try again.";
}
