export type PvpBattleOutcome = "victory" | "defeat" | "draw" | "escaped" | "spectator";
export type PvpSettlementState = "idle" | "claiming" | "failed" | "confirmed";

type Props = {
    outcome: PvpBattleOutcome;
    round: number;
    combatants: string;
    isSpectator: boolean;
    settlementState: PvpSettlementState;
    settlementNotice: string;
    settlementError: string;
    onRetrySettlement: () => void;
    onViewBattleLog: () => void;
    returnLabel: string;
    onReturnToBattlefield: () => void;
};

export function PvpBattleResultPanel(p: Props) {
    const title = p.outcome === "victory" ? "Victory"
        : p.outcome === "defeat" ? "Defeat"
            : p.outcome === "draw" ? "Draw"
                : p.outcome === "escaped" ? "Escaped" : "Battle Over";
    const failed = p.settlementState === "failed";
    const confirmed = p.isSpectator || p.settlementState === "confirmed";
    // Failed claims have a durable receipt and pending-session recovery, so an
    // outage must not become another permanent PvP trap.
    const exitsEnabled = confirmed || failed;
    return (
        <div className={"battle-ended-overlay battle-ended-overlay--stage pvp-result-overlay pvp-result-" + p.outcome}
            role="dialog" aria-modal="true" aria-labelledby="pvp-battle-result-title">
            <article className="card battle-ended-card pvp-result-card">
                <header>
                    <small>Duel complete · Round {p.round}</small>
                    <h2 id="pvp-battle-result-title" className={p.outcome === "victory" ? "battle-result-win" : p.outcome === "defeat" ? "battle-result-loss" : ""}>{title}</h2>
                    <strong>{p.combatants}</strong>
                </header>

                <section className="pvp-result-rewards" aria-label="Battle rewards">
                    <header><b>Battle Rewards</b><small>{confirmed ? "Server verified" : "Settlement pending"}</small></header>
                    <p>{p.isSpectator ? "Spectators receive no rewards."
                        : confirmed ? p.settlementNotice || "No personal payout for this result."
                            : failed ? "Reward details will appear after settlement succeeds."
                                : "Calculating official rewards…"}</p>
                </section>

                <div className={"pvp-result-settlement" + (failed ? " is-failed" : "")}
                    role={failed ? "alert" : "status"}>
                    <span>{confirmed ? "✓ Result secured by the server."
                        : failed ? "! " + (p.settlementError || "Battle settlement is pending.")
                            : "Securing the official result…"}</span>
                    {failed ? <button type="button" onClick={p.onRetrySettlement}>Retry</button> : null}
                </div>

                <div className="menu pvp-result-actions">
                    <button type="button" onClick={p.onReturnToBattlefield} disabled={!exitsEnabled}>{p.returnLabel}</button>
                    <button type="button" onClick={p.onViewBattleLog}>Battle Log</button>
                </div>
            </article>
        </div>
    );
}
