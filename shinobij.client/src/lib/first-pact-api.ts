import type {
    FirstPactProgress,
    FirstPactMainBeat,
} from "../../../shared/first-pact-contract";

type FirstPactAction = "state" | "enter" | "accept-stable-quest" | "advance-main" | "enter-finding" | "checkpoint";

/** Closing the crossing credits titles and Aura Stones server-side. They ride
 *  back on that one response so the epilogue can name what was earned -- the
 *  client is told, never asked, and still decides nothing.
 *
 *  The character itself is not applied here: the grant bumps the stored save,
 *  so the next autosave takes the ordinary 409 -> refetch -> apply path and the
 *  balance arrives with it. */
export type FirstPactGrant = {
    grantedTitles?: string[];
    grantedAuraStones?: number;
};

type FirstPactPostResult =
    | ({ progress: FirstPactProgress } & FirstPactGrant)
    | { error: string; progress?: FirstPactProgress };

async function firstPactPost(
    playerName: string,
    action: FirstPactAction,
    extra: Record<string, unknown> = {},
): Promise<FirstPactPostResult> {
    try {
        const response = await fetch("/api/first-pact/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, action, ...extra }),
        });
        const data = await response.json().catch(() => null) as
            ({ progress?: FirstPactProgress; error?: string } & FirstPactGrant) | null;
        if (!response.ok || !data?.progress) {
            return {
                error: data?.error ?? "The Celestial record did not answer.",
                ...(data?.progress ? { progress: data.progress } : {}),
            };
        }
        const titles = Array.isArray(data.grantedTitles)
            ? data.grantedTitles.filter((t): t is string => typeof t === "string" && t.length > 0)
            : [];
        const stones = Number(data.grantedAuraStones);
        return {
            progress: data.progress,
            ...(titles.length ? { grantedTitles: titles } : {}),
            ...(Number.isFinite(stones) && stones > 0 ? { grantedAuraStones: stones } : {}),
        };
    } catch {
        return { error: "Network error. The Sunken Court could not be reached." };
    }
}

export const fetchFirstPactProgress = (playerName: string) => firstPactPost(playerName, "state");
export const enterFirstPact = (playerName: string) => firstPactPost(playerName, "enter");
export const acceptFirstPactStableQuest = (playerName: string) => firstPactPost(playerName, "accept-stable-quest");
export const advanceFirstPactMain = (playerName: string, beat: FirstPactMainBeat) => firstPactPost(playerName, "advance-main", { beat });
/** Spend Court Standing on one writ's finding. Only the id travels: the price
 *  and the reserve that keeps the Balancing reachable are the server's. */
export const enterFirstPactFinding = (playerName: string, writId: string) =>
    firstPactPost(playerName, "enter-finding", { writId });

export function checkpointFirstPact(
    playerName: string,
    position: { x: number; y: number },
) {
    return firstPactPost(playerName, "checkpoint", { position });
}
