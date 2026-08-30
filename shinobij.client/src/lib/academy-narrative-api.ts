import type { Character } from "../types/character";

export type AcademyNarrativeAction = "incident" | "trace" | "seal" | "complete" | "skip";

export async function commitAcademyNarrativeAction(
    playerName: string,
    action: AcademyNarrativeAction,
    sector?: number,
): Promise<{ character: Character; _saveVersion: number }> {
    const response = await fetch("/api/player/academy-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, action, sector }),
    });
    const data = await response.json().catch(() => null) as {
        error?: string;
        character?: Character;
        _saveVersion?: number;
    } | null;
    if (!response.ok || !data?.character || !Number.isSafeInteger(data._saveVersion)) {
        throw new Error(data?.error || "The Academy milestone could not be saved.");
    }
    return { character: data.character, _saveVersion: Number(data._saveVersion) };
}
