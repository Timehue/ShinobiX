/*
 * Client wrapper for the Sunscar black-market gamble
 * (api/festival/black-market.ts). The server is fully authoritative: it debits
 * the cost, rolls the payout, and returns the reward. The caller reflects the
 * net delta locally so the autosave converges. KEEP cost/cap in sync with
 * api/festival/_black-market.ts.
 */

export const BLACK_MARKET_COST = 50_000;
export const BLACK_MARKET_DAILY_CAP = 10;

export type BlackMarketReward = {
    tier: 'scraps' | 'trinket' | 'haul' | 'relic' | 'fortune' | 'jackpot';
    label: string;
    ryo: number;
    fateShards: number;
    boneCharms: number;
    auraStones: number;
    mythicSeals: number;
};

export type BlackMarketResult = {
    ok: boolean;
    error?: string;
    cost?: number;
    reward?: BlackMarketReward;
    dailyUsed?: number;
    dailyCap?: number;
    balanceRyo?: number;
};

export async function pullBlackMarket(playerName: string): Promise<BlackMarketResult> {
    try {
        const res = await fetch('/api/festival/black-market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName }),
        });
        const data = await res.json().catch(() => ({})) as BlackMarketResult;
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'The black market turns you away.', dailyUsed: data.dailyUsed, dailyCap: data.dailyCap };
        return data;
    } catch {
        return { ok: false, error: 'The black market turns you away. Try again.' };
    }
}

// Human-readable summary of what a pull awarded (for the festival log).
export function describeReward(reward: BlackMarketReward): string {
    const parts = [
        reward.ryo > 0 && `+${reward.ryo.toLocaleString()} ryo`,
        reward.fateShards > 0 && `+${reward.fateShards} Fate Shards`,
        reward.boneCharms > 0 && `+${reward.boneCharms} Bone Charms`,
        reward.auraStones > 0 && `+${reward.auraStones} Aura Stones`,
        reward.mythicSeals > 0 && `+${reward.mythicSeals} Mythic Seal${reward.mythicSeals === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'nothing but sand';
}
