/*
 * The ONE shared daily stat-point budget (owner ruling A1, 2026-10 rebalance),
 * as the mission claim path uses it. Hunt and field claims reserve their boosted
 * stat points against the same `combat-stat-count:<player>:<UTC day>` row that
 * PvE and PvP wins reserve against (api/pvp/_combat-stat-budget.ts), capped at
 * DAILY_COMBAT_STAT_CAP (the DAILY_STAT_POINT_CAP dial, api/_stat-growth.ts).
 *
 * Two additions over a bare reservation:
 *   - once the day's budget is spent, a claim reads the row and pays 0 without
 *     writing an allocation, so a long claiming day cannot fill the row's
 *     allocation table that the AI-fight reservations also need;
 *   - the reply carries the day's spend, so the claim screens can show
 *     "Stat points today: 41 / 60" (owner ruling A9).
 * The row layout (key, sha256 allocation ids) mirrors _combat-stat-budget.ts and
 * is pinned against it by a round-trip test in _daily-stat-budget.test.ts.
 */
import { createHash } from 'node:crypto';
import type { KvLike } from './_storage.js';
import { safeName } from './_utils.js';
import { DAILY_COMBAT_STAT_CAP } from './_stat-growth.js';
import { reserveCombatStatBudget } from './pvp/_combat-stat-budget.js';

type BudgetStore = Pick<KvLike, 'get' | 'compareSet'>;

export type DailyStatBudgetView = { day: string; spent: number; cap: number };

export function dailyStatBudgetDay(eventAt: number): string {
    return new Date(eventAt).toISOString().slice(0, 10);
}

export function dailyStatBudgetKey(playerName: string, day: string): string {
    return `combat-stat-count:${safeName(playerName)}:${day}`;
}

function whole(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Points granted so far today. Tolerant: a legacy numeric row counts as spent. */
function spentOf(raw: unknown): number {
    if (typeof raw === 'number') return whole(raw);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return whole((raw as { spent?: unknown }).spent);
    return 0;
}

/** The points this receipt already holds in the row, or null when it has none. */
function priorAllocation(raw: unknown, receiptId: string): number | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const allocations = (raw as { allocations?: unknown }).allocations;
    if (!allocations || typeof allocations !== 'object' || Array.isArray(allocations)) return null;
    const entry = (allocations as Record<string, unknown>)[createHash('sha256').update(receiptId).digest('hex')];
    if (!entry || typeof entry !== 'object' || (entry as { battleId?: unknown }).battleId !== receiptId) return null;
    return whole((entry as { points?: unknown }).points);
}

function view(raw: unknown, day: string): DailyStatBudgetView {
    return { day, spent: Math.min(DAILY_COMBAT_STAT_CAP, spentOf(raw)), cap: DAILY_COMBAT_STAT_CAP };
}

export async function readDailyStatBudget(store: Pick<KvLike, 'get'>, playerName: string, eventAt: number): Promise<DailyStatBudgetView> {
    const day = dailyStatBudgetDay(eventAt);
    return view(await store.get<unknown>(dailyStatBudgetKey(playerName, day)), day);
}

/**
 * Today's spend as a reply field (`statBudget`), so every screen that can grant
 * stat points shows "Stat points today: 41 / 60" from its first load, not only
 * after a hunt claim (owner ruling A9). Display only: a failed read omits it.
 */
export async function dailyStatBudgetReply(store: Pick<KvLike, 'get'>, playerName: string, now = Date.now()): Promise<{ statBudget?: DailyStatBudgetView }> {
    try {
        return { statBudget: await readDailyStatBudget(store, playerName, now) };
    } catch {
        return {};
    }
}

/**
 * Reserve one claim's stat points. `receiptId` is the claim's durable identity,
 * so a retry after a lost save write replays the same allocation and pays it
 * once. Returns the points to credit (never more than `requested` or what is
 * left of the day) and the day's spend after the reservation.
 */
export async function reserveDailyStatPoints(
    store: BudgetStore,
    params: { playerName: string; receiptId: string; eventAt: number; requested: number },
): Promise<{ points: number; replayed: boolean; budget: DailyStatBudgetView }> {
    const day = dailyStatBudgetDay(params.eventAt);
    const key = dailyStatBudgetKey(params.playerName, day);
    const requested = whole(params.requested);
    const before = await store.get<unknown>(key);
    const prior = priorAllocation(before, params.receiptId);
    if (prior !== null) return { points: prior, replayed: true, budget: view(before, day) };
    if (requested === 0 || spentOf(before) >= DAILY_COMBAT_STAT_CAP) {
        return { points: 0, replayed: false, budget: view(before, day) };
    }
    let reserved: { points: number; replayed: boolean };
    try {
        reserved = await reserveCombatStatBudget(store, {
            playerName: params.playerName,
            battleId: params.receiptId,
            eventAt: params.eventAt,
            requested,
            cap: DAILY_COMBAT_STAT_CAP,
        });
    } catch (error) {
        // A full allocation table only happens after a long day of fights, when
        // the budget is spent anyway: the claim pays its other rewards.
        if (error instanceof Error && error.message === 'pvp-combat-stat-budget-full') {
            return { points: 0, replayed: false, budget: view(before, day) };
        }
        throw error;
    }
    const after = await store.get<unknown>(key);
    return { points: reserved.points, replayed: reserved.replayed, budget: view(after, day) };
}
