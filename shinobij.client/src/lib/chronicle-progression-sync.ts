import type { Character } from "../types/character";

export type ChronicleProgressionSyncResult = {
  granted: string[];
  character: Character;
  _saveVersion?: number;
};

export async function syncChronicleProgression(
  playerName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChronicleProgressionSyncResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/card-clash/sync-progression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName }),
    });
  } catch {
    throw new Error("The Living Chronicle could not be reached.");
  }
  const data = await response.json().catch(() => ({})) as Partial<ChronicleProgressionSyncResult> & { error?: string };
  if (!response.ok || !data.character) {
    throw new Error(data.error || "The Living Chronicle could not be refreshed.");
  }
  return {
    granted: Array.isArray(data.granted) ? data.granted.filter((id): id is string => typeof id === "string") : [],
    character: data.character,
    _saveVersion: data._saveVersion,
  };
}
