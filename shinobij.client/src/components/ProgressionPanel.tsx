/*
 * ProgressionPanel (PX-6) — the "where am I and what's next" legibility card.
 *
 * One glance answers the three questions that otherwise drive churn:
 *   • Leveling (pace):  XP into this level → how much to the next level.
 *   • Power (stats):    points earned vs spent vs unspent, and the next grant.
 *   • Rank (the spike): the per-rank COMBAT stat cap currently applied, how many
 *                       of your stats it's clamping, and the cap you unlock at
 *                       the next rank — making the otherwise-invisible anti-twink
 *                       clamp + the rank-up power spike concrete.
 *
 * Pure read-only view of `character`; lives on the Profile → Stats tab next to
 * the stat-allocation cards. Self-contained CSS (component-local import).
 */
import type { Character } from "../types/character";
import { MAX_LEVEL, MAX_STAT, statCapForLevel } from "../constants/game";
import {
    xpNeeded,
    statBudgetAtLevel,
    allocatedStatPoints,
    normalizeStats,
    rankFromLevel,
} from "../lib/stats";
import { nextRankBand, cappedStatCount } from "../lib/rank-progression";
import "./ProgressionPanel.css";

export function ProgressionPanel({ character }: { character: Character }) {
    const level = character.level;
    const maxed = level >= MAX_LEVEL;
    const need = xpNeeded(level);
    const xp = Math.max(0, Math.floor(character.xp ?? 0));
    const xpPct = maxed || need <= 0 ? 100 : Math.min(100, Math.round((xp / need) * 100));
    const xpRemaining = maxed || need <= 0 ? 0 : Math.max(0, need - xp);

    // Earned = spent + unspent so the three numbers always add up AND "Unspent"
    // matches the authoritative budget the allocation widget lets you spend
    // (character.unspentStats), even on a not-yet-reconciled save.
    const spent = allocatedStatPoints(normalizeStats(character.stats));
    const unspent = Math.max(0, character.unspentStats ?? 0);
    const earned = spent + unspent;
    const nextLevelGrant = maxed ? 0 : statBudgetAtLevel(level + 1) - statBudgetAtLevel(level);

    const cap = statCapForLevel(level);
    const uncapped = cap >= MAX_STAT;
    const capped = cappedStatCount(character.stats, level);
    const next = nextRankBand(level);

    function openPatchNotes() {
        try { window.dispatchEvent(new CustomEvent("shinobix:open-patch-notes")); } catch { /* no-op */ }
    }

    return (
        <section className="prog-panel" aria-label="Progression overview">
            <header className="prog-head">
                <h3>Progression</h3>
                <span className="prog-rank-badge">{rankFromLevel(level)}</span>
            </header>

            {/* Leveling — pace */}
            <div className="prog-block">
                <div className="prog-row">
                    <span className="prog-label">Level {level}{maxed ? "" : ` / ${MAX_LEVEL}`}</span>
                    <span className="prog-value">{maxed ? "MAX LEVEL" : `${xp.toLocaleString()} / ${need.toLocaleString()} XP`}</span>
                </div>
                {!maxed && (
                    <>
                        <div className="prog-bar-track"><div className="prog-bar-fill" style={{ width: `${xpPct}%` }} /></div>
                        <div className="prog-sub">{xpRemaining.toLocaleString()} XP to Level {level + 1}</div>
                    </>
                )}
            </div>

            {/* Power — stat budget */}
            <div className="prog-block">
                <div className="prog-budget-grid">
                    <div className="prog-budget-cell">
                        <span className="prog-budget-num prog-num-unspent">{unspent.toLocaleString()}</span>
                        <span className="prog-budget-cap">Unspent</span>
                    </div>
                    <div className="prog-budget-cell">
                        <span className="prog-budget-num">{spent.toLocaleString()}</span>
                        <span className="prog-budget-cap">Spent</span>
                    </div>
                    <div className="prog-budget-cell">
                        <span className="prog-budget-num">{earned.toLocaleString()}</span>
                        <span className="prog-budget-cap">Earned</span>
                    </div>
                </div>
                <div className="prog-sub">
                    {maxed
                        ? "Fully grown — every stat can reach the cap."
                        : `Each level grants ~${nextLevelGrant.toLocaleString()} more stat point${nextLevelGrant === 1 ? "" : "s"}.`}
                </div>
            </div>

            {/* Rank — the combat cap + the next-rank spike */}
            <div className="prog-block">
                <div className="prog-row">
                    <span className="prog-label">Combat stat cap</span>
                    <span className="prog-value">{uncapped ? "Uncapped" : cap.toLocaleString()}</span>
                </div>
                {capped > 0 && !uncapped && (
                    <div className="prog-warn">
                        {capped} of your stat{capped === 1 ? " is" : "s are"} held to {cap.toLocaleString()} in battle until you rank up.
                    </div>
                )}
                <div className="prog-sub">
                    {next
                        ? <>Reach <strong>{next.rank}</strong> at Level {next.minLevel} to raise the cap to <strong>{next.statCap.toLocaleString()}</strong> (+{(next.statCap - cap).toLocaleString()}).</>
                        : <>You're at the top rank — your full stats apply in combat.</>}
                </div>
            </div>

            <button type="button" className="prog-whatsnew" onClick={openPatchNotes}>What's New →</button>
        </section>
    );
}
