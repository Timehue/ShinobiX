import React from "react";
import type { TowerClearComparison } from "../../../shared/tower-progression";

/** Uses the server's sealed pre-clear baseline, including after refresh or settlement retry. */
export function TowerPersonalBestReceipt({ comparison }: { comparison?: TowerClearComparison }) {
    if (!comparison) return null;
    const { score, rounds, clean, previous } = comparison;
    const scoreDelta = previous ? score - previous.bestScore : 0;
    const roundsSaved = previous ? previous.fastestRounds - rounds : 0;
    const first = !previous;
    const improved = scoreDelta > 0 || roundsSaved > 0 || (clean && !previous?.noKnockout);
    return <section className="tower-personal-best-receipt" aria-label="Personal best comparison">
        <strong>{first ? "First clear recorded" : improved ? "Personal best improved" : "Compared with your best"}</strong>
        <p className="tower-personal-best-context">Same floor · squad size · route</p>
        <dl>
            <div><dt>Score</dt><dd>{score.toLocaleString()}<small>{first ? "First record" : scoreDelta > 0 ? `+${scoreDelta.toLocaleString()} · new best` : scoreDelta === 0 ? "Matched best" : `${Math.abs(scoreDelta).toLocaleString()} below best`}</small></dd></div>
            <div><dt>Rounds</dt><dd>{rounds}<small>{first ? "First record" : roundsSaved > 0 ? `${roundsSaved} fewer · new best` : roundsSaved === 0 ? "Matched fastest" : `${Math.abs(roundsSaved)} more than fastest`}</small></dd></div>
            <div><dt>Squad</dt><dd>{clean ? "No knockouts" : "Knockouts taken"}<small>{clean ? previous?.noKnockout ? "Clean clear repeated" : "First clean clear" : previous?.noKnockout ? "Clean best retained" : "Clean clear still open"}</small></dd></div>
        </dl>
    </section>;
}
