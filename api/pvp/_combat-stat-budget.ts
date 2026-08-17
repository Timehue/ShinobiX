import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';

type BudgetStore = Pick<KvLike, 'get' | 'compareSet'>;

type CombatStatAllocation = {
    version: 1;
    battleId: string;
    points: number;
};

type CombatStatBudget = {
    version: 1;
    day: string;
    spent: number;
    /** Pre-v1 numeric spend that has no per-battle proof. */
    legacySpent?: number;
    allocations: Record<string, CombatStatAllocation>;
};

const BUDGET_TTL_SECONDS = 72 * 60 * 60;
const MAX_ALLOCATIONS = 128;

function utcDay(eventAt: number): string {
    if (!Number.isSafeInteger(eventAt) || eventAt <= 0) throw new Error('pvp-combat-stat-event-time-invalid');
    return new Date(eventAt).toISOString().slice(0, 10);
}

function allocationKey(battleId: string): string {
    return createHash('sha256').update(battleId).digest('hex');
}

function parseBudget(raw: unknown, day: string, cap: number): CombatStatBudget | null {
    if (raw === null) return null;
    // Rolling-deploy bridge: the pre-v1 writer stored only a numeric count at
    // this exact key. Preserve that spent budget; the next CAS migrates it to
    // the proof-bearing row without granting those points again.
    if (Number.isSafeInteger(raw) && Number(raw) >= 0 && Number(raw) <= cap) {
        return { version: 1, day, spent: Number(raw), legacySpent: Number(raw), allocations: {} };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('pvp-combat-stat-budget-invalid');
    const value = raw as Partial<CombatStatBudget>;
    if (value.version !== 1 || value.day !== day || !Number.isSafeInteger(value.spent)
        || Number(value.spent) < 0 || Number(value.spent) > cap
        || !value.allocations || typeof value.allocations !== 'object' || Array.isArray(value.allocations)) {
        throw new Error('pvp-combat-stat-budget-invalid');
    }
    const allocations: Record<string, CombatStatAllocation> = {};
    let total = 0;
    for (const [key, entry] of Object.entries(value.allocations)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('pvp-combat-stat-budget-invalid');
        }
        const allocation = entry as Partial<CombatStatAllocation>;
        if (allocation.version !== 1 || typeof allocation.battleId !== 'string' || !allocation.battleId
            || !Number.isSafeInteger(allocation.points) || Number(allocation.points) < 0) {
            throw new Error('pvp-combat-stat-budget-invalid');
        }
        allocations[key] = allocation as CombatStatAllocation;
        total += Number(allocation.points);
    }
    const legacySpent = value.legacySpent === undefined ? 0 : Number(value.legacySpent);
    if (!Number.isSafeInteger(legacySpent)
        || legacySpent < 0
        || Object.keys(allocations).length > MAX_ALLOCATIONS
        || total + legacySpent !== Number(value.spent)) {
        throw new Error('pvp-combat-stat-budget-invalid');
    }
    return {
        version: 1,
        day,
        spent: Number(value.spent),
        ...(legacySpent > 0 ? { legacySpent } : {}),
        allocations,
    };
}

/**
 * Exact, replayable reservation of one battle's base stat points. A crash after
 * this CAS but before the character CAS reuses the same allocation; a lost CAS
 * acknowledgement is accepted only after an exact canonical readback.
 */
export async function reservePvpCombatStatBudget(
    store: BudgetStore,
    params: { playerName: string; battleId: string; eventAt: number; requested: number; cap: number },
): Promise<{ points: number; replayed: boolean; day: string }> {
    const player = safeName(params.playerName);
    const battleId = String(params.battleId ?? '').trim();
    const requested = Math.max(0, Math.floor(Number(params.requested)));
    const cap = Math.max(0, Math.floor(Number(params.cap)));
    if (!player || !battleId || !Number.isSafeInteger(requested) || !Number.isSafeInteger(cap)) {
        throw new Error('pvp-combat-stat-budget-input-invalid');
    }
    const day = utcDay(params.eventAt);
    const key = `combat-stat-count:${player}:${day}`;
    const receiptKey = allocationKey(battleId);
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const raw = await store.get<unknown>(key);
        const current = parseBudget(raw, day, cap) ?? { version: 1 as const, day, spent: 0, allocations: {} };
        const prior = current.allocations[receiptKey];
        if (prior) {
            if (prior.battleId !== battleId) throw new Error('pvp-combat-stat-budget-fingerprint-conflict');
            return { points: prior.points, replayed: true, day };
        }
        if (Object.keys(current.allocations).length >= MAX_ALLOCATIONS) {
            throw new Error('pvp-combat-stat-budget-full');
        }
        const points = Math.min(requested, Math.max(0, cap - current.spent));
        const desired: CombatStatBudget = {
            version: 1,
            day,
            spent: current.spent + points,
            ...(current.legacySpent ? { legacySpent: current.legacySpent } : {}),
            allocations: {
                ...current.allocations,
                [receiptKey]: { version: 1, battleId, points },
            },
        };
        try {
            if (await store.compareSet(key, raw, desired, { ex: BUDGET_TTL_SECONDS })) {
                return { points, replayed: false, day };
            }
        } catch (error) {
            const recovered = await store.get<unknown>(key);
            if (isDeepStrictEqual(recovered, desired)) return { points, replayed: false, day };
            throw error;
        }
    }
    throw new Error('pvp-combat-stat-budget-contended');
}
