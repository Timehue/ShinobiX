/**
 * Account-side mirror of the browser's World reward outbox.
 *
 * `world-reward-recovery.ts` (client) keeps the RETRY list for explore / chest
 * request ids in localStorage only, so a player who switches devices or clears
 * storage loses the retry even though the server already holds the durable
 * receipt (`world-explore-receipt:<player>:<id>`) and would replay it. Those
 * receipts are keyed per REQUEST id and cannot be enumerated per player, so
 * this per-player list records the ids whose settlement is still outstanding:
 *
 *   - `explore`: the save mutation committed, but the durable receipt / field
 *     progress may still be finalizing (the 503 retry window), OR the rolled
 *     outcome was a chest that has not been opened yet. Removed once the
 *     receipt is durable and nothing further is owed — or, for a chest, once
 *     `/world/open-chest` pays it.
 *   - `chest`: reserved for a future producer; the client merge understands it
 *     (opens `requestId` directly). Nothing mints it today.
 *
 * The save GET piggybacks this list as `pendingWorldRewards`; the client merges
 * it into its local queue and the existing drain re-posts the same ids, which
 * the handlers replay idempotently. The list is advisory: it never pays
 * anything and never authorizes anything.
 */

import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';

export type PendingWorldReward = {
    kind: 'explore' | 'chest';
    requestId: string;
    sector: number;
    createdAt: number;
};

export const PENDING_WORLD_REWARD_CAP = 50;
export const PENDING_WORLD_REWARD_TTL_SECONDS = 31 * 24 * 60 * 60;
export const PENDING_WORLD_REWARD_MAX_AGE_MS = PENDING_WORLD_REWARD_TTL_SECONDS * 1000;

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,96}$/;

export function pendingWorldRewardsKey(playerName: string): string {
    return `world-reward:pending:${playerName.toLowerCase()}`;
}

export function cleanPendingWorldRewards(raw: unknown, now = Date.now()): PendingWorldReward[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const valid: PendingWorldReward[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const value = entry as Record<string, unknown>;
        const kind = value.kind === 'explore' || value.kind === 'chest' ? value.kind : null;
        const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
        const sector = Math.floor(Number(value.sector));
        const createdAt = Math.floor(Number(value.createdAt));
        if (!kind || !REQUEST_ID_RE.test(requestId) || seen.has(requestId)) continue;
        if (!Number.isSafeInteger(sector) || sector < 1) continue;
        if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || now - createdAt > PENDING_WORLD_REWARD_MAX_AGE_MS) continue;
        seen.add(requestId);
        valid.push({ kind, requestId, sector, createdAt });
    }
    return valid.slice(-PENDING_WORLD_REWARD_CAP);
}

/** Read-only (no lock): the save GET projection. */
export async function readPendingWorldRewards(playerName: string): Promise<PendingWorldReward[]> {
    return cleanPendingWorldRewards(await kv.get(pendingWorldRewardsKey(playerName)));
}

async function writePendingWorldRewards(playerName: string, entries: PendingWorldReward[]): Promise<void> {
    const key = pendingWorldRewardsKey(playerName);
    if (entries.length === 0) {
        await kv.del(key);
        return;
    }
    await kv.set(key, entries, { ex: PENDING_WORLD_REWARD_TTL_SECONDS });
}

/**
 * Record an outstanding settlement. Dedupes by request id (an existing entry
 * keeps its original `createdAt`); the oldest entries fall off past the cap.
 * Fail-closed lock: the callers sit after the save mutation committed, and a
 * thrown contention error lands in their existing "settlement pending" retry
 * path, which the client replays with the same id.
 */
export async function addPendingWorldReward(
    playerName: string,
    entry: { kind: 'explore' | 'chest'; requestId: string; sector: number },
): Promise<PendingWorldReward[]> {
    const key = pendingWorldRewardsKey(playerName);
    return withKvLock(key, async () => {
        const current = cleanPendingWorldRewards(await kv.get(key));
        const existing = current.find((item) => item.requestId === entry.requestId);
        const next = existing
            ? current.map((item) => item === existing ? { ...item, kind: entry.kind, sector: entry.sector } : item)
            : [...current, { kind: entry.kind, requestId: entry.requestId, sector: entry.sector, createdAt: Date.now() }];
        const bounded = next.slice(-PENDING_WORLD_REWARD_CAP);
        await writePendingWorldRewards(playerName, bounded);
        return bounded;
    }, { failClosed: true });
}

/** Drop a settled request id. A no-op (no write) when it is not listed. */
export async function settlePendingWorldReward(playerName: string, requestId: string): Promise<PendingWorldReward[]> {
    const key = pendingWorldRewardsKey(playerName);
    return withKvLock(key, async () => {
        const current = cleanPendingWorldRewards(await kv.get(key));
        const next = current.filter((item) => item.requestId !== requestId);
        if (next.length !== current.length) await writePendingWorldRewards(playerName, next);
        return next;
    }, { failClosed: true });
}
