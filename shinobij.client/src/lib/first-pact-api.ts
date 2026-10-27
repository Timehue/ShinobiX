import type {
    FirstPactProgress,
    FirstPactMainBeat,
    FirstPactAftermathId,
} from "../../../shared/first-pact-contract";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";

type FirstPactAction = "state" | "enter" | "accept-stable-quest" | "advance-main" | "enter-finding" | "visit-aftermath" | "checkpoint"
    | "exhibition-start" | "exhibition-draft" | "exhibition-order" | "exhibition-swap" | "exhibition-abandon"
    | "replay-unbroken-start" | "replay-unbroken-abandon";

/** Orin's Stable Exhibition as the server sees it. Every pet here is a
 *  server-built rental; the screen only ever sends their ids back. */
export type FirstPactExhibitionView = {
    runId: string;
    status: "drafting" | "active" | "won" | "lost";
    round: number;
    length: number;
    pool: Pet[];
    team: Pet[];
    offered: Pet[] | null;
    nextRoundId: string | null;
};

/** Closing the crossing credits titles and Aura Stones server-side. They ride
 *  back on that one response so the epilogue can name what was earned -- the
 *  client is told, never asked, and still decides nothing.
 *
 *  Character and save version travel together so the owning screen can apply
 *  the authoritative reward atomically through App's normal version fence. */
export type FirstPactGrant = {
    grantedTitles?: string[];
    grantedAuraStones?: number;
    character?: Character;
    _saveVersion?: number;
};

type FirstPactPostResult =
    | ({ progress: FirstPactProgress; exhibition?: FirstPactExhibitionView | null } & FirstPactGrant)
    | { error: string; progress?: FirstPactProgress; exhibition?: FirstPactExhibitionView | null };

function exhibitionOf(value: unknown): FirstPactExhibitionView | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const view = value as FirstPactExhibitionView;
    return typeof view.runId === "string" && Array.isArray(view.team) && Array.isArray(view.pool) ? view : null;
}

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
        const data = await response.json().catch(() => null) as {
            progress?: FirstPactProgress;
            error?: string;
            grantedTitles?: unknown;
            grantedAuraStones?: unknown;
            character?: unknown;
            _saveVersion?: unknown;
            exhibition?: unknown;
        } | null;
        if (!response.ok || !data?.progress) {
            return {
                error: data?.error ?? "The Celestial record did not answer.",
                ...(data?.progress ? { progress: data.progress } : {}),
                // A refused Exhibition action carries the run as it stands.
                ...(data && "exhibition" in data ? { exhibition: exhibitionOf(data.exhibition) } : {}),
            };
        }
        const titles = Array.isArray(data.grantedTitles)
            ? data.grantedTitles.filter((t): t is string => typeof t === "string" && t.length > 0)
            : [];
        const stones = Number(data.grantedAuraStones);
        const saveVersion = Number(data._saveVersion);
        const mutationCharacter = data.character && typeof data.character === "object"
            && Number.isSafeInteger(saveVersion) && saveVersion > 0
            ? data.character as Character
            : undefined;
        return {
            progress: data.progress,
            // Absent before the crossing closes; null when no run was ever opened.
            ...(data.progress.mainStep === "complete" ? { exhibition: exhibitionOf(data.exhibition) } : {}),
            ...(titles.length ? { grantedTitles: titles } : {}),
            ...(Number.isFinite(stones) && stones > 0 ? { grantedAuraStones: stones } : {}),
            ...(mutationCharacter ? { character: mutationCharacter, _saveVersion: saveVersion } : {}),
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
export const visitFirstPactAftermath = (playerName: string, aftermathId: FirstPactAftermathId) =>
    firstPactPost(playerName, "visit-aftermath", { aftermathId });

/** Orin's Stable Exhibition. Rentals and trades are named by id only. */
export const startFirstPactExhibition = (playerName: string) => firstPactPost(playerName, "exhibition-start");
export const draftFirstPactExhibition = (playerName: string, petIds: string[]) => firstPactPost(playerName, "exhibition-draft", { petIds });
export const orderFirstPactExhibition = (playerName: string, petIds: string[]) => firstPactPost(playerName, "exhibition-order", { petIds });
export const tradeFirstPactExhibition = (playerName: string, outPetId: string, inPetId: string) =>
    firstPactPost(playerName, "exhibition-swap", { outPetId, inPetId });
export const abandonFirstPactExhibition = (playerName: string) => firstPactPost(playerName, "exhibition-abandon");
/** Court Replays: begin or abandon an Unbroken attempt at the Balancing. */
export const startFirstPactUnbroken = (playerName: string, hard: boolean) => firstPactPost(playerName, "replay-unbroken-start", { hard });
export const abandonFirstPactUnbroken = (playerName: string) => firstPactPost(playerName, "replay-unbroken-abandon");

export function checkpointFirstPact(
    playerName: string,
    position: { x: number; y: number },
) {
    return firstPactPost(playerName, "checkpoint", { position });
}
