import type {
    FirstPactProgress,
    FirstPactMainBeat,
} from "../../../shared/first-pact-contract";

type FirstPactAction = "state" | "enter" | "accept-stable-quest" | "advance-main" | "checkpoint";

async function firstPactPost(
    playerName: string,
    action: FirstPactAction,
    extra: Record<string, unknown> = {},
): Promise<{ progress: FirstPactProgress } | { error: string; progress?: FirstPactProgress }> {
    try {
        const response = await fetch("/api/first-pact/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, action, ...extra }),
        });
        const data = await response.json().catch(() => null) as { progress?: FirstPactProgress; error?: string } | null;
        if (!response.ok || !data?.progress) {
            return {
                error: data?.error ?? "The Celestial record did not answer.",
                ...(data?.progress ? { progress: data.progress } : {}),
            };
        }
        return { progress: data.progress };
    } catch {
        return { error: "Network error. The Sunken Court could not be reached." };
    }
}

export const fetchFirstPactProgress = (playerName: string) => firstPactPost(playerName, "state");
export const enterFirstPact = (playerName: string) => firstPactPost(playerName, "enter");
export const acceptFirstPactStableQuest = (playerName: string) => firstPactPost(playerName, "accept-stable-quest");
export const advanceFirstPactMain = (playerName: string, beat: FirstPactMainBeat) => firstPactPost(playerName, "advance-main", { beat });

export function checkpointFirstPact(
    playerName: string,
    position: { x: number; y: number },
) {
    return firstPactPost(playerName, "checkpoint", { position });
}
