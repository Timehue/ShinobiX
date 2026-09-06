/*
 * Heartbeat notice acknowledgement — the client half of the protocol in
 * api/player/heartbeat.ts (F18).
 *
 * The server used to consume "while you were away" notices and the one-shot
 * heal signal the moment it delivered them, so a heartbeat response that never
 * reached this tab lost them for good. A beat that declares `noticeAck: true`
 * is instead delivered notices WITH ids and consumes nothing; this module
 * remembers what the latest response carried and echoes those ids on the next
 * beat, and it dedupes display so a re-delivery (a lost response, a reconnect)
 * never shows the same report twice.
 *
 * Deliberately tiny and copy-free: App.tsx imports it statically on the hot
 * heartbeat path (it is part of the initial graph the size gate measures),
 * while the notice wording stays lazily loaded in lib/offline-notices.
 */

/** Ids shown to the player this session (display dedupe). */
const shown = new Set<string>();
/** Ids the LATEST heartbeat response delivered — acknowledged on the next beat. */
let deliveredIds: string[] = [];
/** The heal signal id the latest response delivered, as a number, or 0. */
let healId = 0;

function idOf(entry: unknown): string {
    const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined;
    return typeof id === 'string' ? id : '';
}

export function noticeIdsOf(notices: unknown): string[] {
    return Array.isArray(notices) ? [...new Set(notices.map(idOf).filter(Boolean))] : [];
}

/** The fields every heartbeat body carries to declare and perform acknowledgement. */
export function heartbeatNoticeAckFields(): { noticeAck: true; ackNotices: string[]; ackHeal?: number } {
    return { noticeAck: true, ackNotices: deliveredIds.slice(0, 32), ...(healId > 0 ? { ackHeal: healId } : {}) };
}

/**
 * Record what a heartbeat response delivered. Called on every successful beat
 * BEFORE the payload is acted on, so the next beat acknowledges exactly this
 * delivery — and nothing more once the server stops re-sending it.
 */
export function noteHeartbeatDelivery(data: { pendingHeal?: { id?: unknown } | null; pendingNotices?: unknown } | null | undefined): void {
    healId = Number(idOf(data?.pendingHeal)) || 0;
    deliveredIds = noticeIdsOf(data?.pendingNotices);
}

/**
 * The notices not yet shown this session, marking them shown. An entry without
 * an id (a server that predates the protocol) is always fresh — the legacy
 * server consumed it on delivery, so it can only ever arrive once anyway.
 */
export function takeUnseenNotices<T>(notices: readonly T[]): T[] {
    return notices.filter((entry) => {
        const id = idOf(entry);
        if (!id) return true;
        if (shown.has(id)) return false;
        shown.add(id);
        return true;
    });
}

/** Test hook: forget everything (a new session). */
export function resetNoticeAckState(): void {
    shown.clear();
    deliveredIds = [];
    healId = 0;
}
