import { AI_PVE_STAT_POINTS_PER_WIN, DAILY_STAT_POINT_CAP, DAILY_PVP_STAT_CAP, PVP_STAT_POINTS_PER_WIN, STAT_BUDGET_SPLIT_DAY, LEGACY_SHARED_STAT_CAP } from '../../../shared/combat-growth-rules';

const splitDate = new Date(`${STAT_BUDGET_SPLIT_DAY}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function GrowthRewardGuide() {
    return <details className="summary-box">
        <summary>How rewards grow your shinobi</summary>
        <p><strong>Levels come from stat points.</strong> Train stats and claim field and hunt dailies. Spend unallocated points in Profile.</p>
        <p><strong>Combat missions pay 1 stat point plus ryo when claimed.</strong> The claim point is unboosted and uses the same shared daily budget, subject to the daily mission-claim limit. Use ryo for gear and jutsu lessons; using jutsu in battle also builds mastery.</p>
        <p><strong>Rewards earned before {splitDate} (00:00 UTC) share one {LEGACY_SHARED_STAT_CAP}-point daily cap across missions, PvE and PvP.</strong> Claiming an older reward later keeps its original day's budget.</p>
        <p><strong>From {splitDate} (00:00 UTC), hunt claims, field jobs and eligible AI wins share {DAILY_STAT_POINT_CAP} stat points per UTC day.</strong> Each hunt or field claim grants 3 before mission bonuses; eligible AI wins roll 0-{AI_PVE_STAT_POINTS_PER_WIN} with an equal chance for each amount. All earned points go into your unspent pool in Profile. Practice fights do not qualify.</p>
        <p><strong>From that date, eligible PvP wins have a separate {DAILY_PVP_STAT_CAP}-point daily cap.</strong> Each eligible player win rolls 1-{PVP_STAT_POINTS_PER_WIN} with an equal chance for each amount. Growth events do not multiply combat-win stat rolls. Both budgets reset at midnight UTC.</p>
        <p>Once an activity's budget is used, it gives no more stat points until reset, but still pays its ryo and other rewards. Training is a separate source of stat points.</p>
    </details>;
}
