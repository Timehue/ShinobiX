/** Weekly Boss is a score attack even when reading an older finite-health payload. */
export function weeklyBossScoreView(boss: { damageByPlayer?: Record<string, number> } | null | undefined) {
    const totalDamage = Object.values(boss?.damageByPlayer ?? {})
        .reduce((sum, damage) => sum + Math.max(0, Math.floor(Number(damage) || 0)), 0);
    return { healthLabel: 'Unlimited', totalDamage };
}
