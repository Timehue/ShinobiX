import type { PlayerCharacter } from '../save/_mutate-player-save.js';

export const BLOODLINE_FORGE_RANKS = ['B Rank', 'A Rank', 'S Rank'] as const;
export type BloodlineForgeRank = typeof BLOODLINE_FORGE_RANKS[number];
export type BloodlineForgeCurrency = 'boneCharms' | 'auraStones' | 'mythicSeals';

export interface PendingBloodlineForge {
    id: string;
    rank: BloodlineForgeRank;
    issuedAt: number;
}

export const BLOODLINE_FORGE_COSTS: Record<BloodlineForgeRank, { currency: BloodlineForgeCurrency; cost: number }> = {
    'B Rank': { currency: 'boneCharms', cost: 100 },
    'A Rank': { currency: 'auraStones', cost: 100 },
    'S Rank': { currency: 'mythicSeals', cost: 100 },
};

const PENDING_FORGE_CAP = 3;

export function parseBloodlineForgeRank(value: unknown): BloodlineForgeRank | null {
    return typeof value === 'string' && (BLOODLINE_FORGE_RANKS as readonly string[]).includes(value)
        ? value as BloodlineForgeRank
        : null;
}

export function readPendingBloodlineForges(value: unknown): PendingBloodlineForge[] {
    if (!Array.isArray(value)) return [];
    const out: PendingBloodlineForge[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(item.id) ? item.id : '';
        const rank = parseBloodlineForgeRank(item.rank);
        const issuedAt = Math.max(0, Math.floor(Number(item.issuedAt) || 0));
        if (!id || !rank || !issuedAt || seen.has(id)) continue;
        out.push({ id, rank, issuedAt });
        seen.add(id);
        if (out.length >= PENDING_FORGE_CAP) break;
    }
    return out;
}

export type BloodlineForgePurchase =
    | {
        ok: true;
        character: PlayerCharacter;
        pending: PendingBloodlineForge[];
        entitlement: PendingBloodlineForge;
        currency: BloodlineForgeCurrency;
        cost: number;
        balance: number;
    }
    | { ok: false; status: number; error: string };

export function applyBloodlineForgePurchase(
    character: PlayerCharacter,
    pendingRaw: unknown,
    rankRaw: unknown,
    entitlementId: string,
    now: number,
): BloodlineForgePurchase {
    const rank = parseBloodlineForgeRank(rankRaw);
    if (!rank) return { ok: false, status: 400, error: 'Invalid bloodline rank.' };
    const pending = readPendingBloodlineForges(pendingRaw);
    if (pending.length >= PENDING_FORGE_CAP) {
        return { ok: false, status: 409, error: 'Finish your pending Bloodline Awakening before beginning another.' };
    }
    const { currency, cost } = BLOODLINE_FORGE_COSTS[rank];
    const balance = Math.max(0, Math.floor(Number(character[currency]) || 0));
    if (balance < cost) return { ok: false, status: 409, error: `Not enough ${currency}.` };
    const entitlement: PendingBloodlineForge = { id: entitlementId, rank, issuedAt: Math.floor(now) };
    return {
        ok: true,
        character: { ...character, [currency]: balance - cost },
        pending: [...pending, entitlement],
        entitlement,
        currency,
        cost,
        balance: balance - cost,
    };
}
