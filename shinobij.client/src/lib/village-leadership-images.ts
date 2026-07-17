/*
 * Shared village-leadership portrait cache — drained verbatim from App.tsx.
 *
 * The cache is fed by App's game-state image poll (setVillageLeadershipImagesCache)
 * and read by the Town Hall / Admin portrait editors via loadVillageLeadershipImages;
 * saves persist through the shared game state exactly as before the extraction.
 */

import { normalizeVillageLeadershipImages, type VillageLeadershipImages } from "../data/village-leadership";
import { persistSharedGameState } from "./world-state";

let sharedVillageLeadershipImagesCache: VillageLeadershipImages | null = null;

export function setVillageLeadershipImagesCache(images: VillageLeadershipImages | null) {
    sharedVillageLeadershipImagesCache = images;
}

export function loadVillageLeadershipImages(): VillageLeadershipImages {
    if (sharedVillageLeadershipImagesCache) return normalizeVillageLeadershipImages(sharedVillageLeadershipImagesCache);
    return normalizeVillageLeadershipImages();
}

export function saveVillageLeadershipImages(images: VillageLeadershipImages) {
    sharedVillageLeadershipImagesCache = normalizeVillageLeadershipImages(images);
    persistSharedGameState({ kind: "villageLeadershipImages", images: sharedVillageLeadershipImagesCache });
}
