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
 * heartbeat path, while the notice wording stays lazily loaded in
 * lib/offline-notices.
 */

const NOTICE_ACK_LIMIT = 32;

/** Ids shown to the player this session (display dedupe). */
const shown = new Set<string>();
/** Ids the LATEST heartbeat response delivered — acknowledged on the next beat. */
let deliveredIds: string[] = [];
/** The heal signal id the latest response delivered, if any. */
let healId: string | null = null;

function idOf(entry: unknown): string | null {
    if (!entry || typeof entry !== 'object') return null;
    const id = (entry as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
}

export function noticeIdsOf(notices: unknown): string[] {
    if (!Array.isArray(notices)) return [];
    const ids: string[] = [];
    for (const entry of notices) {
        const id = idOf(entry);
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/** The fields every heartbeat body carries to declare and perform acknowledgement. */
export function heartbeatNoticeAckFields(): { noticeAck: true; ackNotices: string[]; ackHeal?: number } {
    const ackHeal = healId ? Number(healId) : 0;
    return {
        noticeAck: true,
        ackNotices: deliveredIds.slice(0, NOTICE_ACK_LIMIT),
        ...(Number.isFinite(ackHeal) && ackHeal > 0 ? { ackHeal } : {}),
    };
}

/**
 * Record what a heartbeat response delivered. Called on every successful beat
 * BEFORE the payload is acted on, so the next beat acknowledges exactly this
 * delivery — and nothing more once the server stops re-sending it.
 */
export function noteHeartbeatDelivery(data: { pendingHeal?: { id?: unknown } | null; pendingNotices?: unknown } | null | undefined): void {
    const heal = data?.pendingHeal;
    healId = heal && typeof heal === 'object' && typeof heal.id === 'string' && heal.id ? heal.id : null;
    deliveredIds = noticeIdsOf(data?.pendingNotices);
}

/**
 * The notices not yet shown this session, marking them shown. An entry without
 * an id (a server that predates the protocol) is always fresh — the legacy
 * server consumed it on delivery, so it can only ever arrive once anyway.
 */
export function takeUnseenNotices<T>(notices: readonly T[]): T[] {
    const fresh: T[] = [];
    for (const entry of notices) {
        const id = idOf(entry);
        if (id) {
            if (shown.has(id)) continue;
            shown.add(id);
        }
        fresh.push(entry);
    }
    return fresh;
}

/** Test hook: forget everything (a new session). */
export function resetNoticeAckState(): void {
    shown.clear();
    deliveredIds = [];
    healId = null;
}
