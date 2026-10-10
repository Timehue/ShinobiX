import { createHash } from 'node:crypto';
import { HOLLOW_BEAST_CACHE_ID } from '../../shared/world-boss-cache.js';
import { appendSettlementReceipt, inspectSettlementReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT } from '../_settlement-receipts.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { WORLD_BOSS_TOP_CACHE_SETTLEMENT_GRACE_MS } from '../../shared/world-boss-event.js';
import {
    readWorldBossEvent,
    readWorldBossMatch,
    readWorldBossQueue,
    worldBossEventKey,
    worldBossQueueKey,
    writeWorldBossEvent,
    type WorldBossEventRecord,
} from './_event.js';

export type WorldBossTopCacheRecipient = { slug: string; name: string; rank: number };
export type WorldBossTopCacheDelivery = WorldBossTopCacheRecipient & {
    character: Record<string, unknown>;
    saveVersion: number;
};

const PENDING_TOP_CACHE_EVENTS_KEY = 'world-boss-event:pending-top-cache-events';
const PENDING_TOP_CACHE_EVENTS_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Keep victorious events discoverable after the active-event pointer advances. */
export async function rememberWorldBossTopCacheEvent(eventId: string): Promise<void> {
    if (!eventId) return;
    await withKvLock(PENDING_TOP_CACHE_EVENTS_KEY, async () => {
        const stored = await kv.get<unknown>(PENDING_TOP_CACHE_EVENTS_KEY);
        const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
        if (!ids.includes(eventId)) ids.push(eventId);
        if ((await kv.set(PENDING_TOP_CACHE_EVENTS_KEY, ids, { ex: PENDING_TOP_CACHE_EVENTS_TTL_SECONDS })) === null) {
            throw new Error('World boss pending cache index write rejected.');
        }
    }, { failClosed: true });
}

/** Retry cache snapshots and grants for victories that are no longer the current event. */
export async function settlePendingWorldBossTopCaches(now = Date.now()): Promise<WorldBossTopCacheDelivery[]> {
    const stored = await kv.get<unknown>(PENDING_TOP_CACHE_EVENTS_KEY);
    const ids = Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === 'string'))] : [];
    if (!ids.length) return [];

    const deliveries: WorldBossTopCacheDelivery[] = [];
    const completed = new Set<string>();
    for (const eventId of ids) {
        const event = await readWorldBossEvent(eventId);
        if (!event || event.status !== 'victory') {
            completed.add(eventId);
            continue;
        }
        deliveries.push(...await settleWorldBossTopCaches(eventId, now));
        const fresh = await readWorldBossEvent(eventId);
        if (fresh && worldBossTopCacheEventComplete(fresh)) completed.add(eventId);
    }

    if (completed.size) {
        await withKvLock(PENDING_TOP_CACHE_EVENTS_KEY, async () => {
            const current = await kv.get<unknown>(PENDING_TOP_CACHE_EVENTS_KEY);
            const currentIds = Array.isArray(current) ? current.filter((id): id is string => typeof id === 'string') : [];
            const remaining = currentIds.filter(id => !completed.has(id));
            if ((await kv.set(PENDING_TOP_CACHE_EVENTS_KEY, remaining, { ex: PENDING_TOP_CACHE_EVENTS_TTL_SECONDS })) === null) {
                throw new Error('World boss pending cache index cleanup rejected.');
            }
        }, { failClosed: true });
    }
    return deliveries;
}

function participantPoints(player: WorldBossEventRecord['participants'][string]): number {
    return Math.max(0, Math.floor(Number(player.damage) || 0))
        + Math.max(0, Math.floor(Number(player.score) || 0))
        + Math.max(0, Math.floor(Number(player.crystalPoints) || 0));
}

export function worldBossTopCacheEventComplete(event: WorldBossEventRecord): boolean {
    return Array.isArray(event.topCacheRecipients)
        && event.topCacheRecipients.every(recipient => event.topCacheClaims?.[recipient.slug]?.rank === recipient.rank);
}

/** Rank the cache awards from the settled leaderboard, with stable tie order. */
export function selectWorldBossTopCacheRecipients(event: WorldBossEventRecord): WorldBossTopCacheRecipient[] {
    return Object.values(event.participants ?? {})
        .filter(player => participantPoints(player) > 0)
        .sort((a, b) => participantPoints(b) - participantPoints(a) || a.slug.localeCompare(b.slug))
        .slice(0, 15)
        .map((player, index) => ({ slug: player.slug, name: player.name, rank: index + 1 }));
}

/**
 * Freeze cache recipients after every team that was already active at victory
 * has settled. A six-hour cutoff prevents a disconnected or abandoned match
 * from leaving the award list pending forever; late settlements still update
 * standings but cannot rewrite a cache payout that has already been issued.
 */
export async function finalizeWorldBossTopCacheRecipients(eventId: string, now = Date.now()): Promise<boolean> {
    const observed = await readWorldBossEvent(eventId);
    if (!observed || observed.status !== 'victory' || Array.isArray(observed.topCacheRecipients)) return false;

    return withKvLock(worldBossEventKey(eventId), async () => {
        const event = await readWorldBossEvent(eventId);
        if (!event || event.status !== 'victory' || Array.isArray(event.topCacheRecipients)) return false;

        // Event → queue is the established lock order. A victory prevents new
        // queue starts; this read waits for an in-progress queue mutation to
        // finish before deciding that the pre-victory matches are all settled.
        const queue = await withKvLock(worldBossQueueKey(eventId), () => readWorldBossQueue(eventId), { failClosed: true });
        const matches = await Promise.all([...new Set(queue.activeMatchIds)].map(matchId => readWorldBossMatch(eventId, matchId)));
        const pendingMatches = matches.filter(match => match?.status === 'preparing' || match?.status === 'active');
        const deadline = event.topCacheSettlementDeadlineAt
            ?? (event.endedAt ?? event.updatedAt) + WORLD_BOSS_TOP_CACHE_SETTLEMENT_GRACE_MS;
        if (pendingMatches.length > 0 && now < deadline) return false;

        event.topCacheRecipients = selectWorldBossTopCacheRecipients(event);
        event.topCacheSnapshotAt = now;
        event.topCacheSnapshotExpired = pendingMatches.length > 0;
        event.topCacheClaims ??= {};
        event.updatedAt = now;
        await writeWorldBossEvent(event);
        return true;
    }, { failClosed: true });
}

function topCacheReceiptId(eventId: string, slug: string): string {
    return `wbhc_${createHash('sha256').update(`${eventId}:${slug}`).digest('hex').slice(0, 32)}`;
}

/** Retry-safe grant of one stackable Hollow Beast Cache to each locked winner. */
export async function settleWorldBossTopCaches(eventId: string, now = Date.now()): Promise<WorldBossTopCacheDelivery[]> {
    await finalizeWorldBossTopCacheRecipients(eventId, now);
    const event = await readWorldBossEvent(eventId);
    if (!event || event.status !== 'victory' || !Array.isArray(event.topCacheRecipients)) return [];
    const delivered: WorldBossTopCacheDelivery[] = [];

    for (const recipient of event.topCacheRecipients) {
        const current = await readWorldBossEvent(eventId);
        if (!current || current.status !== 'victory' || current.topCacheClaims?.[recipient.slug]?.rank === recipient.rank) continue;
        const requestId = topCacheReceiptId(eventId, recipient.slug);
        const fingerprint = `world-boss-top-cache:${eventId}:${recipient.slug}:${recipient.rank}`;
        const result = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ granted: boolean; rank: number }>(recipient.slug, ({ character }) => {
            const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
            if (inspected.status === 'replay') {
                const prior = inspected.receipt.value;
                return {
                    ok: true,
                    write: false,
                    character,
                    value: { granted: prior.granted === true, rank: recipient.rank },
                };
            }
            if (inspected.status !== 'fresh') throw new Error('Hollow Beast Cache receipt is not safe to replay.');
            if (!receiptAbsenceProvable(inspected.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', current.startedAt)) {
                return { ok: true, write: false, character, value: { granted: false, rank: recipient.rank } };
            }

            const rawStacks = character.itemStacks;
            if (rawStacks !== undefined && !Array.isArray(rawStacks)) {
                return { ok: false, status: 409, error: 'Stored item stacks are invalid.' };
            }
            const stacks = [...((rawStacks as Array<Record<string, unknown>> | undefined) ?? [])];
            const cacheIndex = stacks.findIndex(stack => stack?.itemId === HOLLOW_BEAST_CACHE_ID);
            if (cacheIndex >= 0) {
                const count = Math.floor(Number(stacks[cacheIndex]?.count) || 0);
                if (count < 1 || count >= 9_999) return { ok: false, status: 409, error: 'The Hollow Beast Cache stack cannot be updated safely.' };
                stacks[cacheIndex] = { ...stacks[cacheIndex], count: count + 1 };
            } else {
                stacks.push({ itemId: HOLLOW_BEAST_CACHE_ID, count: 1 });
            }
            const next = {
                ...character,
                itemStacks: stacks,
            };
            return {
                ok: true,
                character: appendSettlementReceipt(next, inspected.receipts, {
                    requestId,
                    fingerprint,
                    value: { granted: true, rank: recipient.rank },
                    settledAt: now,
                }),
                value: { granted: true, rank: recipient.rank },
            };
        }));
        if (!result.ok || !result.value.granted) continue;

        await withKvLock(worldBossEventKey(eventId), async () => {
            const fresh = await readWorldBossEvent(eventId);
            if (!fresh || fresh.status !== 'victory') return;
            fresh.topCacheClaims = {
                ...(fresh.topCacheClaims ?? {}),
                [recipient.slug]: { rank: recipient.rank, claimedAt: now },
            };
            const allClaimed = fresh.topCacheRecipients?.every(entry => fresh.topCacheClaims?.[entry.slug]?.rank === entry.rank) ?? false;
            if (allClaimed) fresh.topCachesDistributedAt = fresh.topCachesDistributedAt ?? now;
            fresh.updatedAt = now;
            await writeWorldBossEvent(fresh);
        }, { failClosed: true });
        delivered.push({ ...recipient, character: result.character, saveVersion: result._saveVersion });
    }

    return delivered;
}
