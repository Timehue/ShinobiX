import { maybeRequestPlayReview } from '../lib/native-play';
import { gearDropRewardLine } from '../lib/items';
import { aiFightLeftLabel, aiFightNonWinMessage, aiFightWinRewardText } from '../lib/ai-fight-result';
import type { AiFightSettleResult } from '../lib/ai-fight-settle';
import type { OrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';
import type { SoloPveTerminalReason } from '../../../shared/solo-pve-terminal';
import { EncounterDifficultyBadge } from './EncounterDifficultyBadge';

/** Result presentation for the already token-settled canonical fight. */
export default function AiFightResultCard({
    won,
    draw,
    terminalReason,
    settleState,
    settleResult,
    opponentName,
    opponentLevel,
    enemyAvatar,
    encounter,
    queuedOpponentName,
    onExportLog,
    worldEncounter,
    spar,
    onRetry,
    onExit,
}: {
    won: boolean;
    draw: boolean;
    terminalReason?: SoloPveTerminalReason;
    settleState: "idle" | "pending" | "settled" | "failed";
    settleResult: AiFightSettleResult | null;
    opponentName: string;
    opponentLevel?: number;
    enemyAvatar?: string;
    encounter?: OrdinaryPveEncounter;
    queuedOpponentName?: string;
    onExportLog?: () => void;
    worldEncounter: boolean;
    /** A practice bout: never a hospital stay, never an HP cost. */
    spar: boolean;
    onRetry: () => void;
    onExit: () => void;
}) {
    if (!won) {
        const left = draw ? null : aiFightLeftLabel(terminalReason, settleResult?.character?.hospitalized);
        return (
            <div className="story-fight-complete" role="dialog" aria-label={draw ? "Fight drawn" : left ? "Fight ended" : "Fight lost"}>
                <div className="story-fight-complete-card">
                    <p className="story-fight-complete-kicker">{draw ? "Stalemate" : left ?? (spar ? "Spar lost" : "Defeated")}</p>
                    <h2>{opponentName}</h2>
                    {enemyAvatar && <img src={enemyAvatar} alt="" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: '50%', margin: '0 auto 8px' }} />}
                    {encounter ? <EncounterDifficultyBadge encounter={encounter} /> : opponentLevel ? <p>Lv {opponentLevel}</p> : null}
                    <p className="story-fight-complete-boss" role={settleState === "failed" ? "alert" : "status"}>
                        {aiFightNonWinMessage(settleState, settleResult?.character, draw, spar, terminalReason)}
                    </p>
                    {/* "failed" must keep an EXIT, not just a Retry. The 12s-per-
                        attempt race above fixed the stalled-connection case, but a
                        deterministic server rejection still exhausts all four
                        attempts and lands here — and a Retry that can never
                        succeed is not an escape hatch. Leaving is safe: the settle
                        is token-based and report-ai-fight retains the token and
                        active pointer on a retryable failure, so the reward
                        settles on a later attempt. Same reasoning as the PvP
                        result screen. */}
                    {settleState === "failed" && <button onClick={onRetry}>Retry</button>}
                    {onExportLog && <button type="button" onClick={onExportLog}>Export observed log</button>}
                    <button disabled={settleState === "pending"} onClick={onExit}>{settleResult?.character?.hospitalized ? "Go to Hospital" : "Return"}</button>
                </div>
            </div>
        );
    }

    // WIN. Reward numbers come from the server's settle response — never a local
    // prediction, because the daily soft cap and a profession payout can both
    // change what is actually granted.
    // An upgrade gear piece belongs with the rest of the winnings (the global pop-up still fires).
    const gearLine = settleState === "settled" && settleResult?.settled && !settleResult.replayed
        ? gearDropRewardLine(settleResult.gearDropItemId)
        : null;
    return (
        <div className="story-fight-complete" role="dialog" aria-label="Fight won">
            <div className="story-fight-complete-card">
                <p className="story-fight-complete-kicker">Victory</p>
                <h2>{opponentName} defeated.</h2>
                {enemyAvatar && <img src={enemyAvatar} alt="" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: '50%', margin: '0 auto 8px' }} />}
                {encounter ? <EncounterDifficultyBadge encounter={encounter} /> : opponentLevel ? <p>Lv {opponentLevel}</p> : null}
                {queuedOpponentName && <p role="status">Next encounter: {queuedOpponentName}. Continue when ready.</p>}
                {settleState !== "settled" || !settleResult
                    ? (
                        <p className="story-fight-complete-rewards">
                            {settleState === "failed" ? "Your reward could not be confirmed. Press Retry to check it." : "Confirming your rewards…"}
                        </p>
                    )
                    : (
                                    <p className="story-fight-complete-rewards">
                                        {aiFightWinRewardText(settleResult, spar, worldEncounter)}
                                    </p>
                                    )}
                {gearLine && <p className="story-fight-complete-rewards" data-testid="ai-fight-gear-drop">{gearLine}</p>}
                {/* Same escape hatch as the defeat branch above: a failed
                    settlement offers Retry AND a way out, never Retry alone. */}
                {settleState === "failed" && <button onClick={onRetry}>Retry</button>}
                {onExportLog && <button type="button" onClick={onExportLog}>Export observed log</button>}
                <button disabled={settleState === "pending"} onClick={() => {
                    onExit();
                    if (settleState === "settled" && settleResult?.settled && settleResult.character && !settleResult.replayed) {
                        maybeRequestPlayReview(settleResult.character.level);
                    }
                }}>Continue</button>
            </div>
        </div>
    );
}
