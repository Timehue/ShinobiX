import type { StoryBossSettleResult } from '../lib/story-combat-api';
import { storyDeliverySummary, storyRewardSummary } from '../lib/story-result-presentation';

/** Receipt copy within the existing story result card. */
export function StoryRewardSummary({ result }: { result: StoryBossSettleResult }) {
    const reward = storyRewardSummary(result);
    const details = [
        result.title && `${result.replayed ? 'Title recorded' : 'Title earned'}: ${result.title}`,
        result.finale && result.character?.inventory?.includes('hollow-gate-key') && 'Hollow Gate Key confirmed.',
        result.chronicleCards?.length && `${result.chronicleCards.length} Chronicle ${result.chronicleCards.length === 1 ? 'card' : 'cards'} recorded for this victory.`,
        ...storyDeliverySummary(result),
    ].filter(Boolean);
    return <p className="story-fight-complete-rewards" role="status">
        {result.replayed ? 'Previously committed reward' : 'Personal reward committed'}{reward ? `: ${reward}` : '.'}
        {details.map((line, index) => <span className="story-fight-complete-title" key={index}>{line}</span>)}
    </p>;
}
