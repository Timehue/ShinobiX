import type { StoryEpilogueDef } from "../data/story-epilogues";
import type { StoryContentVillage } from "./story-content-contract";

type EpilogueResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function validEpilogues(value: unknown): value is StoryEpilogueDef[] {
    return Array.isArray(value) && value.every((entry: unknown) => {
        const def = entry as Partial<StoryEpilogueDef> | null;
        return !!def && typeof def === "object" && typeof def.lane === "string" && typeof def.title === "string"
            && (def.requireTrait === undefined || typeof def.requireTrait === "string")
            && (def.requireAnyTrait === undefined || (Array.isArray(def.requireAnyTrait) && def.requireAnyTrait.length > 0
                && def.requireAnyTrait.every((trait: unknown) => typeof trait === "string" && trait.length > 0)))
            && Array.isArray(def.pages) && def.pages.length > 0 && def.pages.every((page: unknown) => {
                const row = page as Partial<StoryEpilogueDef["pages"][number]> | null;
                return !!row && typeof row.title === "string" && typeof row.scene === "string" && typeof row.speaker === "string"
                    && Array.isArray(row.dialogue) && row.dialogue.every((line: unknown) => typeof line === "string");
            });
    });
}

export function createStoryEpilogueLoader({
    urlFor, fetchContent, attempts = 3, retryDelayMs = 250,
}: {
    urlFor: (village: StoryContentVillage) => string;
    fetchContent: (url: string, init: RequestInit) => Promise<EpilogueResponse>;
    attempts?: number;
    retryDelayMs?: number;
}) {
    const cache = new Map<StoryContentVillage, Promise<StoryEpilogueDef[]>>();
    const load = (village: StoryContentVillage): Promise<StoryEpilogueDef[]> => {
        const cached = cache.get(village);
        if (cached) return cached;
        const pending = (async () => {
            let error: unknown;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                try {
                    const response = await fetchContent(urlFor(village), { signal: AbortSignal.timeout(12_000) });
                    if (!response.ok) throw new Error(`Epilogue content request failed (${response.status}).`);
                    const value = await response.json();
                    if (!validEpilogues(value)) throw new Error("Epilogue content failed validation.");
                    return value;
                } catch (caught) {
                    error = caught;
                    if (attempt + 1 < attempts && retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                }
            }
            throw error;
        })();
        cache.set(village, pending);
        pending.catch(() => cache.delete(village));
        return pending;
    };
    return { load };
}
