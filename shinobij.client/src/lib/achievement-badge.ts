/** Keep replaced fixed-path badge art out of stale last-known-good image caches. */
export const LEVEL_10_ACHIEVEMENT_ART_REVISION = "20261001-rising-kite";

export function achievementBadgeSrc(id: string): string {
    const path = `/badges/${id}.webp`;
    return id === "level-10" ? `${path}?v=${LEVEL_10_ACHIEVEMENT_ART_REVISION}` : path;
}
