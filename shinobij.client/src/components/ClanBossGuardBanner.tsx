import type { ClanBossGuardState } from '../../../shared/clan-boss-guard.js';
import './ClanBossGuardBanner.css';

export function ClanBossGuardBanner({ guard, round }: { guard?: ClanBossGuardState; round: number }) {
    if (!guard) return null;
    const open = round <= guard.openThroughRound;
    return <aside className="clan-boss-guard" aria-label="Raid Guard">
        <strong>{open ? `Guard open through round ${guard.openThroughRound}: 25% direct-hit reduction.` : 'Raid Guard: 75% direct-hit reduction.'}</strong>
        <span>Pierce and ongoing damage bypass it.</span>
        <span>Shared HP at start: {guard.sharedHp.remainingAtStart.toLocaleString()} / {guard.sharedHp.poolMax.toLocaleString()}.</span>
        <details><summary>How to open the guard</summary>
            <p>Use useful actions from two different human fighters in one round, Clear, a pylon disruption, human fighter displacement, or an avoided signature. Openings last through the following round and cannot be extended. Pets benefit but do not count as a second fighter.</p>
        </details>
    </aside>;
}
