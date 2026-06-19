/*
 * Battle Towers — KV storage + server-authoritative reward settlement (Phase 1, P1.B).
 *
 * The security core. Owns the tower KV key scheme, the single-use run token, the live
 * session record, and the IDEMPOTENT per-member reward credit. Every payout is
 * server-authoritative: paid from the SEALED floor reward, gated by a per-(run,floor,
 * member) NX receipt placed INSIDE the member's own save lock (failClosed), and a
 * one-time first-clear check so re-clears pay nothing. Mirrors api/pvp/claim-rewards.ts.
 *
 * kv / lock / now / id are INJECTABLE (default to the real ones) so the settlement
 * logic is unit-testable with a fake in-memory store — the same pattern as _lock.ts.
 * See docs/battle-towers-plan.md §8, §9.
 */
import { kv as realKv } from '../_storage.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { mergePreservingImages } from '../_utils.js';
import { computeFloorReward, computeAssistReward, computeFloorClearScore, type ClearMetrics } from './_tower-rewards.js';
import type { TowerFloor, TowerReward } from './_floor-catalog.js';
import type { TowerSession } from './_tower-session.js';

// ─── minimal injectable interfaces ───────────────────────────────────────────
export type TowerKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
    del(...keys: string[]): Promise<number>;
    incr(key: string, opts?: { ex?: number }): Promise<number>;
};
export type TowerLock = <T>(target: string, fn: () => Promise<T>, opts?: { failClosed?: boolean }) => Promise<T>;
export type StoreDeps = { kv?: TowerKv; lock?: TowerLock; now?: () => number };

// ─── key scheme (all server-only; on the base Postgres store, NOT the disk overlay) ─
export const sessionKey = (runId: string) => `tower:${runId}`;
export const runTokenKey = (host: string, tokenId: string) => `tower-token:${host}:${tokenId}`;
export const floorPaidKey = (runId: string, floor: number, slug: string) => `tower-paid:${runId}:${floor}:${slug}`;
export const assistPaidKey = (runId: string, slug: string) => `tower-assist-paid:${runId}:${slug}`;
export const assistCountKey = (slug: string, dateKey: string) => `tower-assist-count:${slug}:${dateKey}`;
export const startCountKey = (host: string, dateKey: string) => `tower-start-count:${host}:${dateKey}`;

export const TOWER_SESSION_TTL = 30 * 60;      // 30 min (refreshed on every action)
export const RUN_TOKEN_TTL = 60 * 60;          // 1 h
export const PAID_RECEIPT_TTL = 24 * 60 * 60;  // 24 h
export const MAX_TOWER_STARTS_PER_DAY = 60;
export const MAX_ASSISTS_PER_DAY = 20;

export function utcDateKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

// ─── sealed run token (single-use) ───────────────────────────────────────────
export type RunTokenData = {
    host: string;
    members: string[];     // slugs
    seed: number;
    floor: number;
    partySize: number;
    mintedAt: number;
};

/** Atomic daily mint cap (kv.incr). Returns the post-increment count; caller rejects > cap. */
export async function bumpDailyStartCount(host: string, deps: StoreDeps = {}): Promise<number> {
    const kv = deps.kv ?? realKv;
    const now = deps.now ?? Date.now;
    return kv.incr(startCountKey(host, utcDateKey(now())), { ex: 25 * 60 * 60 });
}

export async function storeRunToken(tokenId: string, data: RunTokenData, deps: StoreDeps = {}): Promise<void> {
    const kv = deps.kv ?? realKv;
    await kv.set(runTokenKey(data.host, tokenId), data, { ex: RUN_TOKEN_TTL });
}

/** Read + atomically delete the run token. Returns the sealed data, or null if missing/spent. */
export async function consumeRunToken(host: string, tokenId: string, deps: StoreDeps = {}): Promise<RunTokenData | null> {
    const kv = deps.kv ?? realKv;
    const key = runTokenKey(host, tokenId);
    const data = await kv.get<RunTokenData>(key);
    if (!data) return null;
    await kv.del(key).catch(() => undefined); // single-use
    return data;
}

// ─── live session ────────────────────────────────────────────────────────────
export async function readSession(runId: string, deps: StoreDeps = {}): Promise<TowerSession | null> {
    const kv = deps.kv ?? realKv;
    return kv.get<TowerSession>(sessionKey(runId));
}
export async function writeSession(session: TowerSession, deps: StoreDeps = {}): Promise<void> {
    const kv = deps.kv ?? realKv;
    await kv.set(sessionKey(session.runId), session, { ex: TOWER_SESSION_TTL });
}

// ─── reward credit (server-authoritative, idempotent, one-time first-clear) ───
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Apply a first-clear reward + score to a character. Returns credited:false (char
// unchanged) if the member has ALREADY first-cleared this floor (one-time rewards).
function creditFloorClear(
    char: Record<string, unknown>, reward: TowerReward, score: number, floorId: number,
): { updated: Record<string, unknown>; credited: boolean } {
    const cleared = Array.isArray(char.battleTowerClearedFloors) ? (char.battleTowerClearedFloors as number[]) : [];
    if (cleared.includes(floorId)) return { updated: char, credited: false };
    const claimed = Array.isArray(char.battleTowerClaimedRewards) ? (char.battleTowerClaimedRewards as string[]) : [];
    const claimKey = `floor-${floorId}`;
    const updated: Record<string, unknown> = {
        ...char,
        ryo: num(char.ryo) + num(reward.ryo),
        xp: num(char.xp) + num(reward.xp),
        fateShards: num(char.fateShards) + num(reward.fateShards),
        boneCharms: num(char.boneCharms) + num(reward.boneCharms),
        battleTowerClearedFloors: [...cleared, floorId],
        battleTowerClaimedRewards: claimed.includes(claimKey) ? claimed : [...claimed, claimKey],
        battleTowerBestFloor: Math.max(num(char.battleTowerBestFloor), floorId),
        // all-time rating = sum of first-clear scores (each floor adds once; the
        // per-(run,floor,member) NX receipt + the one-time gate prevent any double-add).
        battleTowerRating: num(char.battleTowerRating) + Math.max(0, Math.floor(score)),
    };
    return { updated, credited: true };
}

export type SettleResult = { paid: boolean; reason?: string; score?: number };

/**
 * Settle a floor clear for ONE squad member, exactly once. The NX receipt is placed
 * INSIDE the save lock so receipt + credit are atomic (a contention abort places
 * nothing → a clean retry). Reward is the SEALED floor reward; score is server-computed.
 */
export async function settleFloorForMember(
    params: { runId: string; floor: TowerFloor; slug: string; metrics: ClearMetrics },
    deps: StoreDeps = {},
): Promise<SettleResult> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const reward = computeFloorReward(params.floor);              // sealed catalog reward
    const score = computeFloorClearScore(params.metrics, params.floor); // server-computed
    let result: SettleResult = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${params.slug}`, async () => {
            const receipt = floorPaidKey(params.runId, params.floor.id, params.slug);
            const placed = await kv.set(receipt, { ts: now() }, { nx: true, ex: PAID_RECEIPT_TTL });
            if (!placed) { result = { paid: false, reason: 'already-paid' }; return; }
            const saveKey = `save:${params.slug}`;
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as Record<string, unknown> | undefined;
            if (!record || !char) { result = { paid: false, reason: 'no-save' }; return; }
            const { updated, credited } = creditFloorClear(char, reward, score, params.floor.id);
            if (credited) {
                await kv.set(saveKey, mergePreservingImages({ ...record, character: updated }, record));
                result = { paid: true, score };
            } else {
                result = { paid: false, reason: 'already-first-cleared', score };
            }
        }, { failClosed: true });
    } catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}

/**
 * Settle a CAPPED assist reward for a borrowed/offline ally, once per run AND bounded by
 * a daily cap. Gated by a per-(run,ally) NX receipt + an atomic daily counter.
 */
export async function settleAssistForAlly(
    params: { runId: string; floor: TowerFloor; slug: string },
    deps: StoreDeps = {},
): Promise<SettleResult> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const placed = await kv.set(assistPaidKey(params.runId, params.slug), { ts: now() }, { nx: true, ex: PAID_RECEIPT_TTL });
    if (!placed) return { paid: false, reason: 'assist-already-paid' };
    const count = await kv.incr(assistCountKey(params.slug, utcDateKey(now())), { ex: 25 * 60 * 60 });
    if (count > MAX_ASSISTS_PER_DAY) return { paid: false, reason: 'assist-daily-cap' };
    const reward = computeAssistReward(params.floor);
    let result: SettleResult = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${params.slug}`, async () => {
            const saveKey = `save:${params.slug}`;
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as Record<string, unknown> | undefined;
            if (!record || !char) { result = { paid: false, reason: 'no-save' }; return; }
            const claimed = Array.isArray(char.battleTowerAssistRewardsClaimed) ? (char.battleTowerAssistRewardsClaimed as string[]) : [];
            const updated: Record<string, unknown> = {
                ...char,
                ryo: num(char.ryo) + num(reward.ryo),
                xp: num(char.xp) + num(reward.xp),
                battleTowerAssistRewardsClaimed: [...claimed, params.runId].slice(-500),
            };
            await kv.set(saveKey, mergePreservingImages({ ...record, character: updated }, record));
            result = { paid: true };
        }, { failClosed: true });
    } catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}
