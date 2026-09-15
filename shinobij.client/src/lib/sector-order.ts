import type { NoticePost } from "../types/clan";

/** Only the village's persisted, pinned order for this exact sector belongs on its map. */
export function sectorOrderFor(posts: readonly NoticePost[], sector: number): NoticePost | null {
    return posts
        .filter((post) => post.type === "order" && post.pinned && post.sector === sector)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
