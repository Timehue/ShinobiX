import { AI_PVE_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP, PVP_STAT_POINTS_PER_WIN } from '../../../shared/combat-growth-rules';

export function GrowthRewardGuide() {
    return <details className="summary-box">
        <summary>How rewards grow your shinobi</summary>
        <p><strong>Levels come from stat points.</strong> Train stats and claim field and hunt dailies. Spend unallocated points in Profile.</p>
        <p><strong>Combat missions pay ryo when claimed.</strong> Their mission claim does not award combat-growth points. Use ryo for gear and jutsu lessons; using jutsu in battle also builds mastery.</p>
        <p><strong>Eligible AI and player wins share {DAILY_COMBAT_STAT_CAP} combat stat points per UTC day.</strong> Eligible AI wins grant up to {AI_PVE_STAT_POINTS_PER_WIN}; eligible player wins grant up to {PVP_STAT_POINTS_PER_WIN}. All earned combat points go into your unspent pool in Profile. Practice fights do not qualify. The shared budget resets at midnight UTC.</p>
        <p>After that growth budget is used, more wins give no combat stat points until reset. Ryo and mission claims have their own limits. Training and field/hunt daily rewards remain separate sources of stat points.</p>
    </details>;
}
