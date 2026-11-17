import type { PackedMotion, SpriteView } from "./sector-pose-delivery";
import { readSectorModelObject } from "./sector-model-object";

export type SectorModel = { mapWidth: number; banks: SpriteView[]; packed?: PackedMotion };

// Least-recently-used: every distinct equipped peer adds a manifest, so a long session in busy sectors
// must not keep all of them. 96 covers the 53-model roster plus a crowded sector of player models.
// An evicted entry that a mounted figure still uses stays alive through that figure; a later mount
// re-reads the immutable manifest from the HTTP cache.
const MODEL_CACHE_LIMIT = 96;
const models = new Map<string, Promise<SectorModel>>();

/** The folder a figure's files live in: a player's own model, or a roster model by kind. */
export function sectorModelFolder(artBase: string, kind: string, equippedAssetId?: string): string {
    return artBase.replace(/\/$/, "") + "/" + (equippedAssetId ? "players/" + equippedAssetId : kind) + "/";
}

/** One figure manifest, shared by every figure (and every warm-up) that asks for it. */
export function loadSectorModel(folder: string, revision: string, priority: RequestPriority = "auto"): Promise<SectorModel> {
    const url = folder + revision + ".json";
    const existing = models.get(url);
    if (existing) { models.delete(url); models.set(url, existing); return existing; }
    const request = readSectorModelObject(folder,revision+".json",".json",8*1024**2,priority).then(bytes => {
        const decoded = JSON.parse(new TextDecoder().decode(bytes));
        if (decoded.mapWidth !== 1080) throw new Error("Invalid sector model scale");
        if (decoded.format === "sector-motion-v2") {
            for (const style of ["A", "B", "C"]) {
                const indexes = decoded.styles?.[style];
                if (!Array.isArray(indexes) || indexes.length !== 8 || indexes.some(name =>
                    typeof name !== "string" || !/^[a-f0-9]{64}\.gz$/.test(name))) throw new Error("Invalid motion index");
            }
            return {mapWidth:decoded.mapWidth, banks:[], packed:decoded};
        }
        const model: SectorModel = decoded;
        for (const view of model.banks) for (const clip of Object.values(view)) {
            const filename = clip.url.split("/").pop();
            if (!filename || !/^[a-f0-9]{64}\.webp$/.test(filename)) throw new Error("Invalid sector model page");
            clip.url = folder + filename;
            clip.count = clip.origins.length;
        }
        return model;
    }).catch(error => { if (models.get(url) === request) models.delete(url); throw error; });
    models.set(url, request);
    while (models.size > MODEL_CACHE_LIMIT) models.delete(models.keys().next().value!);
    return request;
}
