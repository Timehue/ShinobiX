import type { StoryBossSettleResult } from './story-combat-api';

/** Per-action values come only from the receipt, never differences in totals. */
export function storyRewardSummary(result: StoryBossSettleResult): string {
    const grants = [
        [result.statPoints, 'stat points'], [result.ryo, 'ryo'], [result.auraDust, 'Aura Dust'],
    ] as const;
    return grants.filter(([value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)
        .map(([value, label]) => `+${value!.toLocaleString()} ${label}`).join(' · ');
}

export function storyDeliverySummary(result: StoryBossSettleResult): string[] {
    const delivery = result.delivery;
    if (!delivery) return [];
    const legacy = {
        pending: 'Legacy contribution delivery is pending. Retry to finish.',
        unavailable: 'Legacy contribution status is unavailable.',
        confirmed: 'Legacy contribution recorded.',
        'not-applicable': '',
    }[delivery.legacyRecord];
    return [delivery.combatRecord === 'unavailable' ? 'Combat record status unavailable.' : '', legacy].filter(Boolean);
}
