import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { isExchangeSaleReceipt, type ExchangeSaleReceipt } from '../../shared/sunscar-exchange.js';

// "While you were away…" inbox. A player who is knocked out OFFLINE — their
// sleeper camp struck by another player (api/player/sleeper-kill.ts) or raided
// by NPC war mercenaries (api/_merc-auto.ts raidSleeperCamp) — wakes in the
// hospital with no memory of it. Those settlements push a notice here; the
// heartbeat (api/player/heartbeat.ts) delivers the inbox and removes notices
// after acknowledgement. Completed Exchange sales use the same delivery path.
//
// Key: `offline-notices:<slug>` → OfflineNotice[] (newest last), capped at 10
// general reports plus 100 Exchange sale receipts,
// 14-day TTL (refreshed on every push). Appends run under the key's own lock so
// two raids landing in the same tick can't drop each other's entry.

export type OfflineNoticeKind = 'sleeper-kill' | 'merc-raid' | 'bounty-placed' | 'bounty-claimed' | 'kage-seat-lost' | 'kage-challenge-refunded' | 'village-unfed' | 'exchange-sale';

export type OfflineNotice = {
    kind: OfflineNoticeKind;
    /** Attacker display name, or "<Village> mercenaries" for an NPC raid.
     *  village-unfed (to the seated Kage): the village name — its provisions
     *  could not cover an active sector war today (api/_war-daily.ts). */
    by: string;
    village?: string;
    /** 0 for non-located events (bounty / kage-seat-lost notices; the latter has by: 'inactivity'). */
    sector: number;
    at: number;
    /** bounty-placed / bounty-claimed: ryo staked / collected. */
    amount?: number;
    /** bounty-placed: the head's total pool after this stake. */
    total?: number;
    /** kage-seat-lost: how long the reign lasted, in ms, so the notice can say
     *  what was actually lost. OPTIONAL on purpose — notices already sitting in
     *  an inbox from before this field existed still parse, and the client
     *  simply drops the tenure sentence when it is absent. */
    tenureMs?: number;
    /** Server-issued receipt; a notification never grants these proceeds. */
    sale?: ExchangeSaleReceipt;
};

const NOTICE_KINDS: ReadonlySet<string> = new Set<OfflineNoticeKind>(['sleeper-kill', 'merc-raid', 'bounty-placed', 'bounty-claimed', 'kage-seat-lost', 'kage-challenge-refunded', 'village-unfed', 'exchange-sale']);

export const OFFLINE_NOTICES_CAP = 10;
/** Sales have their own allowance so a busy stall cannot bury other reports. */
export const EXCHANGE_SALE_NOTICES_CAP = 100;
export const OFFLINE_NOTICES_TTL_SEC = 14 * 24 * 60 * 60;

export function offlineNoticesKey(slug: string): string {
    return `offline-notices:${safeName(slug)}`;
}

function isNotice(v: unknown): v is OfflineNotice {
    if (!v || typeof v !== 'object') return false;
    const n = v as Record<string, unknown>;
    return typeof n.kind === 'string' && NOTICE_KINDS.has(n.kind)
        && typeof n.by === 'string'
        && typeof n.sector === 'number'
        && typeof n.at === 'number'
        && (n.kind !== 'exchange-sale' || isExchangeSaleReceipt(n.sale));
}

/** Append a report, keeping up to 10 general reports and 100 sale receipts. */
export async function pushOfflineNotice(targetSlug: string, notice: OfflineNotice): Promise<void> {
    const key = offlineNoticesKey(targetSlug);
    await withKvLock(key, async () => {
        const raw = await kv.get<unknown>(key);
        const current = Array.isArray(raw) ? raw.filter(isNotice) : [];
        // An uncertain inbox write can be retried by Exchange reconciliation.
        if (notice.kind === 'exchange-sale' && current.some(n => n.kind === 'exchange-sale' && n.sale?.listingId === notice.sale?.listingId)) return;
        const combined = [...current, notice];
        const retained = new Set([
            ...combined.filter(n => n.kind !== 'exchange-sale').slice(-OFFLINE_NOTICES_CAP),
            ...combined.filter(n => n.kind === 'exchange-sale').slice(-EXCHANGE_SALE_NOTICES_CAP),
        ]);
        const next = combined.filter(n => retained.has(n));
        await kv.set(key, next, { ex: OFFLINE_NOTICES_TTL_SEC });
    }, { failClosed: notice.kind === 'exchange-sale' });
}

/** Read + clear the inbox (one-shot delivery). Returns [] when there is nothing. */
export async function takeOfflineNotices(slug: string): Promise<OfflineNotice[]> {
    const key = offlineNoticesKey(slug);
    const raw = await kv.get<unknown>(key);
    const list = Array.isArray(raw) ? raw.filter(isNotice) : [];
    if (raw != null) await kv.del(key);
    return list;
}

/** Parse a raw inbox value already fetched by a caller (e.g. the heartbeat mget). */
export function parseOfflineNotices(raw: unknown): OfflineNotice[] {
    return Array.isArray(raw) ? raw.filter(isNotice) : [];
}
