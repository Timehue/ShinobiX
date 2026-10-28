import { AI_PVE_STAT_POINTS_PER_WIN, DAILY_STAT_POINT_CAP, PVP_STAT_POINTS_PER_WIN } from '../../../shared/combat-growth-rules';

export function GrowthRewardGuide() {
    return <details className="summary-box">
        <summary>How rewards grow your shinobi</summary>
        <p><strong>Levels come from stat points.</strong> Train stats and claim field and hunt dailies. Spend unallocated points in Profile.</p>
        <p><strong>Combat missions pay 1 stat point plus ryo when claimed.</strong> The claim point is unboosted and uses the same shared daily budget, subject to the daily mission-claim limit. Use ryo for gear and jutsu lessons; using jutsu in battle also builds mastery.</p>
        <p><strong>Hunt claims, field jobs and eligible AI and player wins share {DAILY_STAT_POINT_CAP} stat points per UTC day.</strong> Each hunt or field claim grants 3 before mission bonuses; eligible AI wins grant up to {AI_PVE_STAT_POINTS_PER_WIN}; eligible player wins grant up to {PVP_STAT_POINTS_PER_WIN}. All earned points go into your unspent pool in Profile. Practice fights do not qualify. The shared budget resets at midnight UTC.</p>
        <p>After that budget is used, more claims and wins give no stat points until reset, but still pay their ryo and other rewards. Training is a separate source of stat points.</p>
    </details>;
}
