export type WeeklyBossFightToken = {
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    maxDamage: number;
    mintedAt: number;
};

export function weeklyBossFightTokenKey(playerName: string, weekKey: string, token: string): string {
    return `weekly-boss-fight:${weekKey}:${playerName}:${token}`;
}

export function cleanWeeklyBossFightToken(raw: unknown): string {
    const token = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9]+$/.test(token) ? token : '';
}

export function validateWeeklyBossFightClaim(
    token: WeeklyBossFightToken | null | undefined,
    expected: { playerName: string; weekKey: string; aiId: string; bossStartedAt: number },
    amount: unknown,
): { ok: true; damage: number } | { ok: false; reason: string } {
    if (!token) return { ok: false, reason: 'invalid-or-spent-weekly-boss-token' };
    if ((token.playerName ?? '').toLowerCase() !== expected.playerName.toLowerCase()) return { ok: false, reason: 'wrong-player-weekly-boss-token' };
    if (token.weekKey !== expected.weekKey || token.aiId !== expected.aiId || Number(token.bossStartedAt) !== Number(expected.bossStartedAt)) {
        return { ok: false, reason: 'stale-weekly-boss-token' };
    }
    const requested = Math.floor(Number(amount ?? 0));
    if (!Number.isFinite(requested) || requested < 0) return { ok: false, reason: 'invalid-damage' };
    const maxDamage = Math.max(0, Math.floor(Number(token.maxDamage) || 0));
    if (requested > maxDamage) return { ok: false, reason: 'weekly-boss-damage-exceeds-token' };
    return { ok: true, damage: requested };
}
