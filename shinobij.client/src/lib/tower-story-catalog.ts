import type { TowerFloorMeta } from "./towers-api";

export type TowerStoryChapter = {
    key: string;
    number: number;
    title: string;
    subtitle: string | null;
    summary: string | null;
    artKey: string | null;
    floors: TowerFloorMeta[];
};

function finiteFloorId(value: unknown): number | null {
    const floor = Math.floor(Number(value));
    return Number.isFinite(floor) && floor > 0 ? floor : null;
}

/** Stable, defensive catalog order. Duplicate IDs cannot create duplicate floor controls. */
export function orderedTowerStoryFloors(floors: readonly TowerFloorMeta[]): TowerFloorMeta[] {
    const byId = new Map<number, TowerFloorMeta>();
    for (const floor of floors) {
        const id = finiteFloorId(floor.id);
        if (id != null && !byId.has(id)) byId.set(id, floor);
    }
    return [...byId.values()].sort((left, right) => left.id - right.id);
}

/**
 * Select the next server-authorized numeric floor when it exists. Once the catalog is
 * complete, keep the deepest known floor selected instead of jumping back to Floor 1.
 */
export function recommendedTowerStoryFloor(
    floors: readonly TowerFloorMeta[],
    bestFloor: number,
): number | null {
    const ordered = orderedTowerStoryFloors(floors);
    if (ordered.length === 0) return null;
    const best = Math.max(0, Math.floor(Number(bestFloor) || 0));
    const next = ordered.find(floor => floor.id === best + 1);
    if (next) return next.id;
    const deepestReached = [...ordered].reverse().find(floor => floor.id <= best);
    return deepestReached?.id ?? ordered[0]!.id;
}

/** Keep the client preview gate byte-aligned with storyTowerEligibility on the server. */
export function isTowerStoryFloorActionable({
    floor,
    bestFloor,
    clearedFloors,
    levelEligible,
    admin,
}: {
    floor: number;
    bestFloor: number;
    clearedFloors: ReadonlySet<number>;
    levelEligible: boolean;
    admin: boolean;
}): boolean {
    if (admin) return true;
    if (!levelEligible) return false;
    const floorId = finiteFloorId(floor);
    if (floorId == null) return false;
    const best = Math.max(0, Math.floor(Number(bestFloor) || 0));
    return clearedFloors.has(floorId) || floorId === best + 1;
}

/**
 * Chapters are authored by the API. Old cached catalogs without chapter fields remain
 * usable as one neutral chapter until their short-lived cache refreshes.
 */
export function groupTowerStoryChapters(floors: readonly TowerFloorMeta[]): TowerStoryChapter[] {
    const chapters = new Map<string, TowerStoryChapter>();
    for (const floor of orderedTowerStoryFloors(floors)) {
        const number = Math.max(1, Math.floor(Number(floor.chapter) || 1));
        const title = floor.chapterTitle?.trim() || (number === 1 ? "The Celestial Ascent" : `Chapter ${number}`);
        const key = `${number}:${title}`;
        const existing = chapters.get(key);
        if (existing) {
            existing.floors.push(floor);
            continue;
        }
        chapters.set(key, {
            key,
            number,
            title,
            subtitle: floor.chapterSubtitle?.trim() || null,
            summary: floor.chapterSummary?.trim() || null,
            artKey: floor.artKey?.trim() || null,
            floors: [floor],
        });
    }
    return [...chapters.values()].sort((left, right) => left.number - right.number);
}
