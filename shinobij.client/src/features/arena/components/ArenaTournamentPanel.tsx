import type { ArenaTournament } from "../../../lib/world-state";

type ArenaTournamentPanelProps = {
    tournament: ArenaTournament | null;
    tournamentRemaining: number;
    matchRemaining: number;
    isAdminTournamentManager: boolean;
    tournamentWinnerBusy: boolean;
    onAdvancePlayer: (name: string) => void;
    onDeclareWinner: (name: string) => void;
    onClear: () => void;
    onStart: () => void;
};

export function ArenaTournamentPanel({
    tournament,
    tournamentRemaining,
    matchRemaining,
    isAdminTournamentManager,
    tournamentWinnerBusy,
    onAdvancePlayer,
    onDeclareWinner,
    onClear,
    onStart,
}: ArenaTournamentPanelProps) {
    return (
        <section className="summary-box">
            <h3>Tournaments</h3>
            {tournament ? (
                <>
                    <p><strong>{tournament.name}</strong> | Started by {tournament.createdBy}</p>
                    <p>Event ends in {Math.ceil(tournamentRemaining / (60 * 60 * 1000))} hour(s). Match timer: {Math.ceil(matchRemaining / (60 * 60 * 1000))} hour(s).</p>
                    <p className="hint">Participants: {tournament.participants.join(", ") || "No participants"}</p>
                    <p className="hint">Advanced: {tournament.advancedPlayers.join(", ") || "None yet"}</p>
                    {tournament.winnerName ? <p><strong>Champion:</strong> {tournament.winnerName}</p> : null}
                    {isAdminTournamentManager && !tournament.winnerName ? (
                        <div className="jutsu-list">
                            {tournament.participants.map((name) => {
                                const advanced = tournament.advancedPlayers.includes(name);
                                return (
                                    <div className="summary-box" key={`advance-${name}`}>
                                        <strong>{name}</strong>
                                        <div className="menu">
                                            <button disabled={advanced} onClick={() => onAdvancePlayer(name)}>{advanced ? "Advanced" : "Advance Player"}</button>
                                            {advanced ? <button disabled={tournamentWinnerBusy} onClick={() => onDeclareWinner(name)}>Declare Champion</button> : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                    {isAdminTournamentManager ? <button className="danger-button" onClick={onClear}>End Tournament</button> : null}
                </>
            ) : (
                <>
                    <p className="hint">Only Admin 1 can start a weekly tournament.</p>
                    <button disabled={!isAdminTournamentManager} onClick={onStart}>{isAdminTournamentManager ? "Start 1 Week Tournament" : "Admin Only"}</button>
                </>
            )}
        </section>
    );
}
