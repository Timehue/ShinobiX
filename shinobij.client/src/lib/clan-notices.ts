/*
 * Notice-board helpers — village + clan notice posts.
 *
 * Pure builders/normalizers extracted verbatim from App.tsx (clan/village
 * notice board). makeNoticePost mints a post, normalizeNoticePosts cleans +
 * sorts + caps a list (folding any legacy string notices through
 * makeNoticePost), and noticeTypeLabel maps a type to its display label. No
 * App state is touched — these are re-imported back into App.tsx.
 */

import type { NoticePost, NoticePostType } from "../types/clan";

export function makeNoticePost(type: NoticePostType, title: string, body: string, author: string, authorRole: string, pinned = false, sector?: number): NoticePost {
    return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, title: title.trim().slice(0, 70), body: body.trim().slice(0, 500), author, authorRole, createdAt: Date.now(), pinned, sector };
}
export function normalizeNoticePosts(posts?: Partial<NoticePost>[], legacyNotices: string[] = []): NoticePost[] {
    const structured = (posts ?? [])
        .filter((notice) => notice?.title || notice?.body)
        .map((notice) => ({
            id: String(notice.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            type: (notice.type ?? "general") as NoticePostType,
            title: String(notice.title ?? "Notice").slice(0, 70),
            body: String(notice.body ?? "").slice(0, 500),
            author: String(notice.author ?? "System"),
            authorRole: String(notice.authorRole ?? "System"),
            createdAt: Number(notice.createdAt ?? Date.now()),
            pinned: Boolean(notice.pinned),
            sector: typeof notice.sector === "number" ? notice.sector : undefined,
        }));
    const legacy = legacyNotices.map((body, index) => makeNoticePost("general", "Village Notice", body, "System", "System", index === 0));
    return [...structured, ...legacy].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt - a.createdAt).slice(0, 24);
}
export function noticeTypeLabel(type: NoticePostType) {
    if (type === "order") return "Village Order";
    if (type === "clan") return "Clan Notice";
    return type.charAt(0).toUpperCase() + type.slice(1);
}
