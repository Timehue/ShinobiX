import type { ReactNode } from "react";
import {
    GiBlackFlag,
    GiCrossedSwords,
    GiExitDoor,
    GiGems,
    GiLaurelsTrophy,
    GiRank3,
    GiScrollUnfurled,
    GiTombstone,
    GiTwoCoins,
    GiUpgrade,
} from "./icons/LightweightGameIcons";
import type { PvpBattleRewardSummary } from "../lib/pvp-reward-claim";

export type PvpBattleOutcome = "victory" | "defeat" | "draw" | "escaped" | "spectator";
export type PvpSettlementState = "idle" | "claiming" | "failed" | "confirmed";

type ResultFighter = {
    name: string;
    avatar: string;
    hp: number;
    maxHp: number;
    isWinner: boolean;
};

type PvpBattleResultPanelProps = {
    outcome: PvpBattleOutcome;
    round: number;
    leftFighter: ResultFighter;
    rightFighter: ResultFighter;
    isSpectator: boolean;
    settlementState: PvpSettlementState;
    settlementNotice: string;
    settlementError: string;
    rewards: PvpBattleRewardSummary | null;
    onRetrySettlement: () => void;
    onViewBattleLog: () => void;
    returnLabel: string;
    onReturnToBattlefield: () => void;
};

const OUTCOME_COPY: Record<PvpBattleOutcome, { eyebrow: string; title: string; icon: ReactNode }> = {
    victory: { eyebrow: "Mission accomplished", title: "Victory", icon: <GiLaurelsTrophy /> },
    defeat: { eyebrow: "The duel is decided", title: "Defeat", icon: <GiTombstone /> },
    draw: { eyebrow: "Honor stands equal", title: "Draw", icon: <GiCrossedSwords /> },
    escaped: { eyebrow: "Tactical withdrawal", title: "Escaped", icon: <GiExitDoor /> },
    spectator: { eyebrow: "Duel concluded", title: "Battle Over", icon: <GiCrossedSwords /> },
};

function fighterInitials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "?";
}

function resultSummary(
    outcome: PvpBattleOutcome,
    leftFighter: ResultFighter,
    rightFighter: ResultFighter,
): string {
    if (outcome === "victory") return `The field belongs to ${leftFighter.name}.`;
    if (outcome === "defeat") return `${rightFighter.name} claimed the final exchange.`;
    if (outcome === "draw") return "Neither shinobi yielded the field.";
    if (outcome === "escaped") return `${leftFighter.name} withdrew from the duel.`;
    const winner = leftFighter.isWinner ? leftFighter.name : rightFighter.isWinner ? rightFighter.name : "Neither fighter";
    return `${winner} ${winner === "Neither fighter" ? "claimed victory" : "wins the duel"}.`;
}

function FighterResultCard({ fighter, label }: { fighter: ResultFighter; label: string }) {
    const hpPercent = fighter.maxHp > 0 ? Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100)) : 0;
    return (
        <div className={`pvp-result-fighter${fighter.isWinner ? " is-winner" : " is-defeated"}`}>
            <div className="pvp-result-avatar" aria-hidden="true">
                <span>{fighterInitials(fighter.name)}</span>
                {fighter.avatar ? <img src={fighter.avatar} alt="" /> : null}
            </div>
            <div className="pvp-result-fighter-copy">
                <span className="pvp-result-fighter-label">{fighter.isWinner ? "Victor" : label}</span>
                <strong>{fighter.name}</strong>
                <div className="pvp-result-hp-line">
                    <span><i style={{ width: `${hpPercent}%` }} /></span>
                    <small>{Math.max(0, fighter.hp).toLocaleString()} / {fighter.maxHp.toLocaleString()} HP</small>
                </div>
            </div>
        </div>
    );
}

function SettlementStatus({
    isSpectator,
    state,
    notice,
    error,
    onRetry,
}: {
    isSpectator: boolean;
    state: PvpSettlementState;
    notice: string;
    error: string;
    onRetry: () => void;
}) {
    if (isSpectator) {
        return (
            <div className="pvp-result-settlement is-confirmed" role="status">
                <span className="pvp-result-settlement-mark" aria-hidden="true">✓</span>
                <div><strong>Official result</strong><p>This duel is complete and recorded.</p></div>
            </div>
        );
    }

    if (state === "failed") {
        return (
            <div className="pvp-result-settlement is-failed" role="alert">
                <span className="pvp-result-settlement-mark" aria-hidden="true">!</span>
                <div>
                    <strong>Settlement interrupted</strong>
                    <p>{error || "The server has not confirmed this battle yet."}</p>
                </div>
                <button type="button" onClick={onRetry}>Retry</button>
            </div>
        );
    }

    if (state === "confirmed") {
        return (
            <div className="pvp-result-settlement is-confirmed" role="status">
                <span className="pvp-result-settlement-mark" aria-hidden="true">✓</span>
                <div>
                    <strong>Result secured</strong>
                    <p>{notice || "The server has recorded the final result."}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="pvp-result-settlement is-pending" role="status" aria-live="polite">
            <span className="pvp-result-spinner" aria-hidden="true" />
            <div>
                <strong>Securing the result</strong>
                <p>{state === "claiming" ? "The server is confirming battle settlement…" : "Preparing the official battle record…"}</p>
            </div>
        </div>
    );
}

function BattleRewards({
    rewards,
    isSpectator,
    state,
}: {
    rewards: PvpBattleRewardSummary | null;
    isSpectator: boolean;
    state: PvpSettlementState;
}) {
    type RewardEntry = { key: string; label: string; value: string; icon: ReactNode; negative?: boolean };
    const possibleEntries: Array<RewardEntry | null> = rewards ? [
        rewards.ryo > 0 ? { key: "ryo", label: "Ryo", value: `+${rewards.ryo.toLocaleString()}`, icon: <GiTwoCoins /> } : null,
        rewards.combatGrowth > 0 ? { key: "growth", label: "Combat Growth", value: `+${rewards.combatGrowth}`, icon: <GiUpgrade /> } : null,
        rewards.professionXp > 0 ? { key: "xp", label: "Vanguard XP", value: `+${rewards.professionXp}`, icon: <GiRank3 /> } : null,
        rewards.warPoints > 0 ? {
            key: "war",
            label: rewards.warPointKind === "sector" ? "War Score" : "Clan War Points",
            value: `+${rewards.warPoints}`,
            icon: <GiBlackFlag />,
        } : null,
        rewards.auraDust > 0 ? { key: "dust", label: "Aura Dust", value: `+${rewards.auraDust}`, icon: <GiGems /> } : null,
        rewards.fateShards > 0 ? { key: "shards", label: "Fate Shards", value: `+${rewards.fateShards}`, icon: <GiGems /> } : null,
        rewards.honorSeals > 0 ? { key: "seals", label: "Honor Seals", value: `+${rewards.honorSeals}`, icon: <GiRank3 /> } : null,
        rewards.territoryScrolls > 0 ? { key: "scroll", label: "Territory Scroll", value: `+${rewards.territoryScrolls}`, icon: <GiScrollUnfurled /> } : null,
        rewards.ratingDelta ? {
            key: "rating",
            label: "Ranked Rating",
            value: `${rewards.ratingDelta > 0 ? "+" : ""}${rewards.ratingDelta}`,
            icon: <GiRank3 />,
            negative: rewards.ratingDelta < 0,
        } : null,
    ] : [];
    const entries = possibleEntries.filter((entry): entry is RewardEntry => entry !== null);
    const verificationLabel = isSpectator || state === "confirmed"
        ? "Server verified"
        : state === "failed"
            ? "Verification pending"
            : "Calculating";

    return (
        <section className="pvp-result-rewards" aria-labelledby="pvp-result-rewards-title">
            <div className="pvp-result-rewards-heading">
                <strong id="pvp-result-rewards-title">Battle Rewards</strong>
                <small>{verificationLabel}</small>
            </div>
            {isSpectator ? (
                <p className="pvp-result-no-rewards">Spectators receive no battle rewards.</p>
            ) : entries.length > 0 ? (
                <div className="pvp-result-reward-grid">
                    {entries.map((entry) => (
                        <div className={`pvp-result-reward${entry.negative ? " is-negative" : ""}`} key={entry.key}>
                            <span aria-hidden="true">{entry.icon}</span>
                            <small>{entry.label}</small>
                            <strong>{entry.value}</strong>
                        </div>
                    ))}
                </div>
            ) : state === "idle" || state === "claiming" ? (
                <div className="pvp-result-rewards-pending" role="status">
                    <span className="pvp-result-spinner" aria-hidden="true" />
                    Calculating official rewards…
                </div>
            ) : state === "failed" ? (
                <p className="pvp-result-no-rewards">Reward details will appear after settlement succeeds.</p>
            ) : (
                <p className="pvp-result-no-rewards">No personal payout for this result.</p>
            )}
        </section>
    );
}

export function PvpBattleResultPanel({
    outcome,
    round,
    leftFighter,
    rightFighter,
    isSpectator,
    settlementState,
    settlementNotice,
    settlementError,
    rewards,
    onRetrySettlement,
    onViewBattleLog,
    returnLabel,
    onReturnToBattlefield,
}: PvpBattleResultPanelProps) {
    const copy = OUTCOME_COPY[outcome];
    const exitsEnabled = isSpectator || settlementState === "confirmed";
    const titleId = "pvp-battle-result-title";

    return (
        <div className={`pvp-result-overlay pvp-result-${outcome}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <article className="pvp-result-card">
                <header className="pvp-result-header">
                    <span className="pvp-result-round">Duel complete <i /> Round {round}</span>
                    <span className="pvp-result-crest" aria-hidden="true">{copy.icon}</span>
                    <p>{copy.eyebrow}</p>
                    <h2 id={titleId}>{copy.title}</h2>
                    <div className="pvp-result-rule" aria-hidden="true"><span /></div>
                    <strong className="pvp-result-summary">{resultSummary(outcome, leftFighter, rightFighter)}</strong>
                </header>

                <div className="pvp-result-matchup" aria-label={`${leftFighter.name} versus ${rightFighter.name}`}>
                    <FighterResultCard fighter={leftFighter} label={isSpectator ? "Fighter one" : "You"} />
                    <span className="pvp-result-versus" aria-hidden="true"><small>Final</small>VS</span>
                    <FighterResultCard fighter={rightFighter} label={isSpectator ? "Fighter two" : "Rival"} />
                </div>

                <BattleRewards rewards={rewards} isSpectator={isSpectator} state={settlementState} />

                <SettlementStatus
                    isSpectator={isSpectator}
                    state={settlementState}
                    notice={settlementNotice}
                    error={settlementError}
                    onRetry={onRetrySettlement}
                />

                <div className="pvp-result-actions">
                    <button className="pvp-result-primary" type="button" onClick={onReturnToBattlefield} disabled={!exitsEnabled}>
                        <GiExitDoor aria-hidden="true" />
                        {returnLabel}
                    </button>
                    <button type="button" onClick={onViewBattleLog}>
                        <GiScrollUnfurled aria-hidden="true" />
                        Battle Log
                    </button>
                </div>
            </article>
        </div>
    );
}
