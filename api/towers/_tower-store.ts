/*
 * Battle Towers — KV storage + server-authoritative reward settlement (Phase 1, P1.B).
 *
 * The security core. Hardened after an adversarial security review. Every payout is
 * fully server-authoritative:
 *   - settle takes the SERVER session (the authoritative tower:<runId> record) and
 *     re-checks completion (status 'done' + squad win) — never a client "I cleared it";
 *   - the floor + reward are resolved from the catalog BY ID (never a client floor);
 *   - the score is computed from the server session;
 *   - the one-time-first-clear gate is a PERMANENT server NX receipt
 *     (tower-firstclear:<slug>:<floor>) — NOT the client-writable battleTowerClearedFloors
 *     array, which is forgeable; the per-run receipt guards replay;
 *   - both receipts are placed INSIDE the member's failClosed save lock and rolled back
 *     if the save write fails (the receipt is on the base store, the save on the disk
 *     overlay — different backends, so rollback restores cross-store atomicity);
 *   - XP is credited through the server gainXp() (a raw char.xp += is per-level progress
 *     the client clamps away on load).
 *
 * kv / lock / now are INJECTABLE (default to the real ones) so the currency logic is
 * unit-testable with a fake in-memory store — same pattern as _lock.ts. See plan §8/§9.
 */
import { kv as realKv } from '../_storage.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { mergePreservingImages } from '../_utils.js';
import { gainXp, type XpCharacter } from '../_xp-engine.js';
import { computeFloorReward, computeAssistReward, computeFloorClearScore, clearMetrics } from './_tower-rewards.js';
import { getFloor } from './_floor-catalog.js';
import type { TowerReward } from './_floor-catalog.js';
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
export const firstClearKey = (slug: string, floor: number) => `tower-firstclear:${slug}:${floor}`;
export const assistPaidKey = (runId: string, slug: string) => `tower-assist-paid:${runId}:${slug}`;
export const assistCountKey = (slug: string, dateKey: string) => `tower-assist-count:${slug}:${dateKey}`;
export const startCountKey = (host: string, dateKey: string) => `tower-start-count:${host}:${dateKey}`;

export const TOWER_SESSION_TTL = 30 * 60;      // 30 min (refreshed on every action)
export const RUN_TOKEN_TTL = 60 * 60;          // 1 h
export const PAID_RECEIPT_TTL = 24 * 60 * 60;  // 24 h (per-run replay guard)
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

/**
 * Atomically consume the run token (single-use). The DELETE is the gate: two concurrent
 * consumers both read the value, but only the one whose del removes the row wins — so a
 * token can never spawn two runs. Mirrors api/_ranked-match-token.ts (tower-token:* is on
 * the base store, so the del rowcount is authoritative).
 */
export async function consumeRunToken(host: string, tokenId: string, deps: StoreDeps = {}): Promise<RunTokenData | null> {
    const kv = deps.kv ?? realKv;
    const key = runTokenKey(host, tokenId);
    const data = await kv.get<RunTokenData>(key);
    if (!data) return null;
    const removed = await kv.del(key);
    if (removed <= 0) return null; // lost the race — another consumer already took it
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

// ─── reward credit (server-authoritative) ────────────────────────────────────
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function isClearedSquadWin(session: TowerSession): boolean {
    return session.status === 'done' && session.winner === 'squad';
}
function isSquadMember(session: TowerSession, slug: string): boolean {
    return session.actors.some(a => a.side === 'squad' && a.ownerSlug === slug);
}

// Apply a first-clear reward + score to a character. The one-time gate is the SERVER
// firstClearKey NX receipt (placed by the caller) — so this ALWAYS credits when reached.
// XP is routed through the server gainXp() (levels up; raw += is clamped away on load).
// The battleTower* arrays are DISPLAY state only (the receipt is the real gate).
function creditFloorClear(
    char: Record<string, unknown>, reward: TowerReward, score: number, floorId: number,
): Record<string, unknown> {
    const leveled = gainXp(char as XpCharacter, num(reward.xp)) as unknown as Record<string, unknown>;
    const cleared = Array.isArray(char.battleTowerClearedFloors) ? (char.battleTowerClearedFloors as number[]) : [];
    const claimed = Array.isArray(char.battleTowerClaimedRewards) ? (char.battleTowerClaimedRewards as string[]) : [];
    const claimKey = `floor-${floorId}`;
    return {
        ...leveled,
        ryo: num(leveled.ryo) + num(reward.ryo),
        fateShards: num(leveled.fateShards) + num(reward.fateShards),
        boneCharms: num(leveled.boneCharms) + num(reward.boneCharms),
        battleTowerClearedFloors: cleared.includes(floorId) ? cleared : [...cleared, floorId],
        battleTowerClaimedRewards: claimed.includes(claimKey) ? claimed : [...claimed, claimKey],
        battleTowerBestFloor: Math.max(num(char.battleTowerBestFloor), floorId),
        // all-time rating = sum of first-clear scores. The PERMANENT firstClearKey receipt
        // guarantees each floor adds exactly once, ever (forgery-proof).
        battleTowerRating: num(char.battleTowerRating) + Math.max(0, Math.floor(score)),
    };
}

export type SettleResult = { paid: boolean; reason?: string; score?: number };

/**
 * Settle a floor clear for ONE squad member, exactly once + one-time-forever. The handler
 * passes the SERVER session (read from tower:<runId>) and the member slug; everything else
 * is recomputed here. Pays nothing for an un-cleared session, a non-member, an unknown
 * floor, an already-paid run, or an already-first-cleared floor.
 */
export async function settleFloorForMember(
    params: { session: TowerSession; slug: string },
    deps: StoreDeps = {},
): Promise<SettleResult> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const { session, slug } = params;

    if (!isClearedSquadWin(session)) return { paid: false, reason: 'not-cleared' };
    if (!isSquadMember(session, slug)) return { paid: false, reason: 'not-a-member' };
    const floor = getFloor(session.floor);
    if (!floor) return { paid: false, reason: 'no-floor' };

    const reward = computeFloorReward(floor);                            // sealed catalog reward
    const score = computeFloorClearScore(clearMetrics(session), floor);  // server-computed

    let result: SettleResult = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${slug}`, async () => {
            const paidReceipt = floorPaidKey(session.runId, floor.id, slug);
            if (!(await kv.set(paidReceipt, { ts: now() }, { nx: true, ex: PAID_RECEIPT_TTL }))) {
                result = { paid: false, reason: 'already-paid' }; return;
            }
            const firstReceipt = firstClearKey(slug, floor.id);
            const firstPlaced = await kv.set(firstReceipt, { ts: now() }, { nx: true }); // PERMANENT (no TTL)
            if (!firstPlaced) { result = { paid: false, reason: 'already-first-cleared', score }; return; }

            const saveKey = `save:${slug}`;
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as Record<string, unknown> | undefined;
            if (!record || !char) {
                await kv.del(paidReceipt, firstReceipt).catch(() => undefined);
                result = { paid: false, reason: 'no-save' }; return;
            }
            const updated = creditFloorClear(char, reward, score, floor.id);
            try {
                await kv.set(saveKey, mergePreservingImages({ ...record, character: updated }, record));
            } catch (e) {
                // save (disk overlay) write failed AFTER the receipts (base store) committed →
                // roll back both so the earned reward isn't permanently lost; a retry settles.
                await kv.del(paidReceipt, firstReceipt).catch(() => undefined);
                throw e;
            }
            result = { paid: true, score };
        }, { failClosed: true });
    } catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}

/**
 * Settle a CAPPED assist reward for a borrowed/offline ally, once per run AND bounded by a
 * daily cap. Server-authoritative (session-verified, floor-by-id). The per-run receipt +
 * cap live inside the save lock and roll back on any non-pay so a slot isn't burned.
 */
export async function settleAssistForAlly(
    params: { session: TowerSession; slug: string },
    deps: StoreDeps = {},
): Promise<SettleResult> {
    const kv = deps.kv ?? realKv;
    const lock = deps.lock ?? realWithKvLock;
    const now = deps.now ?? Date.now;
    const { session, slug } = params;

    if (!isClearedSquadWin(session)) return { paid: false, reason: 'not-cleared' };
    if (!isSquadMember(session, slug)) return { paid: false, reason: 'not-a-member' };
    const floor = getFloor(session.floor);
    if (!floor) return { paid: false, reason: 'no-floor' };
    const reward = computeAssistReward(floor);

    let result: SettleResult = { paid: false, reason: 'unknown' };
    try {
        await lock(`save:${slug}`, async () => {
            const receipt = assistPaidKey(session.runId, slug);
            if (!(await kv.set(receipt, { ts: now() }, { nx: true, ex: PAID_RECEIPT_TTL }))) {
                result = { paid: false, reason: 'assist-already-paid' }; return;
            }
            const count = await kv.incr(assistCountKey(slug, utcDateKey(now())), { ex: 25 * 60 * 60 });
            if (count > MAX_ASSISTS_PER_DAY) {
                await kv.del(receipt).catch(() => undefined); // don't burn the per-run receipt on a denied cap
                result = { paid: false, reason: 'assist-daily-cap' }; return;
            }
            const saveKey = `save:${slug}`;
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as Record<string, unknown> | undefined;
            if (!record || !char) {
                await kv.del(receipt).catch(() => undefined);
                result = { paid: false, reason: 'no-save' }; return;
            }
            const leveled = gainXp(char as XpCharacter, num(reward.xp)) as unknown as Record<string, unknown>;
            const claimed = Array.isArray(char.battleTowerAssistRewardsClaimed) ? (char.battleTowerAssistRewardsClaimed as string[]) : [];
            const updated: Record<string, unknown> = {
                ...leveled,
                ryo: num(leveled.ryo) + num(reward.ryo),
                battleTowerAssistRewardsClaimed: [...claimed, session.runId].slice(-500),
            };
            try {
                await kv.set(saveKey, mergePreservingImages({ ...record, character: updated }, record));
            } catch (e) {
                await kv.del(receipt).catch(() => undefined);
                throw e;
            }
            result = { paid: true };
        }, { failClosed: true });
    } catch {
        result = { paid: false, reason: 'contended' };
    }
    return result;
}
